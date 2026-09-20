import type UploadService from "@/services/upload.service";
import { catchAsync } from "@/utils/catch-async";

export default class UploadController {
  constructor(private uploadService: UploadService) {}

  initUpload = catchAsync(async ({ body }: { body: any }) => {
    return this.uploadService.initUpload(body);
  });

  presignPart = catchAsync(async ({ params, body }: { params: any; body: any }) => {
    return this.uploadService.presignPart(params.uploadId, body);
  });

  partComplete = catchAsync(async ({ params, body }: { params: any; body: any }) => {
    return this.uploadService.partComplete(params.uploadId, body);
  });

  completeUpload = catchAsync(async ({ params }: { params: any }) => {
    return this.uploadService.completeUpload(params.uploadId);
  });

  cancelUpload = catchAsync(async ({ params }: { params: any }) => {
    return this.uploadService.cancelUpload(params.uploadId);
  });

  getStatus = catchAsync(async ({ params }: { params: any }) => {
    return this.uploadService.getStatus(params.uploadId);
  });

  listUploads = catchAsync(async ({ query }: { query: any }) => {
    return this.uploadService.listUploads(query);
  });

  getDownloadUrl = catchAsync(async ({ params }: { params: any }) => {
    return this.uploadService.getDownloadUrl(params.uploadId);
  });
}
