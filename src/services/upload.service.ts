import type UploadRepository from "@/repositories/upload.repository";
import type { ListUploadsFilter } from "@/repositories/upload.repository";
import type PartRepository from "@/repositories/part.repository";
import type EventRepository from "@/repositories/event.repository";
import type StorageStrategy from "@/strategies/storage.strategy";
import type {
  InitUploadRequestDto,
  InitUploadResponseDto,
  PartCompleteRequestDto,
  PartCompleteResponseDto,
} from "@/dtos/upload.dto";
import { redisLock } from "@/redis/redislock";
import { randomUUID } from "crypto";
import { logger } from "@/utils/logger";
import { env } from "@/utils/env";

export default class UploadService {
  constructor(
    private uploadRepo: UploadRepository,
    private partRepo: PartRepository,
    private storage: StorageStrategy,
    private eventRepo: EventRepository
  ) {}

  async initUpload(data: InitUploadRequestDto): Promise<InitUploadResponseDto> {
    // 1️⃣ RESUME PATH
    if (data.uploadId) {
      const existing = await this.uploadRepo.getUpload(data.uploadId);

      if (!existing) {
        throw new Error("UPLOAD_NOT_FOUND");
      }

      // verify multipart upload still exists in S3
      const existsInS3 = await this.storage.checkMultipartUpload({
        bucket: existing.s3Bucket,
        key: existing.s3KeyPrefix + existing.filename,
        uploadId: existing.s3UploadId,
      });

      if (!existsInS3) {
        // 🔥 Recovery: recreate multipart upload
        const s3 = await this.storage.createMultipartUpload({
          filename: existing.filename,
          contentType: existing.contentType ?? "application/octet-stream",
          keyPrefix: existing.s3KeyPrefix,
        });

        await this.uploadRepo.updateS3UploadId(existing.id, s3.uploadId);
        existing.s3UploadId = s3.uploadId;
      }

      // return resume info
      return {
        instantUpload: false,
        uploadId: existing.id,
        bucket: existing.s3Bucket,
        key: existing.s3KeyPrefix,
        chunkSize: existing.chunkSize,
        totalParts: existing.totalParts,
        uploadedParts: await this.partRepo.getParts(existing.id),
        message: "Upload resumed",
      };
    }

    // 2️⃣ INSTANT UPLOAD — a completed upload with identical content already exists
    // anywhere in the system; skip the S3 multipart session entirely.
    const duplicate = await this.uploadRepo.getCompletedByContentHash(data.contentHash);
    if (duplicate) {
      return {
        instantUpload: true,
        uploadId: duplicate.id,
        finalKey: duplicate.finalS3Key!,
        etag: duplicate.etag!,
        message: "Instant upload — file already exists",
      };
    }

    // 3️⃣ NEW UPLOAD PATH — validate against S3 hard limits and service policy
    if (data.size > env.MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(
        `FILE_TOO_LARGE: size ${data.size} exceeds maximum of ${env.MAX_UPLOAD_SIZE_BYTES} bytes`
      );
    }

    if (env.ALLOWED_CONTENT_TYPES) {
      const allowed = env.ALLOWED_CONTENT_TYPES.split(",").map((t) => t.trim());
      if (!allowed.includes(data.contentType)) {
        throw new Error(`CONTENT_TYPE_NOT_ALLOWED: ${data.contentType}`);
      }
    }

    const totalParts = Math.ceil(data.size / data.chunkSize);

    if (totalParts > env.MAX_PARTS) {
      throw new Error(
        `TOO_MANY_PARTS: ${totalParts} parts exceeds S3's limit of ${env.MAX_PARTS}; increase chunkSize`
      );
    }

    if (totalParts > 1 && data.chunkSize < env.MIN_PART_SIZE_BYTES) {
      throw new Error(
        `CHUNK_SIZE_TOO_SMALL: chunkSize must be at least ${env.MIN_PART_SIZE_BYTES} bytes for multi-part uploads`
      );
    }

    const uploadId = randomUUID();
    const keyPrefix = `uploads/${uploadId}/`;

    // create multipart upload in S3
    const s3 = await this.storage.createMultipartUpload({
      filename: data.filename,
      contentType: data.contentType,
      keyPrefix,
    });

    // persist upload — roll back the S3 session if the DB write fails, so we
    // never leave an untracked multipart upload accumulating storage costs
    try {
      await this.uploadRepo.createUpload({
        id: uploadId,
        uploadedById: data.uploadedById,
        uploadedByType: data.uploadedByType,
        tenantId: data.tenantId || null,
        filename: data.filename,
        contentType: data.contentType,
        size: data.size,
        chunkSize: data.chunkSize,
        totalParts,
        contentHash: data.contentHash,
        s3Bucket: s3.bucket,
        s3KeyPrefix: keyPrefix,
        s3UploadId: s3.uploadId,
        state: "INIT",
        metadata: data.metadata || {},
        expiresAt: new Date(Date.now() + env.UPLOAD_EXPIRY_HOURS * 60 * 60 * 1000),
      });
    } catch (err) {
      logger.error(
        { uploadId, err },
        "Failed to persist upload record; aborting orphaned S3 upload"
      );
      await this.storage
        .abortMultipartUpload({ key: s3.key, uploadId: s3.uploadId })
        .catch((abortErr) =>
          logger.error({ uploadId, abortErr }, "Failed to abort orphaned S3 multipart upload")
        );
      throw err;
    }

    return {
      instantUpload: false,
      uploadId,
      bucket: s3.bucket,
      key: s3.key,
      chunkSize: data.chunkSize,
      totalParts,
      uploadedParts: [],
      message: "Upload initialized",
    };
  }

  async presignPart(uploadId: string, data: { partNumber: number }) {
    const partNumber = Number(data.partNumber);

    if (!partNumber || partNumber < 1) {
      throw new Error("Invalid part number");
    }

    // 1️⃣ Fetch upload from DB
    const upload = await this.uploadRepo.getUpload(uploadId);
    if (!upload) throw new Error("Upload not found");

    if (!upload.s3UploadId) throw new Error("Upload missing S3 UploadId");

    // Validate part number
    if (partNumber > upload.totalParts) {
      throw new Error("Part number exceeds totalParts");
    }

    const key = `${upload.s3KeyPrefix}${upload.filename}`;

    logger.info({
      uploadId,
      partNumber,
      key,
      bucket: upload.s3Bucket,
    });

    // 2️⃣ Generate presigned URL
    const { url } = await this.storage.presignPart({
      bucket: upload.s3Bucket,
      key,
      uploadId: upload.s3UploadId, // AWS UploadId, NOT our internal uploadId
      partNumber,
    });

    return { url };
  }

  async partComplete(
    uploadId: string,
    data: PartCompleteRequestDto
  ): Promise<PartCompleteResponseDto & { autoCompleted: boolean }> {
    const upload = await this.uploadRepo.getUpload(uploadId);
    if (!upload) throw new Error("Upload not found");
    if (!upload.s3UploadId) throw new Error("Upload missing S3 UploadId");

    const key = `${upload.s3KeyPrefix}${upload.filename}`;

    // Trust S3, not the client: fetch the authoritative ETag/size for this part
    const verified = await this.storage.getUploadedPart({
      key,
      uploadId: upload.s3UploadId,
      partNumber: data.PartNumber,
    });

    if (!verified) {
      throw new Error(`PART_NOT_FOUND_IN_S3: part ${data.PartNumber} was not found on S3`);
    }

    if (verified.etag !== data.ETag) {
      throw new Error(`ETAG_MISMATCH: reported ETag does not match the part S3 actually received`);
    }

    await this.partRepo.savePart(uploadId, data.PartNumber, verified.etag, verified.size);

    // Recount from real rows rather than incrementing, so retries can't inflate this past totalParts
    const uploadedParts = await this.partRepo.countParts(uploadId);
    await this.uploadRepo.setUploadedParts(uploadId, uploadedParts);

    await this.eventRepo.log(uploadId, "PART_COMPLETED", {
      partNumber: data.PartNumber,
      size: verified.size,
    });

    logger.debug({ uploadId, uploadedParts, totalParts: upload.totalParts });

    let autoCompleted = false;

    if (uploadedParts === upload.totalParts) {
      try {
        await this.completeUpload(uploadId);
        autoCompleted = true;
      } catch (err) {
        // Best-effort: log and let the client still call /complete explicitly
        logger.warn({ uploadId, err }, "Auto-complete after last part failed");
      }
    }

    return {
      message: "Part uploaded successfully",
      uploadedParts,
      totalParts: upload.totalParts,
      autoCompleted,
    };
  }

  async completeUpload(uploadId: string) {
    return redisLock(`upload:${uploadId}:complete`, async () => {
      // 1️⃣ Fetch upload record
      const upload = await this.uploadRepo.getUpload(uploadId);
      if (!upload) throw new Error("Upload not found");

      // Idempotent: auto-complete (from the last part) and an explicit client
      // call can race — a second call just returns the already-completed result
      if (upload.state === "COMPLETED") {
        return {
          status: "completed" as const,
          uploadId,
          finalKey: upload.finalS3Key!,
          etag: upload.etag!,
        };
      }

      if (!upload.s3UploadId) {
        throw new Error("S3 uploadId missing — cannot complete multipart upload");
      }

      // 2️⃣ Fetch all parts from DB
      const parts = await this.partRepo.listParts(uploadId);

      if (parts.length === 0) {
        throw new Error("No uploaded parts found");
      }

      // 3️⃣ Validate number of parts
      if (parts.length !== upload.totalParts) {
        throw new Error(
          `Upload incomplete: expected ${upload.totalParts}, but only ${parts.length} parts uploaded`
        );
      }

      // 3️⃣.5 Validate total uploaded bytes match the declared file size
      const totalUploadedSize = parts.reduce((sum, p) => sum + (p.size ?? 0), 0);
      if (totalUploadedSize !== upload.size) {
        throw new Error(
          `SIZE_MISMATCH: expected ${upload.size} bytes but uploaded parts total ${totalUploadedSize} bytes`
        );
      }

      // 4️⃣ Transform parts → S3 format
      const formattedParts = parts
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        }));

      logger.info({
        uploadId,
        parts: formattedParts,
        key: `${upload.s3KeyPrefix}${upload.filename}`,
      });

      // 5️⃣ Call S3 CompleteMultipartUpload
      const result = await this.storage.completeMultipartUpload({
        key: `${upload.s3KeyPrefix}${upload.filename}`,
        uploadId: upload.s3UploadId,
        parts: formattedParts,
      });

      // 6️⃣ Update DB → COMPLETED
      await this.uploadRepo.markCompleted(uploadId, {
        etag: result.ETag,
        finalS3Key: `${upload.s3KeyPrefix}${upload.filename}`,
      });

      // 7️⃣ Emit event
      await this.eventRepo.log(uploadId, "UPLOAD_COMPLETED", { etag: result.ETag });

      return {
        status: "completed" as const,
        uploadId,
        finalKey: `${upload.s3KeyPrefix}${upload.filename}`,
        etag: result.ETag,
      };
    });
  }

  async cancelUpload(uploadId: string) {
    return redisLock(`upload:${uploadId}:cancel`, async () => {
      // 1. Fetch upload
      const upload = await this.uploadRepo.getUpload(uploadId);
      if (!upload) {
        // idempotent: if no upload, treat as already canceled
        return { status: "not_found" as const, uploadId };
      }

      // If already canceled or completed, return early
      if (upload.state === "CANCELED") {
        return { status: "already_canceled" as const, uploadId };
      }
      if (upload.state === "COMPLETED") {
        return { status: "already_completed" as const, uploadId };
      }

      // 2. If S3 upload session exists, abort it
      try {
        if (upload.s3UploadId && upload.s3KeyPrefix) {
          const key = `${upload.s3KeyPrefix}${upload.filename}`;
          await this.storage.abortMultipartUpload({
            key,
            uploadId: upload.s3UploadId,
          });
        }
      } catch (err: unknown) {
        // log the error, mark the upload with lastError but keep going with DB update
        // so system remains in a consistent state; you can also rethrow to fail the abort.
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error({ uploadId, errorMessage }, "S3 abort failed for upload");
        await this.uploadRepo.markCanceled(uploadId, {
          lastError: errorMessage,
        });
        await this.eventRepo.log(uploadId, "UPLOAD_CANCEL_FAILED", { error: errorMessage });
        // Option: rethrow if you want the caller to retry
        return { status: "s3_abort_failed" as const, uploadId, error: errorMessage };
      }

      // 3. Delete parts rows (optional)
      try {
        await this.partRepo.deleteParts(uploadId);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn({ uploadId, errorMessage }, "Failed to delete part rows for");
        // non-fatal: continue
      }

      // 4. Mark upload row as CANCELED
      await this.uploadRepo.markCanceled(uploadId);

      // 5. Emit event
      await this.eventRepo.log(uploadId, "UPLOAD_CANCELED", {});

      return { status: "canceled" as const, uploadId };
    });
  }

  async getStatus(uploadId: string) {
    const upload = await this.uploadRepo.getUpload(uploadId);
    if (!upload) throw new Error("Upload not found");

    const parts = await this.partRepo.listParts(uploadId);

    return {
      uploadId: upload.id,
      state: upload.state,
      filename: upload.filename,
      contentType: upload.contentType,
      size: upload.size,
      chunkSize: upload.chunkSize,
      totalParts: upload.totalParts,
      uploadedParts: upload.uploadedParts ?? 0,
      parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag, size: p.size })),
      createdAt: upload.createdAt,
      updatedAt: upload.updatedAt,
      expiresAt: upload.expiresAt,
    };
  }

  async listUploads(filter: ListUploadsFilter) {
    return this.uploadRepo.listUploads(filter);
  }

  async getDownloadUrl(uploadId: string) {
    const upload = await this.uploadRepo.getUpload(uploadId);
    if (!upload) throw new Error("Upload not found");

    if (upload.state !== "COMPLETED" || !upload.finalS3Key) {
      throw new Error(
        "UPLOAD_NOT_COMPLETED: cannot download a file that hasn't finished uploading"
      );
    }

    return this.storage.presignGetObject({ key: upload.finalS3Key });
  }
}
