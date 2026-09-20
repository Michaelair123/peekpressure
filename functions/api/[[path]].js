const LEAD_RATE_WINDOW_MS = 10 * 60 * 1000;
const LEAD_RATE_LIMIT = 3;
const leadRateBuckets = new Map();

function getClientKey(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown-client";
}

function checkLeadRateLimit(request) {
  const key = getClientKey(request);
  const now = Date.now();
  let bucket = leadRateBuckets.get(key);

  if (!bucket || now - bucket.startedAt >= LEAD_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
  }

  if (bucket.count >= LEAD_RATE_LIMIT) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((bucket.startedAt + LEAD_RATE_WINDOW_MS - now) / 1000))
    };
  }

  bucket.count += 1;
  leadRateBuckets.set(key, bucket);

  if (leadRateBuckets.size > 5000) {
    for (const [clientKey, clientBucket] of leadRateBuckets) {
      if (now - clientBucket.startedAt >= LEAD_RATE_WINDOW_MS) {
        leadRateBuckets.delete(clientKey);
      }
    }
  }

  return { allowed: true, retryAfter: 0 };
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifyLeadToken(secret, token, lead) {
  if (!secret || typeof token !== "string" || !token.includes(".")) return false;

  try {
    const [encodedPayload, encodedSignature] = token.split(".");
    const payloadBytes = base64UrlDecode(encodedPayload);
    const signatureBytes = base64UrlDecode(encodedSignature);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));

    if (!payload?.exp || payload.exp < Date.now() || !payload?.lead) return false;

    const canonicalLead = {
      name: String(lead.name || "").trim(),
      phone: String(lead.phone || "").trim(),
      email: String(lead.email || "").trim(),
      service: String(lead.service || "").trim(),
      location: String(lead.location || "").trim(),
      property_type: String(lead.property_type || "").trim(),
      size: String(lead.size || "").trim(),
      surface: String(lead.surface || "").trim(),
      condition: String(lead.condition || "").trim(),
      timing: String(lead.timing || "").trim(),
      question: String(lead.question || "").trim(),
      lead_status: String(lead.lead_status || "").trim()
    };

    if (JSON.stringify(payload.lead) !== JSON.stringify(canonicalLead)) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      payloadBytes
    );
  } catch {
    return false;
  }
}

const TO_EMAIL = "look@peekpressure.com";
const FROM_EMAIL = "PEEK PRESSURE <look@peekpressure.com>";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeMessage(message) {
  const role = message?.role === "user" ? "CUSTOMER" : "LUCY";

  const content = Array.isArray(message?.content)
    ? message.content
        .map(part => {
          if (part?.type === "input_text") return part.text || "";
          if (part?.type === "input_image") return "[Photo attached]";
          return "";
        })
        .filter(Boolean)
        .join(" ")
    : String(message?.content || "");

  return content.trim() ? role + ": " + content.trim() : "";
}

async function createHandoffIdempotencyKey(conversationId, handoffKind, lead) {
  const canonical = JSON.stringify({
    conversation_id: conversationId || "no-conversation",
    handoff_kind: handoffKind,
    lead: {
      name: String(lead.name || "").trim(),
      phone: String(lead.phone || "").trim(),
      email: String(lead.email || "").trim(),
      service: String(lead.service || "").trim(),
      location: String(lead.location || "").trim(),
      property_type: String(lead.property_type || "").trim(),
      size: String(lead.size || "").trim(),
      surface: String(lead.surface || "").trim(),
      condition: String(lead.condition || "").trim(),
      timing: String(lead.timing || "").trim(),
      question: String(lead.question || "").trim()
    }
  });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return "lucy/" + (conversationId || "no-conversation") + "/" + handoffKind.toLowerCase().replace(/[^a-z0-9_-]/g, "-") + "/" + hex.slice(0, 32);
}

function buildStableHandoffTranscript(messages, lead) {
  const normalized = messages.map(normalizeMessage).filter(Boolean);
  if (!normalized.length) return "";

  const contactNeedles = [
    String(lead.name || "").trim(),
    String(lead.phone || "").trim(),
    String(lead.email || "").trim()
  ].filter(Boolean);

  if (!contactNeedles.length) return normalized.join("\n\n");

  let cutoff = normalized.length;
  for (let index = 0; index < normalized.length; index += 1) {
    const value = normalized[index].toLowerCase();
    if (contactNeedles.some(needle => value.includes(needle.toLowerCase()))) {
      cutoff = Math.min(normalized.length, index + 1);
      break;
    }
  }

  return normalized.slice(0, cutoff).join("\n\n");
}

async function handleLead(context) {
  const rate = checkLeadRateLimit(context.request);
  if (!rate.allowed) {
    return new Response(JSON.stringify({
      error: "Too many quote requests. Please try again later.",
      handoff_state: "HANDOFF_FAILED"
    }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(rate.retryAfter)
      }
    });
  }

  const RESEND_API_KEY = context.env.RESEND_API_KEY;
  const LEAD_SIGNING_SECRET = context.env.LEAD_SIGNING_SECRET || RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    return json({
      error: "Email is not configured yet. Add RESEND_API_KEY to Cloudflare.",
      handoff_state: "HANDOFF_FAILED"
    }, 500);
  }

  try {
    const body = await context.request.json();
    const lead = body.lead || {};
    const leadToken = String(body.lead_token || "").trim();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-32) : [];
    const conversationId = String(body.conversation_id || "").trim();

    const name = String(lead.name || "").trim();
    const phone = String(lead.phone || "").trim();
    const email = String(lead.email || "").trim();

    if (!name || (!phone && !email)) {
      return json({
        error: "A customer name and at least one contact method are required.",
        handoff_state: "HANDOFF_FAILED"
      }, 400);
    }

    if (lead.lead_status === "spam") {
      return json({ error: "This lead was not eligible for email handoff.", handoff_state: "SPAM" }, 400);
    }
    // Partial leads are intentionally capturable when we have a real customer
    // name plus phone or email. This protects against customers disconnecting
    // before qualification is complete.
    if (!(await verifyLeadToken(LEAD_SIGNING_SECRET, leadToken, lead))) {
      return json({ error: "This lead handoff is no longer valid. Please start the quote conversation again.", handoff_state: "HANDOFF_FAILED" }, 403);
    }

    const isPartial = lead.lead_status === "uncertain";
    const handoffKind = isPartial ? "PARTIAL CAPTURE" : "QUALIFIED HANDOFF";
    const idempotencyKey = await createHandoffIdempotencyKey(conversationId, handoffKind, lead);
    // Keep the email payload stable across retries. Messages added after the
    // first contact/handoff attempt (TRY AGAIN, failure notices, etc.) should
    // not change the transactional email body or its idempotency key.
    const transcript = buildStableHandoffTranscript(messages, lead);
    const details = [
      ["Handoff type", handoffKind],
      ["Name", name],
      ["Phone", phone],
      ["Email", email],
      ["Service", lead.service],
      ["Location", lead.location],
      ["Property", lead.property_type],
      ["Approx. size", lead.size],
      ["Surface", lead.surface],
      ["Condition", lead.condition],
      ["Timing", lead.timing],
      ["Question / notes", lead.question]
    ].filter(([, value]) => String(value || "").trim());

    const detailsHtml = details
      .map(([label, value]) =>
        `<tr><td style="padding:7px 12px;border-bottom:1px solid #eee;font-weight:700;">${escapeHtml(label)}</td><td style="padding:7px 12px;border-bottom:1px solid #eee;">${escapeHtml(value)}</td></tr>`
      )
      .join("");

    const transcriptHtml = escapeHtml(
      transcript || "No transcript was available."
    ).replace(/\n/g, "<br>");

    const subject = `🔔 New PEEK PRESSURE lead — ${name}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#111;">
        <h2 style="margin-bottom:6px;">New PEEK PRESSURE Lead</h2>
        <p style="margin-top:0;color:#666;">${isPartial ? "Partial contact capture through Lucy — qualification may continue later." : "Qualified lead handoff confirmed through Lucy."}</p>
        <h3>Customer Details</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${detailsHtml}
        </table>
        <h3 style="margin-top:28px;">Full Chat History</h3>
        <div style="background:#f6f6f6;border:1px solid #e5e5e5;border-radius:10px;padding:16px;font-size:14px;line-height:1.6;">
          ${transcriptHtml}
        </div>
        <p style="margin-top:24px;font-weight:700;">
          ${isPartial
            ? "Lucy captured the customer's contact information before qualification was complete."
            : "Customer confirmed that PEEK PRESSURE should receive this information."}
        </p>
      </div>
    `;

    const text = [
      "NEW PEEK PRESSURE LEAD",
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "FULL CHAT HISTORY",
      "-----------------",
      transcript || "No transcript was available.",
      "",
      isPartial
        ? "Lucy captured the customer's contact information before qualification was complete."
        : "Customer confirmed that PEEK PRESSURE should receive this information.",
      conversationId ? `Conversation ID: ${conversationId}` : ""
    ].filter(Boolean).join("\n");

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        subject,
        html,
        text,
        ...(email ? { reply_to: email } : {})
      })
    });

    // Read the provider response defensively. Resend can accept the email even
    // if the response body is empty or cannot be parsed as JSON.
    const responseText = await resendResponse.text();
    let result = null;
    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      result = null;
    }

    if (!resendResponse.ok) {
      console.error("Resend lead email failed:", resendResponse.status, result || responseText);
      return json({
        error: result?.message || result?.name || "Email provider rejected the lead.",
        handoff_state: "HANDOFF_FAILED"
      }, 502);
    }

    // Once Resend has returned a successful HTTP status, the handoff is complete.
    return json({
      success: true,
      sent: true,
      handoff_state: "HANDED_OFF",
      status: "submitted",
      email_id: result?.id || null,
      conversation_id: conversationId || null,
      idempotency_key: idempotencyKey
    });
  } catch (error) {
    console.error("Lucy lead email handler error:", error);
    return json({ error: "The lead email could not be sent.", handoff_state: "HANDOFF_FAILED" }, 500);
  }
}

export async function onRequestGet() {
  return json({ error: "Not found" }, 404);
}

export async function onRequestPost(context) {
  const path = Array.isArray(context.params?.path)
    ? context.params.path.join("/")
    : String(context.params?.path || "");

  if (path === "lead") return handleLead(context);
  return json({ error: "Not found" }, 404);
}
