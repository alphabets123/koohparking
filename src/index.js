import { onRequest } from "../functions/api/[[route]].js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Route /api/* requests to our proxy function
    if (url.pathname.startsWith("/api/")) {
      const subpath = url.pathname.replace(/^\/api\/?/, "");
      const route = subpath ? subpath.split("/") : [];
      return onRequest({
        request,
        env,
        params: { route },
        waitUntil: (promise) => ctx.waitUntil(promise)
      });
    }

    // Static assets fallback if called directly
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  }
};
