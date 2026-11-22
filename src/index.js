export default {
  async fetch(request, env, ctx) {
    const TUNNEL_HOST = "web.mickey.qzz.io"; // <-- Replace with your Tunnel hostname
    const TIMEOUT_MS = 3000;
    const url = new URL(request.url);

    // 1. DEBUG ENDPOINT: /tunnel
    if (url.pathname === "/tunnel") {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`https://${TUNNEL_HOST}/`, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const latencyMs = Date.now() - startTime;
        const isHealthy = res.status !== 530 && res.status < 502;

        return Response.json(
          {
            status: isHealthy ? "healthy" : "unhealthy",
            activeBackend: isHealthy ? "Cloudflare-Tunnel" : "VYUHAA-Fallback-HTML",
            tunnelHost: TUNNEL_HOST,
            httpStatus: res.status,
            latencyMs,
            checkedAt: new Date().toISOString(),
          },
          { status: isHealthy ? 200 : 503 }
        );
      } catch (err) {
        clearTimeout(timeoutId);
        return Response.json(
          {
            status: "unhealthy",
            activeBackend: "VYUHAA-Fallback-HTML",
            tunnelHost: TUNNEL_HOST,
            error: err.name === "AbortError" ? `Timeout after ${TIMEOUT_MS}ms` : err.message,
            latencyMs: Date.now() - startTime,
            checkedAt: new Date().toISOString(),
          },
          { status: 503 }
        );
      }
    }

    // 2. TRY CLOUDFLARE TUNNEL
    const tunnelUrl = new URL(request.url);
    tunnelUrl.hostname = TUNNEL_HOST;

    const tunnelRequest = new Request(tunnelUrl.toString(), request.clone());
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(tunnelRequest, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status === 530 || response.status >= 502) {
        throw new Error(`Tunnel unhealthy: HTTP ${response.status}`);
      }

      const healthyResponse = new Response(response.body, response);
      healthyResponse.headers.set("X-Served-By", "Cloudflare-Tunnel");
      return healthyResponse;
    } catch (err) {
      clearTimeout(timeoutId);
      // Tunnel is down or timed out — fall through to static assets
    }

    // 3. FALLBACK: SERVE public/index.html
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      const fallbackResponse = new Response(assetResponse.body, assetResponse);
      fallbackResponse.headers.set("X-Served-By", "VYUHAA-Fallback-HTML");
      return fallbackResponse;
    }

    return new Response("Fallback assets binding not configured.", { status: 500 });
  },
};
