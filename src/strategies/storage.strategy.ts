export default interface StorageStrategy {
  createMultipartUpload(data: {
    filename: string;
    contentType: string;
    keyPrefix: string;
  }): Promise<{
    uploadId: string;
    bucket: string;
    key: string;
  }>;
  presignPart(data: {
    uploadId: string;
    partNumber: number;
    bucket: string;
    key: string;
  }): Promise<{ url: string }>;
  completeMultipartUpload(data: {
    key: string;
    uploadId: string;
    parts: {
      PartNumber: number;
      ETag: string;
    }[];
  }): Promise<any>;
  abortMultipartUpload(data: { key: string; uploadId: string }): Promise<any>;

  checkMultipartUpload(data: { bucket: string; key: string; uploadId: string }): Promise<boolean>;
}
