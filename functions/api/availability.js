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

  if (!userUri) {
    throw new Error("Calendly did not return the connected user.");
  }

  const params = new URLSearchParams({
    user: userUri,
    active: "true",
    count: "100"
  });

  const eventTypesData = await calendlyGet(
    token,
    `/event_types?${params.toString()}`
  );

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
    /pressure|wash|clean/i.test(String(item?.name || "")) && item?.uri
  );

  if (pressureWash) return pressureWash;

  if (eventTypes.length === 1) return eventTypes[0];

  throw new Error("Lucy could not identify the PEEK PRESSURE booking event in Calendly.");
}

export async function onRequestGet(context) {
  const token = context.env.CALENDLY_ACCESS_TOKEN;

  if (!token) {
    return json({
      error: "Calendly is not configured yet. Add CALENDLY_ACCESS_TOKEN as a Cloudflare Secret."
    }, 500);
  }

  try {
    const requestUrl = new URL(context.request.url);
    const timezone =
      requestUrl.searchParams.get("timezone") || "America/Los_Angeles";

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

    const slots = (Array.isArray(availability?.collection)
      ? availability.collection
      : []
    )
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
