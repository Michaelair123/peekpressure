const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LUCY_MODEL || "gpt-5.6-luna";

function json(res, status, body) {
  res.status(status).json(body);
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return json(res, 500, { error: "Lucy is not configured yet. Add OPENAI_API_KEY to the deployment environment." });
  }

  try {
    const body = req.body || {};
    const messages = cleanMessages(body.messages);

    if (!messages.length) {
      return json(res, 400, { error: "No conversation messages were provided." });
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
      return json(res, 502, {
        error: data?.error?.message || "Lucy could not reach the AI service."
      });
    }

    let result;
    try {
      result = JSON.parse(data.output_text || "{}");
    } catch (error) {
      console.error("Lucy JSON parse error:", data.output_text);
      return json(res, 502, { error: "Lucy returned an invalid response. Please try again." });
    }

    const lead = result.lead || {};
    const leadReady = Boolean(
      result.lead_ready &&
      lead.lead_ready &&
      lead.lead_status === "real" &&
      String(lead.name || "").trim() &&
      (String(lead.phone || "").trim() || String(lead.email || "").trim())
    );

    return json(res, 200, {
      reply: String(result.reply || "").trim(),
      lead_ready: leadReady,
      lead: {
        ...lead,
        lead_ready: leadReady
      }
    });
  } catch (error) {
    console.error("Lucy chat handler error:", error);
    return json(res, 500, {
      error: "Lucy hit a server error. Please try again."
    });
  }
};
