import { onRequest as handleLucyRequest } from "./functions/api/chat.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      return handleLucyRequest({ request, env, ctx, waitUntil: ctx.waitUntil.bind(ctx) });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
