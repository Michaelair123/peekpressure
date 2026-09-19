const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.LUCY_TO_EMAIL || "look@peekpressure.com";
const FROM_EMAIL = process.env.LUCY_FROM_EMAIL || "PEEK PRESSURE <onboarding@resend.dev>";

function json(res, status, body) {
  res.status(status).json(body);
}

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!RESEND_API_KEY) {
    return json(res, 500, {
      error: "Email is not configured yet. Add RESEND_API_KEY to the deployment environment."
    });
  }

  try {
    const body = req.body || {};
    const lead = body.lead || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-32) : [];

    const name = String(lead.name || "").trim();
    const phone = String(lead.phone || "").trim();
    const email = String(lead.email || "").trim();

    if (!name || (!phone && !email)) {
      return json(res, 400, {
        error: "A customer name and at least one contact method are required."
      });
    }

    if (lead.lead_status === "spam" || lead.lead_status === "uncertain") {
      return json(res, 400, {
        error: "This lead was not eligible for email handoff."
      });
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
      return json(res, 502, {
        error: result?.message || result?.name || "Email provider rejected the lead."
      });
    }

    return json(res, 200, {
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
