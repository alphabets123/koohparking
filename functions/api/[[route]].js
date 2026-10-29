/**
 * Cloudflare Pages Function: [[route]].js
 * Reverse Proxy for Koo Hospital Parking System (211.105.143.22)
 * Uses FQDN (sslip.io) to prevent Cloudflare Error 1003 (Direct IP access denied).
 */

const TARGET_HOST = "http://211.105.143.22.sslip.io";

export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Cookie, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  // Determine subpath (/api/login -> /login/identify, etc.)
  const pathParts = params.route || [];
  const action = pathParts.join("/");

  let targetUrl = "";
  let method = request.method;
  let headers = new Headers();
  headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // Forward incoming Cookie if present
  const incomingCookie = request.headers.get("Cookie");
  if (incomingCookie) {
    headers.set("Cookie", incomingCookie);
  }

  let body = null;

  try {
    if (action === "login") {
      targetUrl = `${TARGET_HOST}/login/identify`;
      const data = await request.json();
      const id = data.id || "";
      const pw = data.pw || "";
      const bs = btoa(pw);

      headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
      body = new URLSearchParams({ id, pw: "", bs }).toString();
      method = "POST";
    } 
    else if (action === "searchcar") {
      targetUrl = `${TARGET_HOST}/discount/searchcar`;
      const data = await request.json();
      headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
      body = new URLSearchParams({ carnum: data.carnum || "" }).toString();
      method = "POST";
    }
    else if (action === "inimage") {
      const xindex = url.searchParams.get("xindex") || "";
      targetUrl = `${TARGET_HOST}/discount/InImage?xindex=${encodeURIComponent(xindex)}`;
      method = "GET";
    }
    else if (action === "discountinfo") {
      targetUrl = `${TARGET_HOST}/discount/discountinfo`;
      method = "GET";
    }
    else if (action === "occupantdiscount") {
      targetUrl = `${TARGET_HOST}/discount/occupantdiscount`;
      method = "POST";
    }
    else if (action === "discountrecords") {
      targetUrl = `${TARGET_HOST}/discount/discountrecords`;
      const data = await request.json();
      headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
      body = new URLSearchParams({ xindex: data.xindex || "" }).toString();
      method = "POST";
    }
    else if (action === "insert") {
      targetUrl = `${TARGET_HOST}/discount/insert`;
      const data = await request.json();
      headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
      body = new URLSearchParams({
        carnum: data.carnum || "",
        carfullnum: data.carfullnum || "",
        xindex: data.xindex || "",
        discountcode: data.discountcode || "",
        note: data.note || ""
      }).toString();
      method = "POST";
    }
    else if (action === "delete") {
      targetUrl = `${TARGET_HOST}/discount/delete`;
      const data = await request.json();
      headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
      body = new URLSearchParams({
        idx: data.idx || "",
        xcompany: data.xcompany || "",
        xindex: data.xindex || ""
      }).toString();
      method = "POST";
    }
    else {
      return new Response(JSON.stringify({ error: "Unknown API route: " + action }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const fetchOptions = { method, headers };
    if (body) {
      fetchOptions.body = body;
    }

    const upstreamRes = await fetch(targetUrl, fetchOptions);

    const resHeaders = new Headers();
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");

    const setCookie = upstreamRes.headers.get("Set-Cookie");
    if (setCookie) {
      resHeaders.set("Set-Cookie", setCookie);
    }

    const contentType = upstreamRes.headers.get("Content-Type") || "";
    resHeaders.set("Content-Type", contentType);

    if (contentType.includes("image/")) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: resHeaders
      });
    }

    const resText = await upstreamRes.text();
    return new Response(resText, {
      status: upstreamRes.status,
      headers: resHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
