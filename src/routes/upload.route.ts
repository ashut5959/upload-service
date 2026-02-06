import { Elysia } from "elysia";
import UploadController from "@/controllers/upload.controller";
import UploadService from "@/services/upload.service";
import UploadRepository from "@/repositories/upload.repository";
import PartRepository from "@/repositories/part.repository";
import { S3StorageStrategy } from "@/strategies/s3.storage";
import { getDb } from "@/clients/db.client";
import { uploadDelay } from "@/middleware/uploadTestRate";

// Composition Root: Wire all dependencies
const db = getDb();
const uploadRepo = new UploadRepository(db);
const partRepo = new PartRepository(db);
const storage = new S3StorageStrategy();
const uploadService = new UploadService(uploadRepo, partRepo, storage);
const uploadController = new UploadController(uploadService);

export default new Elysia({ prefix: "/uploads" })
  .onBeforeHandle(uploadDelay().beforeHandle)
  .post("/init", uploadController.initUpload)
  .post("/:uploadId/presign-part", uploadController.presignPart)
  .post("/:uploadId/part-complete", uploadController.partComplete)
  .post("/:uploadId/complete", uploadController.completeUpload)
  .delete("/:uploadId", uploadController.cancelUpload);
