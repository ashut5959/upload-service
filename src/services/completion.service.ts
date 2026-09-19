import type UploadRepository from "@/repositories/upload.repository";
import type EventRepository from "@/repositories/event.repository";
import type StorageStrategy from "@/strategies/storage.strategy";
import type { UploadRow } from "@/repositories/upload.repository";
import { stagingKeyPrefix, permanentKeyPrefix } from "@/utils/s3-keys";
import { env } from "@/utils/env";
import { logger } from "@/utils/logger";

export interface FileValidationResult {
  valid: boolean;
  reason?: string;
}

export default class CompletionService {
  constructor(
    private uploadRepo: UploadRepository,
    private storage: StorageStrategy,
    private eventRepo: EventRepository
  ) {}

  // Generic, file-type-agnostic gate — currently a stub that always passes.
  // A real implementation would dispatch on `upload.contentType` (CSV row
  // validation, malware/virus scanning, media integrity checks, zip-bomb
  // detection, magic-byte/MIME verification, etc.); none of that exists yet,
  // and none of it belongs in the generic upload service itself — those are
  // separate, downstream consumers of a COMPLETED file.
  private async validate(_upload: UploadRow): Promise<FileValidationResult> {
    return { valid: true };
  }

  async finalizeUpload(uploadId: string): Promise<void> {
    const upload = await this.uploadRepo.getUpload(uploadId);
    if (!upload) return;
    if (upload.state === "COMPLETED" || upload.state === "VALIDATION_FAILED") return;

    if (upload.state === "STAGED") {
      // Atomic claim — protects against another worker process racing this same upload.
      const claimed = await this.uploadRepo.markValidating(uploadId);
      if (!claimed) return;
    } else if (upload.state !== "VALIDATING") {
      return; // INIT / UPLOADING / FAILED / CANCELED — nothing to finalize
    }

    const stagingKey = `${stagingKeyPrefix(uploadId)}${upload.filename}`;
    const permanentKey = `${permanentKeyPrefix(uploadId)}${upload.filename}`;

    try {
      const result = await this.validate(upload);

      if (!result.valid) {
        await this.storage
          .deleteObject({ bucket: upload.s3Bucket, key: stagingKey })
          .catch((err) =>
            logger.warn({ uploadId, err }, "Failed to delete staging object after rejection")
          );

        await this.uploadRepo.markValidationFailed(uploadId, {
          lastError: result.reason ?? "validation failed",
        });
        await this.eventRepo.log(uploadId, "UPLOAD_VALIDATION_FAILED", {
          reason: result.reason,
        });
        return;
      }

      // Crash-recovery: a prior run may have already copied the object before
      // crashing (see the ordering note below), so don't blindly re-copy.
      const already = await this.storage.headObject({ bucket: env.S3_BUCKET, key: permanentKey });

      if (!already.exists) {
        await this.storage.copyObject({
          sourceBucket: upload.s3Bucket,
          sourceKey: stagingKey,
          destBucket: env.S3_BUCKET,
          destKey: permanentKey,
        });
      }

      // Verify before recording success — never trust that the copy landed.
      const verified = await this.storage.headObject({
        bucket: env.S3_BUCKET,
        key: permanentKey,
      });
      if (!verified.exists) {
        throw new Error("PROMOTION_VERIFY_FAILED: permanent object missing after copy");
      }

      // copy → verify → mark COMPLETED → delete staging, in that order and never
      // reversed: the DB write only happens once the permanent object is
      // confirmed to exist, so a crash can never leave the file with zero
      // surviving copies. A failed staging delete after this point must not
      // undo COMPLETED — the permanent object + DB row are already authoritative.
      await this.uploadRepo.markCompleted(uploadId, {
        bucket: env.S3_BUCKET,
        etag: verified.etag ?? "",
        finalS3Key: permanentKey,
      });
      await this.eventRepo.log(uploadId, "UPLOAD_COMPLETED", { etag: verified.etag });

      await this.storage
        .deleteObject({ bucket: upload.s3Bucket, key: stagingKey })
        .catch((err) => logger.warn({ uploadId, err }, "Staging cleanup failed after promotion"));
    } catch (err) {
      // Includes OBJECT_TOO_LARGE_FOR_SINGLE_COPY — logged and left in VALIDATING
      // (retried every poll tick) rather than marked failed or losing the staged file.
      logger.error({ uploadId, err }, "Upload finalization failed");
    }
  }
}
