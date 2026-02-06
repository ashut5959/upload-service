import { Elysia } from "elysia";
import uploadRoutes from "@/routes/upload.route";
import { env } from "@/utils/env";
import { logger } from "@/utils/logger";
import {
  rateLimiter,
  requestIdMiddleware,
  requestLogger,
  httpRequestCounter,
  httpRequestDuration,
  metricsRouteHandler,
  bodyLimit,
  secureCors,
  sanitizer,
  globalErrorHandler,
} from "@/middleware";
import { closeDb, getDb } from "@/clients/db.client";
import cookie from "@elysiajs/cookie";
import cors from "@elysiajs/cors";

const app = new Elysia()
  .use(
    cors({
      origin: "http://localhost:5173",
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    })
  )
  .use(cookie())
  .state({
    start: 0,
    requestId: "",
  })
  .onBeforeHandle(bodyLimit(1024 * 1024).before)
  // .onBeforeHandle(rateLimiter(100, 1000).before)
  .onBeforeHandle(sanitizer.before)

  .onAfterHandle((ctx) => {
    const route = ctx.route ?? ctx.path;
    const durationSec = (performance.now() - (ctx.store.start ?? performance.now())) / 1000;

    httpRequestDuration.observe({ method: ctx.request.method, route }, durationSec);

    httpRequestCounter.inc({
      method: ctx.request.method,
      route,
      status: ctx.set.status ?? 200,
    });

    requestLogger.after(ctx);
  })

  .onError(({ error, request }) => {
    logger.error({ err: error, url: request.url }, "Unhandled error in Upload Service");
    return {
      status: "error",
      message: env.NODE_ENV === "production" ? "Internal Server Error" : error,
    };
  })

  // Health
  .get("/", () => ({ service: "Upload Service", status: "OK" }))
  .get("/health", () => ({ status: "OK" }))
  .get("/ready", () => ({ ready: true }))
  .get("/metrics", metricsRouteHandler)
  .get("/version", () => ({ version: "1.0.0" }))
  .get("/info", () => ({ info: "Upload Service" }))
  .onError(globalErrorHandler())

  // Domain routes
  .use(uploadRoutes);

// graceful shutdown
app.onStop(async () => {
  logger.info("Shutting down Upload Service...");
  await closeDb();
});

app.listen(env.PORT);
logger.info(`🚀 Upload Service running on port ${env.PORT}`);
