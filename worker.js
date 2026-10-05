import { LUCY_FAQ } from "./functions/api/faq.js";
import { onRequest as handleLucyRequest } from "./functions/api/chat.js";
import { onRequestPost as handleLead } from "./functions/api/[[path]].js";
import { LucyMemory } from "./functions/lucy-memory.js";

export { LucyMemory };

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const item = part.trim();
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator) === name) return decodeURIComponent(item.slice(separator + 1));
  }
  return "";
}

function isValidLucySession(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function attachLucySession(response, sessionId, shouldSetCookie) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  if (shouldSetCookie) {
    headers.append(
      "Set-Cookie",
      "__Host-lucy_session=" + encodeURIComponent(sessionId) + "; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Strict"
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const origin = request.headers.get("Origin");
    const isAllowedOrigin =
      origin === "https://www.peekpressure.com" || origin === "https://peekpressure.com";
    const allowedOrigin = isAllowedOrigin ? origin : null;

    const securityHeaders = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-DNS-Prefetch-Control": "on"
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

    const withHtmlSecurity = (response) => {
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(securityHeaders)) {
        headers.set(key, value);
      }

      const contentType = headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      const nonce = crypto.randomUUID();
      headers.set(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "script-src 'nonce-" + nonce + "' 'strict-dynamic'",
          "style-src 'self' 'nonce-" + nonce + "' https://cdn.jsdelivr.net",
          "img-src 'self' data: blob: https://lirp.cdn-website.com https://cdn.prod.website-files.com https://images.squarespace-cdn.com https://images.unsplash.com https://images.pexels.com https://www.bestpowerwashli.com https://www.sftravel.com https://upload.wikimedia.org https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
          "font-src 'self'",
          "connect-src 'self'",
          "frame-src https://www.google.com https://calendly.com",
          "form-action 'self' https://formspree.io",
          "manifest-src 'self'",
          "upgrade-insecure-requests"
        ].join("; ")
      );

      return new HTMLRewriter()
        .on("script", {
          element(element) {
            element.setAttribute("nonce", nonce);
          }
        })
        .on("style", {
          element(element) {
            element.setAttribute("nonce", nonce);
          }
        })
        .transform(new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        }));
    };

    const cors = isAllowedOrigin ? {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Content-Type, X-Lucy-Staging-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Vary": "Origin"
    } : {};

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      if (!isAllowedOrigin) return new Response(null, { status: 403, headers: securityHeaders });
      return new Response(null, {
        status: 204,
        headers: { ...cors, ...securityHeaders }
      });
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
        build: "2026-10-05-site-audit"
      }, { headers: { ...cors, ...securityHeaders, "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/api/faq") {
      return Response.json({ faq: LUCY_FAQ }, {
        headers: { ...cors, ...securityHeaders, "Cache-Control": "public, max-age=300" }
      });
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        const stagingToken = env.LUCY_STAGING_TOKEN;
        const isStaging = Boolean(stagingToken) && request.headers.get("X-Lucy-Staging-Token") === stagingToken;
        if (!isStaging) {
          const allowed = await enforceEdgeLimit(env.LUCY_EDGE_BURST, "chat");
          if (!allowed) return edgeRateLimitResponse();
        }
      }

      let lucySessionId = getCookie(request, "__Host-lucy_session");
      const setLucySession = !isValidLucySession(lucySessionId);
      if (setLucySession) lucySessionId = crypto.randomUUID();

      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("X-Lucy-Session-ID", lucySessionId);
      const sessionRequest = new Request(request, { headers: requestHeaders });
      const chatResponse = await handleLucyRequest({
        request: sessionRequest,
        env,
        ctx,
        waitUntil: ctx.waitUntil.bind(ctx)
      });
      return withCors(attachLucySession(chatResponse, lucySessionId, setLucySession));
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
      return withHtmlSecurity(await env.ASSETS.fetch(request));
    }

    return withSecurity(new Response("Not Found", { status: 404 }));
  }
};
