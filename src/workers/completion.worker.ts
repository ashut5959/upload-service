import { logger } from "@/utils/logger";

class CompletionWorker {
  //   private uploadService = new UploadService();

  async run() {
    logger.info("Worker started");
    // TODO: poll queue or scan DB for pending completion
  }
}

new CompletionWorker().run();
