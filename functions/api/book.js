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

export async function onRequestPost(context) {
  const token = context.env.CALENDLY_ACCESS_TOKEN;

  if (!token) {
    return json({ error: "Calendly is not configured." }, 500);
  }

  try {
    const body = await context.request.json();

    const eventType = String(body.event_type || "").trim();
    const startTime = String(body.start_time || "").trim();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const timezone = String(
      body.timezone || "America/Los_Angeles"
    ).trim();
    const phone = String(body.phone || "").trim();

    if (!eventType || !startTime || !name || !email) {
      return json({
        error: "Name, email, event type, and appointment time are required."
      }, 400);
    }

    const invitee = { name, email, timezone };

    if (phone) {
      invitee.text_reminder_number = phone;
    }

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
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      console.error("Calendly booking failed:", response.status, data);

      return json({
        error:
          data?.message ||
          data?.title ||
          "Calendly could not book that time.",
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
    return json({
      error: "Calendly could not complete the booking."
    }, 502);
  }
}
