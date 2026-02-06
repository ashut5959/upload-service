import { Elysia } from "elysia";
import UploadController from "@/controllers/upload.controller";
import { uploadDelay } from "@/middleware/uploadTestRate";

const uploadController = new UploadController();

export default new Elysia({ prefix: "/uploads" })
  .onBeforeHandle(uploadDelay().beforeHandle)
  .post("/init", uploadController.initUpload)
  .post("/:uploadId/presign-part", uploadController.presignPart)
  .post("/:uploadId/part-complete", uploadController.partComplete)
  .post("/:uploadId/complete", uploadController.completeUpload)
  .delete("/:uploadId", uploadController.cancelUpload);
