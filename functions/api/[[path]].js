const MODEL = "gpt-5.6-luna";
const CALENDLY_URL = "https://calendly.com/look-peekpressure/pressure-wash";
const CALENDLY_API = "https://api.calendly.com";

function json(body, status = 200) {
  return Response.json(body, { status });
}

function calendlyHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function calendlyGet(token, path) {
  const response = await fetch(CALENDLY_API + path, {
    method: "GET",
    headers: calendlyHeaders(token)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    const message = data?.message || data?.title || `Calendly API returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function getPressureWashEventType(token) {
  const userData = await calendlyGet(token, "/users/me");
  const userUri = userData?.resource?.uri;
  if (!userUri) throw new Error("Calendly did not return the connected user.");

  const params = new URLSearchParams({
    user: userUri,
    active: "true",
    count: "100"
  });

  const eventTypesData = await calendlyGet(token, `/event_types?${params.toString()}`);
  const eventTypes = Array.isArray(eventTypesData?.collection)
    ? eventTypesData.collection
    : [];

  if (!eventTypes.length) {
    throw new Error("No active Calendly event types were found.");
  }

  const exactUrl = eventTypes.find(item =>
    item?.scheduling_url === CALENDLY_URL
  );

  if (exactUrl) return exactUrl;

  const pressureWash = eventTypes.find(item =>
    /pressure|wash|clean/i.test(String(item?.name || "")) &&
    item?.uri
  );

  if (pressureWash) return pressureWash;

  if (eventTypes.length === 1) return eventTypes[0];

  throw new Error("Lucy could not identify the PEEK PRESSURE booking event in Calendly.");
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages.slice(-16).map(message => {
    const role = message?.role === "assistant" ? "assistant" : "user";

    const content = Array.isArray(message?.content)
      ? message.content
          .filter(part => {
            if (!part || typeof part !== "object") return false;
            if (part.type === "input_text") return typeof part.text === "string";
            if (part.type === "input_image") return typeof part.image_url === "string";
            return false;
          })
          .map(part => {
            if (part.type === "input_image") {
              return {
                type: "input_image",
                image_url: part.image_url,
                detail: "auto"
              };
            }

            return {
              type: "input_text",
              text: part.text.slice(0, 6000)
            };
          })
      : [{
          type: "input_text",
          text: String(message?.content || "").slice(0, 6000)
        }];

    return { role, content };
  });
}

const instructions = `
You are Lucy, the AI customer assistant for PEEK PRESSURE, a professional pressure-washing and exterior-cleaning business serving the San Francisco Bay Area.

Your job is to:
- Answer questions about pressure washing and PEEK PRESSURE services.
- Help customers describe what they need cleaned.
- Review attached property photos when provided.
- Gather enough information for PEEK PRESSURE to follow up.
- Be friendly, concise, professional, and conversational.
- Never invent a price. Explain that final pricing is confirmed by PEEK PRESSURE.
- Do not claim that a lead was emailed or submitted. The website handles that separately after the customer confirms their details.
- Do not ask for information you already have.
- Do not pressure the customer.
- If the customer wants to book, schedule, or choose a time, tell them that you can check current availability and show them available appointment times. Do not invent appointment times.
- Do not claim a booking is confirmed unless Calendly actually confirms it.
- If the customer asks to book but availability is not available to you, give them this Calendly link: ${CALENDLY_URL}

For a lead, collect when reasonably possible:
name, phone, email, service, location/address, property type, approximate size, surface, condition, timing, and any useful project question/details.

A lead is ready only when you have the customer's name AND at least one reliable contact method (phone or email), plus enough context to understand what they want cleaned. Prefer getting both phone and email when natural, but do not block a customer solely because they only want to provide one.

When a lead becomes ready, continue with a natural response, then return lead_ready=true and the structured lead data. The frontend will ask the customer to confirm the details before sending anything.

Treat suspicious, abusive, obviously fake, or irrelevant submissions as lead_status="uncertain" or "spam" rather than ready.

For images, describe only what can reasonably be observed. Do not pretend an image gives exact measurements or guarantees a cleaning result.

Return ONLY JSON matching the supplied schema.
`;

async function handleChat(context) {
  const OPENAI_API_KEY = context.env.OPENAI_API_KEY;
  const OPENAI_MODEL = context.env.OPENAI_MODEL || MODEL;

  if (!OPENAI_API_KEY) {
    return json({ error: "Lucy is not configured yet. Add OPENAI_API_KEY to Cloudflare." }, 500);
  }

  try {
    const body = await context.request.json();
    const messages = cleanMessages(body.messages);

    if (!messages.length) {
      return json({ error: "No conversation messages were provided." }, 400);
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions,
        input: messages,
        text: {
          format: {
            type: "json_schema",
            name: "lucy_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                reply: { type: "string" },
                lead_ready: { type: "boolean" },
                lead: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    lead_ready: { type: "boolean" },
                    lead_status: {
                      type: "string",
                      enum: ["real", "uncertain", "spam"]
                    },
                    name: { type: "string" },
                    phone: { type: "string" },
                    email: { type: "string" },
                    service: { type: "string" },
                    location: { type: "string" },
                    property_type: { type: "string" },
                    size: { type: "string" },
                    surface: { type: "string" },
                    condition: { type: "string" },
                    timing: { type: "string" },
                    question: { type: "string" }
                  },
                  required: [
                    "lead_ready",
                    "lead_status",
                    "name",
                    "phone",
                    "email",
                    "service",
                    "location",
                    "property_type",
                    "size",
                    "surface",
                    "condition",
                    "timing",
                    "question"
                  ]
                }
              },
              required: ["reply", "lead_ready", "lead"]
            }
          }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI Lucy error:", response.status, data);
      return json({
        error: data?.error?.message || "Lucy could not reach the AI service."
      }, response.status >= 400 && response.status < 500 ? response.status : 502);
    }

    let result;
    try {
      result = JSON.parse(data.output_text || "{}");
    } catch {
      console.error("Lucy JSON parse error:", data.output_text);
      return json({ error: "Lucy returned an invalid response. Please try again." }, 502);
    }

    const lead = result.lead || {};
    const leadReady = Boolean(
      result.lead_ready &&
      lead.lead_ready &&
      lead.lead_status === "real" &&
      String(lead.name || "").trim() &&
      (String(lead.phone || "").trim() || String(lead.email || "").trim())
    );

    return json({
      reply: String(result.reply || "").trim(),
      lead_ready: leadReady,
      lead: {
        ...lead,
        lead_ready: leadReady
      }
    });
  } catch (error) {
    console.error("Lucy chat handler error:", error);
    return json({ error: "Lucy hit a server error. Please try again." }, 500);
  }
}

async function createCalendlyBooking(context) {
  const token = context.env.CALENDLY_ACCESS_TOKEN;
  if (!token) return json({ error: "Calendly is not configured." }, 500);

  try {
    const body = await context.request.json();
    const eventType = String(body.event_type || "").trim();
    const startTime = String(body.start_time || "").trim();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const timezone = String(body.timezone || "America/Los_Angeles").trim();
    const phone = String(body.phone || "").trim();

    if (!eventType || !startTime || !name || !email) {
      return json({ error: "Name, email, event type, and appointment time are required." }, 400);
    }

    const invitee = { name, email, timezone };
    if (phone) invitee.text_reminder_number = phone;

    const response = await fetch(CALENDLY_API + "/invitees", {
      method: "POST",
      headers: calendlyHeaders(token),
      body: JSON.stringify({
        event_type: eventType,
        start_time: startTime,
        invitee
      })
    });

    let data = null;
    try { data = await response.json(); } catch {}

    if (!response.ok) {
      console.error("Calendly booking failed:", response.status, data);
      return json({
        error: data?.message || data?.title || "Calendly could not book that time.",
        calendly_status: response.status
      }, response.status === 403 ? 403 : 502);
    }

    return json({
      booked: true,
      invitee: data.resource,
      event: data.resource?.event || null,
      cancel_url: data.resource?.cancel_url || null,
      reschedule_url: data.resource?.reschedule_url || null
    }, 201);
  } catch (error) {
    console.error("Calendly booking error:", error);
    return json({ error: "Calendly could not complete the booking." }, 502);
  }
}

async function handleAvailability(context) {
  const token = context.env.CALENDLY_ACCESS_TOKEN;

  if (!token) {
    return json({
      error: "Calendly is not configured yet. Add CALENDLY_ACCESS_TOKEN as a Cloudflare Secret."
    }, 500);
  }

  try {
    const requestUrl = new URL(context.request.url);
    const timezone = requestUrl.searchParams.get("timezone") || "America/Los_Angeles";
    const eventType = await getPressureWashEventType(token);

    const now = new Date();
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      event_type: eventType.uri,
      start_time: now.toISOString(),
      end_time: end.toISOString()
    });

    const availability = await calendlyGet(
      token,
      `/event_type_available_times?${params.toString()}`
    );

    const slots = (Array.isArray(availability?.collection) ? availability.collection : [])
      .filter(slot => slot?.status === "available" && slot?.start_time)
      .slice(0, 8)
      .map(slot => ({
        start_time: slot.start_time,
        scheduling_url: slot.scheduling_url || CALENDLY_URL
      }));

    return json({
      available: slots.length > 0,
      timezone,
      event_type: {
        name: eventType.name || "PEEK PRESSURE appointment",
        uri: eventType.uri
      },
      slots
    });
  } catch (error) {
    console.error("Calendly availability error:", error);
    return json({
      error: "Lucy could not check Calendly availability right now."
    }, 502);
  }
}

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

async function handleLead(context) {
  const rate = checkLeadRateLimit(context.request);
  if (!rate.allowed) {
    return new Response(JSON.stringify({
      error: "Too many quote requests. Please try again later."
    }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(rate.retryAfter)
      }
    });
  }

  const RESEND_API_KEY = context.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    return json({
      error: "Email is not configured yet. Add RESEND_API_KEY to Cloudflare."
    }, 500);
  }

  try {
    const body = await context.request.json();
    const lead = body.lead || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-32) : [];

    const name = String(lead.name || "").trim();
    const phone = String(lead.phone || "").trim();
    const email = String(lead.email || "").trim();

    if (!name || (!phone && !email)) {
      return json({
        error: "A customer name and at least one contact method are required."
      }, 400);
    }

    if (lead.lead_status === "spam" || lead.lead_status === "uncertain") {
      return json({ error: "This lead was not eligible for email handoff." }, 400);
    }

    const transcript = messages
      .map(normalizeMessage)
      .filter(Boolean)
      .join("\n\n");

    const details = [
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
        <p style="margin-top:0;color:#666;">Captured and confirmed through Lucy.</p>
        <h3>Customer Details</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${detailsHtml}
        </table>
        <h3 style="margin-top:28px;">Full Chat History</h3>
        <div style="background:#f6f6f6;border:1px solid #e5e5e5;border-radius:10px;padding:16px;font-size:14px;line-height:1.6;">
          ${transcriptHtml}
        </div>
        <p style="margin-top:24px;font-weight:700;">
          Customer confirmed that PEEK PRESSURE should receive this information.
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
      "Customer confirmed that PEEK PRESSURE should receive this information."
    ].join("\n");

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
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

    const result = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend lead email failed:", resendResponse.status, result);
      return json({
        error: result?.message || result?.name || "Email provider rejected the lead."
      }, 502);
    }

    return json({
      sent: true,
      email_id: result?.id || null
    });
  } catch (error) {
    console.error("Lucy lead email handler error:", error);
    return json({ error: "The lead email could not be sent." }, 500);
  }
}

export async function onRequestGet(context) {
  const path = Array.isArray(context.params?.path) ? context.params.path.join("/") : String(context.params?.path || "");

  if (path === "availability") return handleAvailability(context);
  if (path === "book") return createCalendlyBooking(context);
  return json({ error: "Not found" }, 404);
}

export async function onRequestPost(context) {
  const path = Array.isArray(context.params?.path) ? context.params.path.join("/") : String(context.params?.path || "");

  if (path === "chat") return handleChat(context);
  if (path === "lead") return handleLead(context);
  return json({ error: "Not found" }, 404);
}
