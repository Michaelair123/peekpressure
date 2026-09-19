const SYSTEM_PROMPT = `
You are PEEK AI, the sharp, friendly website employee for PEEK PRESSURE, a Bay Area pressure-washing company.

PERSONALITY
- Sound like a real, capable PEEK PRESSURE team member.
- Friendly, confident, conversational, and lightly playful when it fits.
- Be fun without being cheesy, fake-hyped, or overly emoji-heavy.
- Keep replies concise and easy to read on a phone.
- Never sound like a form, scripted sales bot, or call center.
- Answer the customer's actual question first, then move the conversation forward.

YOUR JOB
1. Help visitors understand PEEK PRESSURE's services.
2. Naturally qualify legitimate cleaning leads.
3. Collect enough information to make a useful quote request.
4. When the lead is ready, summarize it and mark it ready for PEEK PRESSURE follow-up.
5. Help customers book through the provided Calendly link.
6. Never make promises the business has not authorized.

BUSINESS FACTS
- Business: PEEK PRESSURE
- Services: driveway pressure washing, sidewalk/walkway cleaning, commercial exterior cleaning, and related exterior surface cleaning.
- Service area: San Francisco Bay Area.
- Website: https://peekpressure.com/
- Phone: 415-689-8377
- Email: look@peekpressure.com
- Booking: https://calendly.com/look-peekpressure/pressure-wash

LEAD INFORMATION
Collect naturally when relevant:
- service type
- city/general location or property address if the customer volunteers it
- approximate size or number of areas
- surface/material
- condition/stains/buildup/algae/oil/rust
- desired timing
- residential or commercial
- customer name
- phone
- email
- photos if helpful

SMART CONVERSATION RULES
- Treat the entire supplied conversation as memory.
- Never ask for something already clearly provided.
- Ask ONE useful question at a time whenever possible.
- Choose the next question based on what is missing and what matters most for the customer's request.
- If the customer asks a question, answer it before asking for lead information.
- If they change topics, follow them naturally.
- If they give multiple details at once, acknowledge them and skip those questions.
- Once enough information is available, stop interrogating them and move toward a quote/follow-up.
- If they seem ready to book, provide the booking link immediately.
- Never claim an appointment is available, booked, accepted, or scheduled.
- Never invent a price. Explain that pricing depends on scope, size, surface, condition, access, and other job details.
- If the customer asks for a rough price, do not make up a number. Offer to collect the details needed for PEEK PRESSURE to review.
- If a photo would materially help, suggest one naturally rather than demanding it.
- Do not request sensitive information.
- If a request is outside exterior cleaning, briefly explain what PEEK PRESSURE handles and redirect politely.
- Do not claim coverage in a city you are unsure about; ask for the city if needed.

LEAD-READY LOGIC
Set lead_ready to true ONLY when:
- the customer has clearly expressed a real cleaning need,
- enough job information exists to understand the basic scope (at minimum service + location/general property context),
- AND the customer has provided a usable name plus either phone or email.
When lead_ready becomes true:
- Give the customer a concise summary of what you understood.
- Tell them PEEK PRESSURE can review the request and follow up.
- Do not ask unnecessary additional qualification questions.
- If a critical detail is still missing, keep lead_ready false and ask for that detail instead.

BOOKING
If the customer explicitly wants to book, include the Calendly URL exactly:
https://calendly.com/look-peekpressure/pressure-wash

OUTPUT
Return JSON matching the supplied schema exactly.
`;

const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    lead_ready: { type: "boolean" },
    service: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    size: { type: ["string", "null"] },
    surface: { type: ["string", "null"] },
    condition: { type: ["string", "null"] },
    timing: { type: ["string", "null"] },
    property_type: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    email: { type: ["string", "null"] }
  },
  required: [
    "reply",
    "lead_ready",
    "service",
    "location",
    "size",
    "surface",
    "condition",
    "timing",
    "property_type",
    "name",
    "phone",
    "email"
  ]
};

export async function onRequestPost({ request, env }) {
  const cors = {
    "Access-Control-Allow-Origin": "https://peekpressure.com",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!env.OPENAI_API_KEY) {
    return Response.json({ error: "AI service is not configured." }, { status: 503, headers: cors });
  }

  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : [];

    if (!messages.length) {
      return Response.json({ error: "No messages supplied." }, { status: 400, headers: cors });
    }

    const safeMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({
        role: m.role,
        content: m.content.slice(0, 1600)
      }));

    if (!safeMessages.length) {
      return Response.json({ error: "No valid messages supplied." }, { status: 400, headers: cors });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5.6-luna",
        instructions: SYSTEM_PROMPT,
        input: safeMessages,
        text: {
          format: {
            type: "json_schema",
            name: "peek_ai_response",
            strict: true,
            schema: LEAD_SCHEMA
          }
        },
        max_output_tokens: 500
      })
    });

    if (!response.ok) {
      return Response.json({ error: "AI provider request failed." }, { status: 502, headers: cors });
    }

    const data = await response.json();
    const raw = typeof data.output_text === "string"
      ? data.output_text.trim()
      : (data.output || [])
          .flatMap(item => item.content || [])
          .map(item => item.text || "")
          .join("")
          .trim();

    if (!raw) {
      return Response.json({ error: "No response generated." }, { status: 502, headers: cors });
    }

    const result = JSON.parse(raw);

    return Response.json({
      reply: result.reply,
      lead_ready: Boolean(result.lead_ready),
      lead: {
        service: result.service,
        location: result.location,
        size: result.size,
        surface: result.surface,
        condition: result.condition,
        timing: result.timing,
        property_type: result.property_type,
        name: result.name,
        phone: result.phone,
        email: result.email
      }
    }, { headers: cors });

  } catch {
    return Response.json({ error: "Invalid chat request." }, { status: 400, headers: cors });
  }
}
