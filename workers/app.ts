import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// Matches the public submission endpoint: /api/forms/:formId/submissions
const SUBMISSION_PATH = /^\/api\/forms\/([^/]+)\/submissions\/?$/;

// Same shape as the endpoint's own errors, plus CORS headers, because this
// response is produced before React Router (and therefore before the route's
// own CORS handling) runs.
function rateLimitedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: "Too many requests. Please try again in a few seconds.",
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "10",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Accept",
        "access-control-max-age": "86400",
      },
    },
  );
}

export default {
  async fetch(request, env, ctx) {
    // Cap submissions per client IP and form. This runs inside the Worker, so
    // it also covers callers that never load the form page. Counters are per
    // Cloudflare location and eventually consistent — an approximation, like
    // the zone-level WAF rate limiting rule that runs before it.
    if (request.method === "POST") {
      const match = SUBMISSION_PATH.exec(new URL(request.url).pathname);
      const limiter = env.SUBMISSION_LIMITER;
      if (match && limiter) {
        const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
        const { success } = await limiter.limit({
          key: `${clientIp}:${match[1]}`,
        });
        if (!success) {
          return rateLimitedResponse();
        }
      }
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
