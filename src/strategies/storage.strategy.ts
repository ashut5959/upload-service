export default interface StorageStrategy {
  createMultipartUpload(data: {
    bucket: string;
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
    bucket: string;
    key: string;
    uploadId: string;
    parts: {
      PartNumber: number;
      ETag: string;
    }[];
  }): Promise<any>;
  abortMultipartUpload(data: { bucket: string; key: string; uploadId: string }): Promise<any>;

  checkMultipartUpload(data: { bucket: string; key: string; uploadId: string }): Promise<boolean>;

  getUploadedPart(data: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<{ etag: string; size: number } | null>;

  presignGetObject(data: { bucket: string; key: string }): Promise<{ url: string }>;

  deleteObject(data: { bucket: string; key: string }): Promise<void>;

  headObject(data: {
    bucket: string;
    key: string;
  }): Promise<{ exists: boolean; size: number; etag?: string }>;

  copyObject(data: {
    sourceBucket: string;
    sourceKey: string;
    destBucket: string;
    destKey: string;
  }): Promise<{ etag: string }>;
}
