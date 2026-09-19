import { getDb } from "@/clients/db.client";
import UploadRepository from "@/repositories/upload.repository";
import PartRepository from "@/repositories/part.repository";
import EventRepository from "@/repositories/event.repository";
import { S3StorageStrategy } from "@/strategies/s3.storage";
import CompletionService from "@/services/completion.service";
import { env } from "@/utils/env";
import { logger } from "@/utils/logger";

class CompletionWorker {
  private db = getDb();
  private uploadRepo = new UploadRepository(this.db);
  private partRepo = new PartRepository(this.db);
  private eventRepo = new EventRepository(this.db);
  private storage = new S3StorageStrategy();
  private completionService = new CompletionService(this.uploadRepo, this.storage, this.eventRepo);

  // Guards against this same worker process re-entering finalizeUpload() for an
  // upload it's still processing from a previous poll tick — a multi-GB copy can
  // easily take longer than STAGED_POLL_INTERVAL_MS. The DB-level markValidating()
  // compare-and-swap separately protects against *other* worker processes racing.
  private inFlight = new Set<string>();

  async sweep() {
    const expired = await this.uploadRepo.findExpiredUploads();

    if (expired.length === 0) return;

    logger.info({ count: expired.length }, "Sweeping expired uploads");

    for (const upload of expired) {
      try {
        if (upload.s3UploadId && upload.s3KeyPrefix) {
          const key = `${upload.s3KeyPrefix}${upload.filename}`;
          await this.storage
            .abortMultipartUpload({ bucket: upload.s3Bucket, key, uploadId: upload.s3UploadId })
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

  async promoteStaged() {
    const pending = await this.uploadRepo.findUploadsPendingFinalization();

    for (const upload of pending) {
      if (this.inFlight.has(upload.id)) continue;

      this.inFlight.add(upload.id);
      this.completionService
        .finalizeUpload(upload.id)
        .catch((err) => logger.error({ uploadId: upload.id, err }, "Finalization failed"))
        .finally(() => this.inFlight.delete(upload.id));
    }
  }

  async run() {
    logger.info(
      {
        cleanupIntervalMs: env.CLEANUP_INTERVAL_MS,
        stagedPollIntervalMs: env.STAGED_POLL_INTERVAL_MS,
      },
      "Completion worker started"
    );

    await this.sweep();
    setInterval(() => {
      this.sweep().catch((err) => logger.error({ err }, "Sweep failed"));
    }, env.CLEANUP_INTERVAL_MS);

    await this.promoteStaged();
    setInterval(() => {
      this.promoteStaged().catch((err) => logger.error({ err }, "Staged promotion tick failed"));
    }, env.STAGED_POLL_INTERVAL_MS);
  }
}

new CompletionWorker().run();
