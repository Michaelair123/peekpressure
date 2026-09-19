const COMPETITOR_SEEDS = [
  { name: "EcoWash SF", url: "https://www.ecowashsf.com/" },
  { name: "FreshTouchSF Home Services", url: "https://freshtouchsf.com/pressure-washing" },
  { name: "Bay Area Exterior Cleaning", url: "https://www.bayareaexteriorcleaning.com/blog/pressure-washing-cost-san-jose-bay-area" },
  { name: "Willow Wash", url: "https://round-panda-bdp3.squarespace.com/pressure-washing-cost-bay-area" }
];

const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    observations: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      competitor: { type: "string" }, service: { type: "string" }, published_price: { type: "string" }, evidence: { type: "string" }, source_url: { type: "string" }
    }, required: ["competitor", "service", "published_price", "evidence", "source_url"] } },
    proposal: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      service: { type: "string" }, proposed_price: { type: "string" }, rationale: { type: "string" }, confidence: { type: "string", enum: ["low", "medium", "high"] }
    }, required: ["service", "proposed_price", "rationale", "confidence"] } },
    guardrails: { type: "array", items: { type: "string" } }
  },
  required: ["summary", "observations", "proposal", "guardrails"]
};

const cors = {
  "Access-Control-Allow-Origin": "https://peekpressure.com",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function unauthorized(request, env) {
  const expected = env.COMPETITIVE_REVIEW_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get("Authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return supplied !== expected;
}

export async function onRequestPost({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (unauthorized(request, env)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: cors });
  if (!env.OPENAI_API_KEY) return Response.json({ error: "AI service is not configured." }, { status: 503, headers: cors });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5.6-luna",
        tools: [{
          type: "web_search",
          search_context_size: "high",
          user_location: { type: "approximate", city: "San Francisco", region: "California", country: "US", timezone: "America/Los_Angeles" }
        }],
        instructions: "You are Lucy, the internal competitive-pricing analyst for PEEK PRESSURE, a Bay Area exterior-cleaning company.\n\n" +
          "This is INTERNAL research only. Use public web information. Do not contact competitors, submit forms, create accounts, bypass robots.txt/access controls, or use private information.\n\n" +
          "Research current Bay Area pressure washing/exterior-cleaning pricing. Prefer direct competitor pricing pages over generic national calculators. Verify important claims against source pages.\n\n" +
          "Your job is to PROPOSE pricing changes for the OWNER to review. Never say a proposal is approved. Analyze driveway pressure washing, sidewalk/walkway cleaning, patio/flatwork, commercial exterior/flatwork where public pricing exists, plus minimums, packages, discounts and add-ons.\n\n" +
          "Rules: distinguish direct competitor pricing from generic estimates; never invent prices or square footage; if pricing is not published say Not publicly listed; give more weight to recent direct Bay Area pricing; do not recommend prices solely because they are cheaper; proposed prices should normally be ranges; every observation needs a source URL; keep the report concise.\n\n" +
          "Seed competitors: " + JSON.stringify(COMPETITOR_SEEDS) + "\n\nReturn only the supplied JSON schema.",
        input: "Run the latest Bay Area competitive pricing review for PEEK PRESSURE. Focus on public information available now and label uncertain or indirect evidence.",
        text: { format: { type: "json_schema", name: "competitive_pricing_review", strict: true, schema: REVIEW_SCHEMA } },
        max_output_tokens: 2200
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return Response.json({ error: "AI provider request failed.", detail: text.slice(0, 500) }, { status: 502, headers: cors });
    }

    const data = await response.json();
    const raw = typeof data.output_text === "string" ? data.output_text.trim() : (data.output || []).flatMap(item => item.content || []).map(item => item.text || "").join("").trim();
    if (!raw) return Response.json({ error: "No review generated." }, { status: 502, headers: cors });

    const review = JSON.parse(raw);
    return Response.json({ generated_at: new Date().toISOString(), review }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "Competitive review failed.", detail: error?.message || "Unknown error" }, { status: 500, headers: cors });
  }
}