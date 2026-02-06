import { collectDefaultMetrics, Counter, Histogram, register } from "prom-client";

collectDefaultMetrics(); // Node metrics: CPU, memory, event loop

export const httpRequestCounter = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Request duration in seconds",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2],
});

export const metricsRecorder = {
  after: (ctx: any) => {
    const route = ctx.route ?? ctx.path;
    const method = ctx.request.method;
    const status = ctx.set.status ?? 200;

    // Increment counter
    httpRequestCounter.inc({ method, route, status });

    // Record latency
    const durationSec = (performance.now() - (ctx.store.start ?? performance.now())) / 1000;

    httpRequestDuration.observe({ method, route }, durationSec);
  },
};

export const metricsRouteHandler = async () =>
  new Response(await register.metrics(), {
    headers: { "Content-Type": register.contentType },
  });
