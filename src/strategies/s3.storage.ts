import type StorageStrategy from "./storage.strategy";
import S3ClientSingleton from "@/clients/s3.client";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/utils/env";
import { logger } from "@/utils/logger";

export class S3StorageStrategy implements StorageStrategy {
  private s3 = S3ClientSingleton.getInstance();

  async createMultipartUpload(data: { filename: string; contentType: string; keyPrefix: string }) {
    const key = `${data.keyPrefix}${data.filename}`;

    logger.info({
      filename: data.filename,
      contentType: data.contentType,
      keyPrefix: data.keyPrefix,
    });

    const command = new CreateMultipartUploadCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: data.contentType,
    });

    const response = await this.s3.send(command);

    if (!response.UploadId) {
      throw new Error("Failed to create multipart upload");
    }

    return {
      uploadId: response.UploadId,
      bucket: env.S3_BUCKET,
      key,
    };
  }

  async presignPart(data: { uploadId: string; partNumber: number; bucket: string; key: string }) {
    const command = new UploadPartCommand({
      Bucket: env.S3_BUCKET,
      Key: data.key,
      UploadId: data.uploadId,
      PartNumber: data.partNumber,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn: 9000 });

    return { url };
  }

  async completeMultipartUpload(data: {
    key: string;
    uploadId: string;
    parts: { PartNumber: number; ETag: string }[];
  }) {
    const command = new CompleteMultipartUploadCommand({
      Bucket: env.S3_BUCKET,
      Key: data.key,
      UploadId: data.uploadId,
      MultipartUpload: {
        Parts: data.parts,
      },
    });

    const result = await this.s3.send(command);

    return {
      Location: result.Location,
      Bucket: env.S3_BUCKET,
      Key: data.key,
      ETag: result.ETag!,
    };
  }

  async abortMultipartUpload(params: { key: string; uploadId: string }) {
    const { key, uploadId } = params;

    const cmd = new AbortMultipartUploadCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      UploadId: uploadId,
    });

    // AWS returns an empty 204-like response; we return a normalized object
    await this.s3.send(cmd);

    return { ok: true };
  }

  async deleteObject(params: { key: string }) {
    const { key } = params;

    const cmd = new DeleteObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    });

    // AWS returns an empty 204-like response; we return a normalized object
    await this.s3.send(cmd);

    return { ok: true };
  }

  async checkMultipartUpload(data: {
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<boolean> {
    try {
      logger.info({
        bucket: env.S3_BUCKET,
        key: data.key,
        uploadId: data.uploadId,
      });
      const cmd = new ListPartsCommand({
        Bucket: env.S3_BUCKET,
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
}
