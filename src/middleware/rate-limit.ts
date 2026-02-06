export const rateLimiter = (limit = 20, windowMs = 1000) => {
  const map = new Map<string, { count: number; ts: number }>();

  return {
    before: (ctx: any) => {
      const ip = ctx.request.headers.get("x-forwarded-for") || (ctx.request as any).ip || "unknown";

      const now = Date.now();
      const entry = map.get(ip) || { count: 0, ts: now };

      if (now - entry.ts > windowMs) {
        entry.count = 0;
        entry.ts = now;
      }

      entry.count++;

      map.set(ip, entry);

      if (entry.count > limit) {
        return new Response("Too Many Requests", { status: 429 });
      }
    },
  };
};
