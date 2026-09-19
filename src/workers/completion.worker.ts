import { getDb } from "@/clients/db.client";
import UploadRepository from "@/repositories/upload.repository";
import PartRepository from "@/repositories/part.repository";
import EventRepository from "@/repositories/event.repository";
import { S3StorageStrategy } from "@/strategies/s3.storage";
import { env } from "@/utils/env";
import { logger } from "@/utils/logger";

class CompletionWorker {
  private db = getDb();
  private uploadRepo = new UploadRepository(this.db);
  private partRepo = new PartRepository(this.db);
  private eventRepo = new EventRepository(this.db);
  private storage = new S3StorageStrategy();

  async sweep() {
    const expired = await this.uploadRepo.findExpiredUploads();

    if (expired.length === 0) return;

    logger.info({ count: expired.length }, "Sweeping expired uploads");

    for (const upload of expired) {
      try {
        if (upload.s3UploadId && upload.s3KeyPrefix) {
          const key = `${upload.s3KeyPrefix}${upload.filename}`;
          await this.storage
            .abortMultipartUpload({ key, uploadId: upload.s3UploadId })
            .catch((err) =>
              logger.warn({ uploadId: upload.id, err }, "Failed to abort expired S3 upload")
            );
        }

        await this.partRepo.deleteParts(upload.id);
        await this.uploadRepo.markCanceled(upload.id, {
          lastError: "Expired — abandoned upload",
        });
        await this.eventRepo.log(upload.id, "UPLOAD_EXPIRED", {});

        logger.info({ uploadId: upload.id }, "Expired upload cleaned up");
      } catch (err) {
        logger.error({ uploadId: upload.id, err }, "Failed to clean up expired upload");
      }
    }
  }

  async run() {
    logger.info({ intervalMs: env.CLEANUP_INTERVAL_MS }, "Completion worker started");

    await this.sweep();
    setInterval(() => {
      this.sweep().catch((err) => logger.error({ err }, "Sweep failed"));
    }, env.CLEANUP_INTERVAL_MS);
  }
}

new CompletionWorker().run();
