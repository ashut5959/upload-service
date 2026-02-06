import { rateLimiter } from "@/middleware";

export function uploadTestRateLimit() {
  // Limit: 1 request per second for testing slow uploads
  const limiter = rateLimiter(1, 1000);

  return {
    beforeHandle: (ctx: any) => limiter.before(ctx),
  };
}

export function uploadDelay(ms: number = 1500) {
  return {
    async beforeHandle() {
      await new Promise((res) => setTimeout(res, ms));
    },
  };
}
