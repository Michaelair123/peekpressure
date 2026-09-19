import { LUCY_FAQ } from "./functions/api/faq.js";
import { onRequest as handleLucyRequest } from "./functions/api/chat.js";
import { onRequestGet as handleAvailability } from "./functions/api/availability.js";
import { onRequestPost as handleBooking } from "./functions/api/book.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const origin = request.headers.get("Origin");
    const allowedOrigin =
      origin === "https://www.peekpressure.com" || origin === "https://peekpressure.com"
        ? origin
        : "https://www.peekpressure.com";

    const cors = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Content-Type, X-Lucy-Staging-Token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        worker: "peekpressure",
        build: "2026-09-19-routing-check"
      });
    }

    if (url.pathname === "/api/faq") {
      return Response.json({ faq: LUCY_FAQ }, {
        headers: { ...cors, "Cache-Control": "public, max-age=300" }
      });
    }

    if (url.pathname === "/api/chat") {
      return handleLucyRequest({
        request,
        env,
        ctx,
        waitUntil: ctx.waitUntil.bind(ctx)
      });
    }

    if (url.pathname === "/api/availability" && request.method === "GET") {
      return handleAvailability({
        request,
        env,
        ctx,
        waitUntil: ctx.waitUntil.bind(ctx)
      });
    }

    if (url.pathname === "/api/book" && request.method === "POST") {
      return handleBooking({
        request,
        env,
        ctx,
        waitUntil: ctx.waitUntil.bind(ctx)
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
