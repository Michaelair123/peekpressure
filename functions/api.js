const MODEL = "gpt-5.6-luna";

function json(body, status = 200) { return Response.json(body, { status }); }

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
      : [{ type: "input_text", text: String(message?.content || "").slice(0, 6000) }];

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

For a lead, collect when reasonably possible:
name, phone, email, service, location/address, property type, approximate size, surface, condition, timing, and any useful project question/details.

A lead is ready only when you have the customer's name AND at least one reliable contact method (phone or email), plus enough context to understand what they want cleaned. Prefer getting both phone and email when natural, but do not block a customer solely because they only want to provide one.

When a lead becomes ready, continue with a natural response, then return lead_ready=true and the structured lead data. The frontend will ask the customer to confirm the details before sending anything.

Treat suspicious, abusive, obviously fake, or irrelevant submissions as lead_status="uncertain" or "spam" rather than ready.

For images, describe only what can reasonably be observed. Do not pretend an image gives exact measurements or guarantees a cleaning result.

Return ONLY JSON matching the supplied schema.
`;

async function handleChat(context) {\n  const OPENAI_API_KEY = context.env.OPENAI_API_KEY;\n  if (!OPENAI_API_KEY) return json({ error: "Lucy is not configured yet. Add OPENAI_API_KEY to Cloudflare." }, 500);\n  try {\n    const body = await context.request.json();
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
        model: MODEL,
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
                    lead_status: { type: "string", enum: ["real", "uncertain", "spam"] },
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
      });
    }

    let result;
    try {
      result = JSON.parse(data.output_text || "{}");
    } catch (error) {
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
    return json({ error: "Lucy hit a server error. Please try again." }, 500);\n  }\n}\n

const TO_EMAIL = "look@peekpressure.com";\nconst FROM_EMAIL = "PEEK PRESSURE <look@peekpressure.com>";

function json(body, status = 200) { return Response.json(body, { status }); }

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

async function handleLead(context) {\n  const RESEND_API_KEY = context.env.RESEND_API_KEY;\n  if (!RESEND_API_KEY) return json({ error: "Email is not configured yet. Add RESEND_API_KEY to Cloudflare." }, 500);\n  try {\n    const body = await context.request.json();
    const lead = body.lead || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-32) : [];

    const name = String(lead.name || "").trim();
    const phone = String(lead.phone || "").trim();
    const email = String(lead.email || "").trim();

    if (!name || (!phone && !email)) {
      return json({ error: "A customer name and at least one contact method are required." }, 400);
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
      return json({ error: result?.message || result?.name || "Email provider rejected the lead." }, 502);
    }

    return json({
      sent: true,
      email_id: result?.id || null
    });
  } catch (error) {
    console.error("Lucy lead email handler error:", error);
    return json(res, 500, {
      error: "The lead email could not be sent."
    });
  }
};


export async function onRequestPost(context) {
  const path = new URL(context.request.url).pathname.replace(//+$/, "");
  if (path === "/api/chat") return handleChat(context);
  if (path === "/api/lead") return handleLead(context);
  return json({ error: "Not found" }, 404);
}
