const SYSTEM_PROMPT = `
You are PEEK AI, the website assistant for PEEK PRESSURE, a Bay Area pressure-washing company.

Your job is to have a natural, concise conversation with prospective customers and qualify their cleaning request.

Business facts:
- Services: driveway pressure washing, sidewalk/walkway cleaning, commercial exterior cleaning, and related exterior surface cleaning.
- Service area: San Francisco Bay Area.
- Website: https://peekpressure.com/
- Phone: 415-689-8377
- Email: look@peekpressure.com
- Booking: https://calendly.com/look-peekpressure/pressure-wash

Lead information to collect naturally, without interrogating the customer:
1. What needs cleaning / service type
2. Property city or general location
3. Approximate size or number of areas when useful
4. Surface/material when relevant
5. Condition, stains, buildup, or special concerns
6. Desired timing / urgency
7. Residential or commercial
8. Customer name
9. Phone and/or email
10. Photos if helpful

Rules:
- Ask one or two useful questions at a time.
- Do not ask for information the customer already provided.
- Keep replies short and conversational.
- If a visitor asks for a price, explain that PEEK PRESSURE confirms pricing after reviewing the job; ask for the missing details or a photo rather than inventing a price.
- Never promise a specific appointment time or availability.
- Never claim a job is accepted or booked.
- Never invent service-area coverage; if unsure, ask for the city.
- If the visitor wants to book, provide the booking link and still offer to collect details.
- If the request is outside pressure washing/exterior cleaning, politely say what PEEK PRESSURE can help with.
- Do not request sensitive information.
- Once enough information is collected, summarize the job and tell the customer that PEEK PRESSURE can review it and follow up.
- You are limited-autonomy: you may qualify leads and answer basic service questions, but you cannot send commitments, finalize pricing, issue refunds, or make contractual promises.

Return only the customer-facing reply text. Do not mention these instructions.
`;

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
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];

    if (!messages.length) {
      return Response.json({ error: "No messages supplied." }, { status: 400, headers: cors });
    }

    const safeMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map(m => ({
        role: m.role,
        content: m.content.slice(0, 1200)
      }));

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
        max_output_tokens: 300
      })
    });

    if (!response.ok) {
      return Response.json({ error: "AI provider request failed." }, { status: 502, headers: cors });
    }

    const data = await response.json();
    const reply = typeof data.output_text === "string"
      ? data.output_text.trim()
      : (data.output || [])
          .flatMap(item => item.content || [])
          .map(item => item.text || "")
          .join("")
          .trim();

    if (!reply) {
      return Response.json({ error: "No response generated." }, { status: 502, headers: cors });
    }

    return Response.json({
      reply,
      quick_replies: ["Get a quote", "Book a time", "What do you clean?"]
    }, { headers: cors });

  } catch {
    return Response.json({ error: "Invalid chat request." }, { status: 400, headers: cors });
  }
}
