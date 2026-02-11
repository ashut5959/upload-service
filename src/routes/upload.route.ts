import { Elysia, t } from "elysia";
import UploadController from "@/controllers/upload.controller";
import UploadService from "@/services/upload.service";
import UploadRepository from "@/repositories/upload.repository";
import PartRepository from "@/repositories/part.repository";
import { S3StorageStrategy } from "@/strategies/s3.storage";
import { getDb } from "@/clients/db.client";
import { uploadDelay } from "@/middleware/uploadTestRate";
import { type InitUploadRequestDto, type PartCompleteRequestDto } from "@/dtos/upload.dto";

// Composition Root: Wire all dependencies
const db = getDb();
const uploadRepo = new UploadRepository(db);
const partRepo = new PartRepository(db);
const storage = new S3StorageStrategy();
const uploadService = new UploadService(uploadRepo, partRepo, storage);
const uploadController = new UploadController(uploadService);

export default new Elysia({ prefix: "/uploads" })
  .onBeforeHandle(uploadDelay().beforeHandle)
  .post("/init", uploadController.initUpload, {
    body: t.Object({
      uploadId: t.Optional(t.String({ format: "uuid" })),
      filename: t.String({ minLength: 1, maxLength: 255 }),
      contentType: t.String({ pattern: "^[a-z]+/[a-z0-9+.-]+$" }),
      size: t.Integer({ minimum: 1 }),
      chunkSize: t.Integer({ minimum: 1 }),
      uploadedById: t.String({ minLength: 1 }),
      uploadedByType: t.String({ minLength: 1 }),
      tenantId: t.Optional(t.String()),
      metadata: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  })
  .post("/:uploadId/presign-part", uploadController.presignPart, {
    params: t.Object({
      uploadId: t.String({ format: "uuid" }),
    }),
    body: t.Object({
      partNumber: t.Integer({ minimum: 1 }),
    }),
  })
  .post("/:uploadId/part-complete", uploadController.partComplete, {
    params: t.Object({
      uploadId: t.String({ format: "uuid" }),
    }),
    body: t.Object({
      PartNumber: t.Integer({ minimum: 1 }),
      ETag: t.String({ minLength: 1 }),
    }),
  })
  .post("/:uploadId/complete", uploadController.completeUpload, {
    params: t.Object({
      uploadId: t.String({ format: "uuid" }),
    }),
  })
  .delete("/:uploadId", uploadController.cancelUpload, {
    params: t.Object({
      uploadId: t.String({ format: "uuid" }),
    }),
  });
