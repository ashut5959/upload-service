import { AppError } from "@/utils/app-error";

// Wraps an async controller method so any rejection — including a thrown
// non-Error value, which Elysia's onError and our AppError checks don't
// expect — reaches the global error handler as a proper Error instance.
export const catchAsync = <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => {
  return async (...args: Args): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AppError || err instanceof Error) throw err;
      throw new Error(typeof err === "string" ? err : JSON.stringify(err));
    }
  };
};
