import { LUCY_FAQ } from "./functions/api/faq.js";
import { onRequest as handleLucyRequest } from "./functions/api/chat.js";
import { onRequestPost as handleLead } from "./functions/api/[[path]].js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const origin = request.headers.get("Origin");
    const allowedOrigin =
      origin === "https://www.peekpressure.com" || origin === "https://peekpressure.com"
        ? origin
        : "https://www.peekpressure.com";

    const securityHeaders = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
    };

    const withSecurity = (response) => {
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) {
        headers.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    };

    const cors = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Content-Type, X-Lucy-Staging-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: cors });
    }

    const withCors = (response) => {
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) {
        headers.set(key, value);
      }
      for (const [key, value] of Object.entries(cors)) {
        headers.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    };

    const edgeClientKey = request.headers.get("CF-Connecting-IP") || "unknown-client";

    const enforceEdgeLimit = async (limiter, route) => {
      if (!limiter) return true;
      const result = await limiter.limit({
        key: route + ":" + edgeClientKey
      });
      return result.success;
    };

    const edgeRateLimitResponse = () => new Response(
      JSON.stringify({ error: "Too many requests. Please try again shortly." }),
      {
        status: 429,
        headers: {
          ...cors,
          ...securityHeaders,
          "Content-Type": "application/json",
          "Retry-After": "10",
          "Cache-Control": "no-store"
        }
      }
    );

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        worker: "peekpressure",
        build: "2026-09-19-security-hardening"
      }, { headers: { ...cors, ...securityHeaders, "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/api/faq") {
      return Response.json({ faq: LUCY_FAQ }, {
        headers: { ...cors, ...securityHeaders, "Cache-Control": "public, max-age=300" }
      });
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        const allowed = await enforceEdgeLimit(env.LUCY_EDGE_BURST, "chat");
        if (!allowed) return edgeRateLimitResponse();
      }
      return withCors(await handleLucyRequest({ request, env, ctx, waitUntil: ctx.waitUntil.bind(ctx) }));
    }

    if (url.pathname === "/api/lead" && request.method === "POST") {
      const allowed = await enforceEdgeLimit(env.LEAD_EDGE_BURST, "lead");
      if (!allowed) return edgeRateLimitResponse();

      return withCors(await handleLead({
        request,
        env,
        ctx,
        params: { path: ["lead"] },
        waitUntil: ctx.waitUntil.bind(ctx)
      }));
    }

    if (env.ASSETS) {
      return withSecurity(await env.ASSETS.fetch(request));
    }

    return withSecurity(new Response("Not Found", { status: 404 }));
  }
};
