import type UploadRepository from "@/repositories/upload.repository";
import type PartRepository from "@/repositories/part.repository";
import type StorageStrategy from "@/strategies/storage.strategy";
import { redisLock } from "@/redis/redislock";
import { randomUUID } from "crypto";
import { logger } from "@/utils/logger";

export default class UploadService {
  constructor(
    private uploadRepo: UploadRepository,
    private partRepo: PartRepository,
    private storage: StorageStrategy
  ) {}

  // async initUpload(data: any) {
  //     const uploadId = randomUUID();
  //     const keyPrefix = `uploads/${uploadId}/`;
  //     const totalParts = Math.ceil(data.size / data.chunkSize);
  //     // 1️⃣ Create DB record (INIT state)
  //     await this.uploadRepo.createUpload({
  //         id: uploadId,

  //         uploadedById: data.uploadedById,
  //         uploadedByType: data.uploadedByType,
  //         tenantId: data.tenantId || null,

  //         filename: data.filename,
  //         contentType: data.contentType,
  //         size: data.size,
  //         chunkSize: data.chunkSize,
  //         totalParts,

  //         s3Bucket: data.s3Bucket || "",          // temporary
  //         s3KeyPrefix: keyPrefix,
  //         s3UploadId: "pending",

  //         state: "INIT",
  //         metadata: data.metadata || {},
  //     });

  //     // 2️⃣ Create Multipart Upload in S3
  //     const s3 = await this.storage.createMultipartUpload({
  //         filename: data.filename,
  //         contentType: data.contentType,
  //         keyPrefix,
  //     });

  //     // 3️⃣ Update DB with S3 UploadId
  //     await this.uploadRepo.updateS3UploadId(uploadId, s3.uploadId);

  //     // 4️⃣ Return Upload Info to Client
  //     return {
  //         uploadId,
  //         bucket: s3.bucket,
  //         key: s3.key,
  //         totalParts,
  //         chunkSize: data.chunkSize,
  //         message: "Upload initialized",
  //     };
  // }

  async initUpload(data: any) {
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
        uploadId: existing.id,
        bucket: existing.s3Bucket,
        key: existing.s3KeyPrefix,
        chunkSize: existing.chunkSize,
        totalParts: existing.totalParts,
        uploadedParts: await this.partRepo.getParts(existing.id),
        message: "Upload resumed",
      };
    }

    // 2️⃣ NEW UPLOAD PATH
    const uploadId = randomUUID();
    const keyPrefix = `uploads/${uploadId}/`;
    const totalParts = Math.ceil(data.size / data.chunkSize);

    // create multipart upload in S3
    const s3 = await this.storage.createMultipartUpload({
      filename: data.filename,
      contentType: data.contentType,
      keyPrefix,
    });

    // persist upload
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
      s3Bucket: s3.bucket,
      s3KeyPrefix: keyPrefix,
      s3UploadId: s3.uploadId,
      state: "INIT",
      metadata: data.metadata || {},
    });

    return {
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

  async partComplete(uploadId: string, data: any) {
    await this.partRepo.savePart(uploadId, data.PartNumber, data.ETag);
    await this.uploadRepo.incrementUploadedParts(uploadId);

    const uploadedParts = await this.uploadRepo.getUpload(uploadId);
    if (!uploadedParts) throw new Error("Upload not found");

    console.log({
      uploadedParts: uploadedParts.uploadedParts,
      totalParts: uploadedParts.totalParts,
    });

    // if (uploadedParts.uploadedParts === uploadedParts.totalParts) {
    //     await this.completeUpload(uploadId);
    // }

    return {
      message: "Part uploaded successfully",
      uploadedParts: uploadedParts.uploadedParts,
      totalParts: uploadedParts.totalParts,
    };
  }

  async completeUpload(uploadId: string) {
    return redisLock(`upload:${uploadId}:complete`, async () => {
      // 1️⃣ Fetch upload record
      const upload = await this.uploadRepo.getUpload(uploadId);
      if (!upload) throw new Error("Upload not found");

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

      // (Optional) 7️⃣ Emit event
      // await this.eventRepo.log(uploadId, "UPLOAD_COMPLETED", { result });

      return {
        status: "completed",
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
        return { status: "not_found", uploadId };
      }

      // If already canceled or completed, return early
      if (upload.state === "CANCELED") {
        return { status: "already_canceled", uploadId };
      }
      if (upload.state === "COMPLETED") {
        return { status: "already_completed", uploadId };
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
      } catch (err: any) {
        // log the error, mark the upload with lastError but keep going with DB update
        // so system remains in a consistent state; you can also rethrow to fail the abort.
        console.error("S3 abort failed for upload", uploadId, err);
        await this.uploadRepo.markCanceled(uploadId, {
          lastError: String(err?.message ?? err),
        });
        // Option: rethrow if you want the caller to retry
        return { status: "s3_abort_failed", uploadId, error: String(err?.message ?? err) };
      }

      // 3. Delete parts rows (optional)
      try {
        await this.partRepo.deleteParts(uploadId);
      } catch (err: any) {
        console.warn("Failed to delete part rows for", uploadId, err);
        // non-fatal: continue
      }

      // 4. Mark upload row as CANCELED
      await this.uploadRepo.markCanceled(uploadId);

      // 5. (Optional) emit event to events table or push notification
      // await this.eventRepo.log(uploadId, "UPLOAD_CANCELED", { by: "uploader" });

      return { status: "canceled", uploadId };
    });
  }
}
