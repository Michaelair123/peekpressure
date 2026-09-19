import { LUCY_FAQ } from "./functions/api/faq.js";
import { onRequest as handleLucyRequest } from "./functions/api/chat.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/faq") {
      return Response.json({ faq: LUCY_FAQ }, {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "https://peekpressure.com"
        }
      });
    }

    if (url.pathname === "/api/chat") {
      return handleLucyRequest({ request, env, ctx, waitUntil: ctx.waitUntil.bind(ctx) });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
