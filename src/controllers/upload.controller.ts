import type UploadService from "@/services/upload.service";

export default class UploadController {
  constructor(private uploadService: UploadService) {}

  initUpload = async ({ body }: { body: any }) => {
    return this.uploadService.initUpload(body);
  };

  presignPart = async ({ params, body }: { params: any; body: any }) => {
    return this.uploadService.presignPart(params.uploadId, body);
  };

  partComplete = async ({ params, body }: { params: any; body: any }) => {
    return this.uploadService.partComplete(params.uploadId, body);
  };

  completeUpload = async ({ params }: { params: any }) => {
    return this.uploadService.completeUpload(params.uploadId);
  };

  cancelUpload = async ({ params }: { params: any }) => {
    return this.uploadService.cancelUpload(params.uploadId);
  };
}
