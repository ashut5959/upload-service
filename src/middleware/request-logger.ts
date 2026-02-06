import { logger } from "@/utils/logger";

export const requestLogger = {
  before: (ctx: any) => {
    ctx.store.start = performance.now();
  },
  after: (ctx: any) => {
    const duration = performance.now() - (ctx.store.start ?? performance.now());
    logger.info({
      requestId: ctx.store.requestId,
      method: ctx.request.method,
      path: ctx.path,
      status: ctx.set.status ?? 200,
      durationMs: duration.toFixed(2),
    });
  },
};
