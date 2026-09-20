import { logger } from "@/utils/logger";

// Last-resort safety net for errors that escape every try/catch and Elysia's
// own request-lifecycle handling (e.g. background worker ticks). Logs with
// full context, then exits so the process supervisor (k8s) restarts a clean
// instance rather than letting it keep running in an unknown state.
export function registerProcessErrorHandlers(processName: string) {
  process.on("uncaughtException", (err) => {
    logger.error({ err, process: processName }, "Uncaught exception — exiting");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason, process: processName }, "Unhandled promise rejection — exiting");
    process.exit(1);
  });
}
