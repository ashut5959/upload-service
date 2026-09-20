import type StorageStrategy from "./storage.strategy";
import S3ClientSingleton from "@/clients/s3.client";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@/utils/logger";

// CopyObjectCommand only supports objects up to this size in a single request;
// larger objects require multipart copy (UploadPartCopyCommand), which isn't
// implemented yet. Kept as an internal detail — callers just see copyObject()
// throw OBJECT_TOO_LARGE_FOR_SINGLE_COPY if this limit is hit.
const SINGLE_COPY_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export class S3StorageStrategy implements StorageStrategy {
  private s3 = S3ClientSingleton.getInstance();

  async createMultipartUpload(data: {
    bucket: string;
    filename: string;
    contentType: string;
    keyPrefix: string;
  }) {
    const key = `${data.keyPrefix}${data.filename}`;

    logger.info({
      bucket: data.bucket,
      filename: data.filename,
      contentType: data.contentType,
      keyPrefix: data.keyPrefix,
    });

    const command = new CreateMultipartUploadCommand({
      Bucket: data.bucket,
      Key: key,
      ContentType: data.contentType,
    });

    const response = await this.s3.send(command);

    if (!response.UploadId) {
      throw new Error("Failed to create multipart upload");
    }

    return {
      uploadId: response.UploadId,
      bucket: data.bucket,
      key,
    };
  }

  async presignPart(data: { uploadId: string; partNumber: number; bucket: string; key: string }) {
    const command = new UploadPartCommand({
      Bucket: data.bucket,
      Key: data.key,
      UploadId: data.uploadId,
      PartNumber: data.partNumber,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn: 9000 });

    return { url };
  }

  async completeMultipartUpload(data: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: { PartNumber: number; ETag: string }[];
  }) {
    const command = new CompleteMultipartUploadCommand({
      Bucket: data.bucket,
      Key: data.key,
      UploadId: data.uploadId,
      MultipartUpload: {
        Parts: data.parts,
      },
    });

    const result = await this.s3.send(command);

    return {
      Location: result.Location,
      Bucket: data.bucket,
      Key: data.key,
      ETag: result.ETag!,
    };
  }

  async abortMultipartUpload(params: { bucket: string; key: string; uploadId: string }) {
    const { bucket, key, uploadId } = params;

    const cmd = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });

    // AWS returns an empty 204-like response; we return a normalized object
    await this.s3.send(cmd);

    return { ok: true };
  }

  async deleteObject(params: { bucket: string; key: string }): Promise<void> {
    const { bucket, key } = params;

    const cmd = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3.send(cmd);
  }

  async checkMultipartUpload(data: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<boolean> {
    try {
      logger.info({
        bucket: data.bucket,
        key: data.key,
        uploadId: data.uploadId,
      });
      const cmd = new ListPartsCommand({
        Bucket: data.bucket,
        Key: data.key,
        UploadId: data.uploadId,
        MaxParts: 1, // minimal call
      });

      await this.s3.send(cmd);
      return true; // upload exists
    } catch (err: any) {
      if (err.name === "NoSuchUpload") {
        return false;
      }
      throw err; // real error
    }
  }

  async getUploadedPart(data: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
  }): Promise<{ etag: string; size: number } | null> {
    // Deliberately not using PartNumberMarker to fetch "just this one part": AWS S3
    // treats it as exclusive (marker N -> first result is N+1), but SeaweedFS treats
    // it as inclusive (marker N -> first result is N if present), so an offset trick
    // tuned for one backend silently fetches the wrong part on the other. Instead,
    // list a full page and scan it for an exact PartNumber match, which is correct
    // regardless of which convention the backend uses. Paginate in the rare case a
    // huge part count doesn't fit in one page.
    let partNumberMarker: string | undefined;

    while (true) {
      const cmd = new ListPartsCommand({
        Bucket: data.bucket,
        Key: data.key,
        UploadId: data.uploadId,
        PartNumberMarker: partNumberMarker,
        MaxParts: 1000,
      });

      const response = await this.s3.send(cmd);
      const part = response.Parts?.find((p) => p.PartNumber === data.partNumber);

      if (part && part.ETag) {
        return { etag: part.ETag, size: part.Size ?? 0 };
      }

      if (!response.IsTruncated || !response.NextPartNumberMarker) {
        return null;
      }

      partNumberMarker = response.NextPartNumberMarker;
    }
  }

  async presignGetObject(data: { bucket: string; key: string }): Promise<{ url: string }> {
    const command = new GetObjectCommand({
      Bucket: data.bucket,
      Key: data.key,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });

    return { url };
  }

  async headObject(data: {
    bucket: string;
    key: string;
  }): Promise<{ exists: boolean; size: number; etag?: string }> {
    try {
      const cmd = new HeadObjectCommand({ Bucket: data.bucket, Key: data.key });
      const response = await this.s3.send(cmd);

      return {
        exists: true,
        size: response.ContentLength ?? 0,
        etag: response.ETag,
      };
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return { exists: false, size: 0 };
      }
      throw err;
    }
  }

  async copyObject(data: {
    sourceBucket: string;
    sourceKey: string;
    destBucket: string;
    destKey: string;
  }): Promise<{ etag: string }> {
    const source = await this.headObject({ bucket: data.sourceBucket, key: data.sourceKey });

    if (!source.exists) {
      throw new Error(
        `COPY_SOURCE_NOT_FOUND: ${data.sourceBucket}/${data.sourceKey} does not exist`
      );
    }

    if (source.size > SINGLE_COPY_MAX_BYTES) {
      // Multipart copy (CreateMultipartUpload + UploadPartCopy + CompleteMultipartUpload)
      // isn't implemented yet — fail loudly rather than attempt a copy S3 would reject.
      throw new Error(
        `OBJECT_TOO_LARGE_FOR_SINGLE_COPY: ${data.sourceBucket}/${data.sourceKey} is ${source.size} bytes, exceeds the ${SINGLE_COPY_MAX_BYTES}-byte single-request CopyObject limit`
      );
    }

    const command = new CopyObjectCommand({
      Bucket: data.destBucket,
      Key: data.destKey,
      CopySource: `/${data.sourceBucket}/${encodeURIComponent(data.sourceKey)}`,
    });

    const result = await this.s3.send(command);

    return { etag: result.CopyObjectResult?.ETag ?? "" };
  }
}
