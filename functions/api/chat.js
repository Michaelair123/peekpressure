const SYSTEM_PROMPT = `
You are Lucy, PEEK PRESSURE's AI assistant and virtual team member for a Bay Area pressure-washing company.

PERSONALITY
- Your name is Lucy. If asked who you are, say you are Lucy, PEEK PRESSURE's AI assistant.
- Present Lucy as a young professional woman in her mid-30s: polished, approachable, calm, capable, and naturally personable.
- This is a communication style, not a claim that a real human employee is typing. If asked whether you are AI, be transparent that you are an AI assistant.
- Write like a real person texting a customer from a phone: conversational, fluid, and lightly imperfect rather than corporate or scripted.
- Use contractions naturally: "I'm", "I'll", "that's", "we'll", "you're".
- Prefer short messages and natural sentence rhythm. Mix short sentences with occasional slightly longer ones.
- It's okay to use an occasional "Yeah", "Absolutely", "Got it", "Sounds good", "Perfect", or "No problem" when it fits.
- Don't overuse exclamation points. Usually none or one per message.
- Use lowercase casually only when it feels natural; don't force internet slang.
- Avoid corporate filler like "Certainly", "I understand your inquiry", "Please be advised", "I'd be happy to assist", or "Thank you for reaching out."
- Avoid sounding like a teenager, influencer, salesperson, or chatbot trying to be cute.
- Avoid fake personal stories, claims of having physically visited a property, or pretending to have human experiences.
- Use 0–2 emojis only when they genuinely fit; keep them subtle and professional.
- Keep replies concise and easy to read on a phone. A normal reply is usually 1–4 short paragraphs or 1–3 sentences.
- Match the customer's energy without mirroring profanity or becoming unprofessional.
- Never be pushy. Answer the customer's actual question first, then naturally move the conversation forward.
- If the customer is casual, Lucy can be a little casual back. If they're formal, Lucy stays polished.
- Never sound like a form, scripted sales bot, or call center.

YOUR JOB
1. Help visitors understand PEEK PRESSURE's services.
2. Naturally qualify legitimate cleaning leads.
3. Collect enough information to make a useful quote request.
4. When the lead is ready, summarize it and mark it ready for PEEK PRESSURE follow-up.
5. Help customers check real Calendly availability and, when explicitly requested, book appointments directly.
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
- If they ask to book, schedule, or find a time, use the booking capability instead of merely giving the link.
- Never claim an appointment is available, booked, accepted, or scheduled unless the backend actually confirms it through Calendly.
- If the customer has not provided enough information to book, ask only for the missing name, email, or time preference.
- When real availability is returned, present a few clear options in the customer's local timezone.
- Only book an exact slot the backend has just verified as available.
- If direct booking is unavailable, gracefully provide the Calendly link instead.
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
- The backend can check live Calendly availability and book the customer.
- If the customer asks to see times, set action to "check_availability" and provide a useful future time window.
- If the customer chooses a specific previously offered time, set action to "book_appointment" and provide the exact selected_start_time in UTC.
- Never invent a slot. Never book unless the customer clearly asked to book that specific time.
- If name or email is missing for a booking, keep action as "none" and ask for the missing information.
- If no scheduling action is needed, action must be "none".
- If direct booking fails or the account does not permit it, the backend may return a Calendly fallback link.

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
    email: { type: ["string", "null"] },
    action: { type: "string", enum: ["none", "check_availability", "book_appointment"] },
    availability_start: { type: ["string", "null"] },
    availability_end: { type: ["string", "null"] },
    selected_start_time: { type: ["string", "null"] }
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
    "email",
    "action",
    "availability_start",
    "availability_end",
    "selected_start_time"
  ]
};

async function calendlyRequest(path, env, options = {}) {
  if (!env.CALENDLY_ACCESS_TOKEN) throw new Error("Calendly is not configured.");
  const response = await fetch("https://api.calendly.com" + path, {
    ...options,
    headers: {
      "Authorization": `Bearer ${env.CALENDLY_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const error = new Error(data?.message || `Calendly request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getPressureWashEventType(env) {
  const me = await calendlyRequest("/users/me", env);
  const userUri = me?.resource?.uri;
  if (!userUri) throw new Error("Calendly user could not be resolved.");

  const params = new URLSearchParams({
    user: userUri,
    active: "true",
    count: "100"
  });
  const events = await calendlyRequest("/event_types?" + params.toString(), env);
  const match = (events?.collection || []).find(event =>
    event.scheduling_url === "https://calendly.com/look-peekpressure/pressure-wash"
  );

  if (!match?.uri) throw new Error("Pressure Wash event type could not be found.");
  return match;
}

function formatSlot(iso, timezone) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function getAvailability(eventTypeUri, startTime, endTime, env) {
  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: startTime,
    end_time: endTime
  });
  const data = await calendlyRequest("/event_type_available_times?" + params.toString(), env);
  return data?.collection || [];
}

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
    const customerTimezone = "America/Los_Angeles";

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

    const now = new Date().toISOString();
    const schedulingContext = `
CURRENT TIME
- Current UTC time: ${now}
- Customer timezone: ${customerTimezone}

SCHEDULING ACTIONS
- action="none" for ordinary conversation.
- action="check_availability" only when the customer is asking for actual appointment times or clearly wants to schedule.
- For availability, availability_start and availability_end must be UTC ISO timestamps in the future and should cover the customer's requested window.
- action="book_appointment" only when the customer clearly selected a specific time and has supplied a usable name and email.
- For booking, selected_start_time must be the exact UTC timestamp of a slot previously offered in this conversation.
- If a requested time has not been checked/offered yet, use check_availability instead of booking.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5.6-luna",
        instructions: SYSTEM_PROMPT + "\n\n" + schedulingContext,
        input: safeMessages,
        text: {
          format: {
            type: "json_schema",
            name: "peek_ai_response",
            strict: true,
            schema: LEAD_SCHEMA
          }
        },
        max_output_tokens: 650
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
    let reply = result.reply;
    let scheduling = null;

    if (result.action === "check_availability") {
      try {
        const eventType = await getPressureWashEventType(env);
        let start = new Date(result.availability_start || now);
        let end = new Date(result.availability_end || (Date.now() + 7 * 86400000));

        if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
          start = new Date(Date.now() + 15 * 60000);
        }
        if (!Number.isFinite(end.getTime()) || end <= start) {
          end = new Date(start.getTime() + 7 * 86400000);
        }
        if (end.getTime() - start.getTime() > 31 * 86400000) {
          end = new Date(start.getTime() + 31 * 86400000);
        }

        const slots = await getAvailability(eventType.uri, start.toISOString(), end.toISOString(), env);
        const usable = slots
          .filter(slot => slot?.status === "available" && slot?.start_time)
          .slice(0, 5);

        scheduling = {
          action: "availability",
          slots: usable.map(slot => ({
            start_time: slot.start_time,
            formatted: formatSlot(slot.start_time, customerTimezone)
          }))
        };

        if (usable.length) {
          reply = `Absolutely 📅 I have these times available: ${usable.map((slot, i) => `${i + 1}. ${formatSlot(slot.start_time, customerTimezone)}`).join(" · ")}. Which one works best?`;
        } else {
          reply = "I’m not seeing an opening in that window. 📅 If you give me another day or time range, I can check again.";
        }
      } catch (error) {
        reply = "I can still get you booked through Calendly, but I’m having trouble checking live availability right now. 📅 Please use the booking link: https://calendly.com/look-peekpressure/pressure-wash";
      }
    }

    if (result.action === "book_appointment") {
      const name = (result.name || "").trim();
      const email = (result.email || "").trim();
      const selected = result.selected_start_time;

      if (!name || !email || !selected) {
        reply = "I just need your name and email before I can book that for you.";
      } else {
        try {
          const eventType = await getPressureWashEventType(env);
          const selectedDate = new Date(selected);
          if (!Number.isFinite(selectedDate.getTime()) || selectedDate.getTime() <= Date.now()) {
            throw new Error("Invalid booking time.");
          }

          const verificationStart = new Date(selectedDate.getTime() - 60000);
          const verificationEnd = new Date(selectedDate.getTime() + 60000);
          const slots = await getAvailability(
            eventType.uri,
            verificationStart.toISOString(),
            verificationEnd.toISOString(),
            env
          );
          const exactSlot = slots.find(slot => slot?.status === "available" && slot?.start_time === selectedDate.toISOString());

          if (!exactSlot) {
            reply = "That time was just taken. 😅 Give me another time and I’ll check what’s open.";
          } else {
            const booking = await calendlyRequest("/invitees", env, {
              method: "POST",
              body: JSON.stringify({
                event_type: eventType.uri,
                start_time: selectedDate.toISOString(),
                invitee: {
                  email,
                  name,
                  timezone: customerTimezone
                }
              })
            });

            const invitee = booking?.resource;
            scheduling = {
              action: "booked",
              start_time: selectedDate.toISOString(),
              formatted: formatSlot(selectedDate.toISOString(), customerTimezone),
              reschedule_url: invitee?.reschedule_url || null,
              cancel_url: invitee?.cancel_url || null
            };

            reply = `You’re all set, ${name.split(/\\s+/)[0]}! 📅 I booked you for ${formatSlot(selectedDate.toISOString(), customerTimezone)}. Calendly will send your confirmation shortly.`;
          }
        } catch (error) {
          if (error?.status === 403) {
            reply = "I’m not able to complete the booking directly from here yet. 📅 You can book the appointment securely through Calendly: https://calendly.com/look-peekpressure/pressure-wash";
          } else {
            reply = "I hit a snag while booking that time. 😅 Nothing was confirmed. Please try another time or use the Calendly booking link: https://calendly.com/look-peekpressure/pressure-wash";
          }
        }
      }
    }

    return Response.json({
      reply,
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
      },
      scheduling
    }, { headers: cors });

  } catch {
    return Response.json({ error: "Invalid chat request." }, { status: 400, headers: cors });
  }
}
