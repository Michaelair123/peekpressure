#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const failures = [];
const checks = [];

async function read(path) {
  try { return await fs.readFile(path, "utf8"); }
  catch (error) { failures.push(`Missing/unreadable file: ${path} — ${error.message}`); return ""; }
}

function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail });
  if (!condition) failures.push(`${name}: ${detail}`);
}

const index = await read("index.html");
const css = await read("style.css");
const chat = await read("functions/api/chat.js");
const faq = await read("faq-data.js");
const worker = await read("worker.js");
const wrangler = await read("wrangler.jsonc");

check("HTML document structure", /^\s*<!doctype html>/i.test(index) && /<html\b/i.test(index) && /<head\b/i.test(index) && /<body\b/i.test(index) && /<\/body>\s*<\/html>\s*$/i.test(index), "index.html must remain a complete HTML document.");
check("Single Lucy launcher", (index.match(/id=["']peekChatLauncher["']/g) || []).length === 1, "Expected exactly one #peekChatLauncher.");
check("Single Lucy panel", (index.match(/id=["']peekChat["']/g) || []).length === 1, "Expected exactly one #peekChat.");
check("Single map mount", (index.match(/id=["']peekServiceMap["']/g) || []).length === 1, "Expected exactly one #peekServiceMap.");
check("No duplicate HTML IDs", (() => {
  const ids = [...index.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  return dupes.length === 0;
})(), "Duplicate id attributes can break Lucy, forms, and map behavior.");

check("Current Calendly URL", index.includes("https://calendly.com/peekpressure/30min") && chat.includes("https://calendly.com/peekpressure/30min"), "Both frontend and Lucy must use the current PEEK PRESSURE booking event.");
check("No stale Calendly URLs", !/calendly\.com\/(?:michaelair123|look-peekpressure)/i.test(index + "\n" + chat + "\n" + faq + "\n" + worker), "Old Calendly URLs must not return.");
check("$200 minimum only", !/\$150\b/.test(chat + "\n" + faq + "\n" + index), "Production customer-facing code must not contain the retired $150 minimum.");
check("Ladder work boundary", /does not currently offer work that requires ladder access/i.test(faq) && /ladder/i.test(chat), "Lucy and FAQ must preserve the ladder-work limitation.");
check("Ground-level patio boundary", /ground-level patios/i.test(faq) && /ground-level patios/i.test(chat), "Patio scope must remain ground-level.");
check("No literal escaped newline syntax bug", !/\\n\s+(?:const|let|var)\b/.test(chat), "chat.js must not contain literal \n text before JavaScript statements.");
check("CSP allows Calendly", /frame-src[^;]*https:\/\/calendly\.com/i.test(worker), "CSP frame-src must allow the embedded Calendly origin.");
check("CSP allows Leaflet CSS", /style-src[^;]*https:\/\/cdn\.jsdelivr\.net/i.test(worker), "CSP style-src must allow the Leaflet stylesheet origin.");
check("CSP allows map tiles", /img-src[^;]*https:\/\/tile\.openstreetmap\.org/i.test(worker), "CSP img-src must allow OpenStreetMap tiles.");
check("Observability configured", /"observability"\s*:\s*\{/.test(wrangler), "wrangler.jsonc should retain observability configuration.");
check("Stylesheet present", css.length > 1000, "style.css unexpectedly appears empty or truncated.");

for (const file of ["worker.js", "functions/api/chat.js", "functions/api/faq.js", "functions/api/[[path]].js", "faq-data.js", "scripts/lucy-stress-test.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  check(`JavaScript syntax: ${file}`, result.status === 0, result.stderr.trim() || "node --check failed");
}

console.log(JSON.stringify({ passed: checks.filter(x => x.pass).length, failed: failures.length, failures }, null, 2));
if (failures.length) process.exit(1);
