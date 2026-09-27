const MEMORY_VERSION = 1;
const MAX_PROFILE_BYTES = 12000;
const MAX_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptJson(secret, value) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return b64url(iv) + "." + b64url(ciphertext);
}

async function decryptJson(secret, packed) {
  const [ivPart, cipherPart] = String(packed || "").split(".");
  if (!ivPart || !cipherPart) return null;
  const key = await deriveKey(secret);
  const iv = fromB64url(ivPart);
  const ciphertext = fromB64url(cipherPart);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return [...signature].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function sanitizePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const allowed = [
    "name", "phone", "email", "service", "location", "property_type",
    "size", "surface", "condition", "timing"
  ];
  const result = {};
  for (const key of allowed) {
    if (patch[key] !== undefined && patch[key] !== null && String(patch[key]).trim()) {
      result[key] = clean(patch[key], key === "condition" ? 500 : 200);
    }
  }
  return result;
}

function normalizeContact(value) {
  return String(value || "").trim().toLowerCase();
}

export class LucyMemory {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.secret = env.LUCY_MEMORY_ENCRYPTION_KEY;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        customer_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contacts (
        contact_hash TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  async purgeExpired(now = Date.now()) {
    this.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", now);
    this.sql.exec("DELETE FROM profiles WHERE expires_at <= ?", now);
    this.sql.exec(
      "DELETE FROM contacts WHERE customer_id NOT IN (SELECT customer_id FROM profiles)"
    );
  }

  async resolveCustomer({ sessionId, contactValues = [] }) {
    const now = Date.now();
    await this.purgeExpired(now);

    let customerId = null;
    if (sessionId) {
      const row = this.sql.exec(
        "SELECT customer_id FROM sessions WHERE session_id = ? AND expires_at > ?",
        clean(sessionId, 100), now
      ).toArray()[0];
      customerId = row?.customer_id || null;
    }

    if (!customerId && contactValues.length) {
      for (const value of contactValues.slice(0, 2)) {
        const normalized = normalizeContact(value);
        if (!normalized) continue;
        const hash = await hmacHex(this.secret, normalized);
        const row = this.sql.exec(
          "SELECT customer_id FROM contacts WHERE contact_hash = ?",
          hash
        ).toArray()[0];
        if (row?.customer_id) {
          customerId = row.customer_id;
          break;
        }
      }
    }

    if (!customerId) return null;

    const row = this.sql.exec(
      "SELECT payload, updated_at FROM profiles WHERE customer_id = ? AND expires_at > ?",
      customerId, now
    ).toArray()[0];
    if (!row) return null;

    const profile = await decryptJson(this.secret, row.payload);
    if (!profile || profile.version !== MEMORY_VERSION) return null;

    if (sessionId) {
      this.sql.exec(
        `INSERT INTO sessions (session_id, customer_id, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           customer_id=excluded.customer_id,
           updated_at=excluded.updated_at,
           expires_at=excluded.expires_at`,
        clean(sessionId, 100), customerId, now, now, now + MAX_RETENTION_MS
      );
    }

    return { customerId, profile: profile.data || {}, updatedAt: row.updated_at };
  }

  async save({ sessionId, contactValues = [], patch = {} }) {
    if (!this.secret || !sessionId) return { saved: false };

    const now = Date.now();
    await this.purgeExpired(now);
    const cleanPatch = sanitizePatch(patch);
    if (!Object.keys(cleanPatch).length) return { saved: false };

    let customerId = null;
    const sessionRow = this.sql.exec(
      "SELECT customer_id FROM sessions WHERE session_id = ? AND expires_at > ?",
      clean(sessionId, 100), now
    ).toArray()[0];
    customerId = sessionRow?.customer_id || null;

    if (!customerId) {
      for (const value of contactValues.slice(0, 2)) {
        const normalized = normalizeContact(value);
        if (!normalized) continue;
        const hash = await hmacHex(this.secret, normalized);
        const row = this.sql.exec(
          "SELECT customer_id FROM contacts WHERE contact_hash = ?",
          hash
        ).toArray()[0];
        if (row?.customer_id) {
          customerId = row.customer_id;
          break;
        }
      }
    }

    if (!customerId) customerId = crypto.randomUUID();

    let current = {};
    const profileRow = this.sql.exec(
      "SELECT payload FROM profiles WHERE customer_id = ?",
      customerId
    ).toArray()[0];
    if (profileRow?.payload) {
      try {
        const decoded = await decryptJson(this.secret, profileRow.payload);
        current = decoded?.data || {};
      } catch {}
    }

    const merged = { ...current, ...cleanPatch };
    const profile = {
      version: MEMORY_VERSION,
      data: merged
    };
    const payload = JSON.stringify(profile);
    if (payload.length > MAX_PROFILE_BYTES) return { saved: false };

    const encrypted = await encryptJson(this.secret, profile);
    this.sql.exec(
      `INSERT INTO profiles (customer_id, payload, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         payload=excluded.payload,
         updated_at=excluded.updated_at,
         expires_at=excluded.expires_at`,
      customerId, encrypted, profileRow ? now : now, now, now + MAX_RETENTION_MS
    );

    this.sql.exec(
      `INSERT INTO sessions (session_id, customer_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         customer_id=excluded.customer_id,
         updated_at=excluded.updated_at,
         expires_at=excluded.expires_at`,
      clean(sessionId, 100), customerId, now, now, now + MAX_RETENTION_MS
    );

    for (const value of contactValues.slice(0, 2)) {
      const normalized = normalizeContact(value);
      if (!normalized) continue;
      const hash = await hmacHex(this.secret, normalized);
      this.sql.exec(
        `INSERT INTO contacts (contact_hash, customer_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(contact_hash) DO UPDATE SET
           customer_id=excluded.customer_id,
           updated_at=excluded.updated_at`,
        hash, customerId, now, now
      );
    }

    return { saved: true, customerId };
  }

  async deleteCustomer(customerId) {
    if (!customerId) return false;
    this.sql.exec("DELETE FROM contacts WHERE customer_id = ?", clean(customerId, 100));
    this.sql.exec("DELETE FROM sessions WHERE customer_id = ?", clean(customerId, 100));
    this.sql.exec("DELETE FROM profiles WHERE customer_id = ?", clean(customerId, 100));
    return true;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const body = await request.json();
      const action = String(body?.action || "");
      if (!this.secret) return Response.json({ ok: false, error: "Memory encryption is not configured." }, { status: 503 });

      if (action === "load") {
        const result = await this.resolveCustomer({
          sessionId: body.session_id,
          contactValues: Array.isArray(body.contact_values) ? body.contact_values : []
        });
        return Response.json({ ok: true, ...result });
      }

      if (action === "save") {
        const result = await this.save({
          sessionId: body.session_id,
          contactValues: Array.isArray(body.contact_values) ? body.contact_values : [],
          patch: body.patch
        });
        return Response.json({ ok: true, ...result });
      }

      if (action === "delete") {
        return Response.json({ ok: await this.deleteCustomer(body.customer_id) });
      }

      return Response.json({ ok: false, error: "Unknown memory action." }, { status: 400 });
    } catch (error) {
      console.error("Lucy memory error", error?.message || "memory operation failed");
      return Response.json({ ok: false, error: "Memory operation failed." }, { status: 500 });
    }
  }
}
