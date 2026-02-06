import { logger } from "@/utils/logger";
import { ZodError } from "zod";

export function globalErrorHandler() {
  return ({ error, request, store, set }: any) => {
    const requestId = store?.requestId ?? "unknown";

    // Normalize error structure
    let status = 500;
    let message = "Internal Server Error";
    let details: any = null;

    // -----------------------------
    // Zod validation errors
    // -----------------------------
    if (error instanceof ZodError) {
      status = 400;
      message = "Validation failed";
      details = error.flatten();
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
    }

    // -----------------------------
    // AWS SDK / S3 errors
    // -----------------------------
    else if (error.$metadata && error.$metadata.httpStatusCode) {
      status = error.$metadata.httpStatusCode;
      message = error.name ?? "S3 error";
      details = error.message;
    }

    // -----------------------------
    // Custom app errors
    // -----------------------------
    else if (error.status && error.message) {
      status = error.status;
      message = error.message;
      details = error.details ?? null;
    }

    // -----------------------------
    // Log the error
    // -----------------------------
    logger.info({
      requestId,
      request,
      url: request.url,
      method: request.method,
      status,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
    logger.error(
      {
        requestId,
        url: request.url,
        method: request.method,
        status,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      "Request error"
    );

    // -----------------------------
    // Production safety: hide details
    // -----------------------------
    const safeResponse =
      process.env.NODE_ENV === "production" ? { status, message } : { status, message, details };

    set.status = status;
    return safeResponse;
  };
}
