import { logger } from "@/utils/logger";
import { AppError } from "@/utils/app-error";
import { httpErrorsCounter } from "@/middleware/matrics";
import { ZodError } from "zod";

export function globalErrorHandler() {
  return ({ error, request, store, set, path }: any) => {
    const requestId = store?.requestId ?? "unknown";

    let status = 500;
    let message = "Internal Server Error";
    let details: unknown = null;
    // Whether `message` is safe to send verbatim in production. Everything
    // defaults to hidden — only branches below that set a curated, non-leaky
    // message opt in.
    let exposeMessage = false;

    // -----------------------------
    // Zod validation errors
    // -----------------------------
    if (error instanceof ZodError) {
      status = 400;
      message = "Validation failed";
      details = error.flatten();
      exposeMessage = true;
    }

    // -----------------------------
    // Drizzle / Postgres errors
    // -----------------------------
    else if (error.name === "DrizzleError" || error.name === "PostgresError") {
      status = 500;
      message = "Database operation failed";
      details = {
        code: error.code,
        originalMessage: error.message,
        query: error.query,
      };
      exposeMessage = true;
    }

    // -----------------------------
    // AWS SDK / S3 errors
    // -----------------------------
    else if (error.$metadata && error.$metadata.httpStatusCode) {
      status = error.$metadata.httpStatusCode;
      message = error.name ?? "S3 error";
      details = error.message;
      exposeMessage = true;
    }

    // -----------------------------
    // Elysia's own built-in errors (bad route params/body against a `t.*`
    // schema, unknown route, malformed body, bad signed cookie, wrong file
    // type). These already carry the correct status — framework-computed,
    // not user input reflected back — so the message is safe to expose.
    // -----------------------------
    else if (
      typeof error.status === "number" &&
      [
        "VALIDATION",
        "NOT_FOUND",
        "PARSE",
        "INVALID_COOKIE_SIGNATURE",
        "INVALID_FILE_TYPE",
      ].includes(error.code)
    ) {
      status = error.status;
      message =
        error.code === "VALIDATION"
          ? "Validation failed"
          : error.code === "NOT_FOUND"
            ? "Route not found"
            : error.message;
      details = error.code === "VALIDATION" ? (error.all ?? error.message) : error.message;
      exposeMessage = true;
    }

    // -----------------------------
    // Our own operational errors (AppError and subclasses)
    // -----------------------------
    else if (error instanceof AppError) {
      status = error.status;
      message = error.message;
      details = error.details ?? null;
      exposeMessage = error.isOperational;
    }

    // -----------------------------
    // Log the error — 4xx are client-caused noise, 5xx are ours
    // -----------------------------
    const logPayload = {
      requestId,
      url: request.url,
      method: request.method,
      status,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    if (status >= 500) {
      logger.error(logPayload, "Request error");
    } else {
      logger.warn(logPayload, "Request error");
    }

    httpErrorsCounter.inc({ method: request.method, route: path ?? request.url, status });

    // -----------------------------
    // Production safety: never leak internals for non-operational errors
    // -----------------------------
    const safeMessage =
      process.env.NODE_ENV === "production" && !exposeMessage ? "Internal Server Error" : message;

    const safeResponse =
      process.env.NODE_ENV === "production"
        ? { status: "error", message: safeMessage }
        : {
            status: "error",
            message: safeMessage,
            details,
            // Always the real error, regardless of classification above — for local debugging only.
            debug: { rawMessage: error.message, stack: error.stack },
          };

    set.status = status;
    return safeResponse;
  };
}
