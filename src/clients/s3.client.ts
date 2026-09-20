import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/utils/env";

export default class S3ClientSingleton {
  private static instance: S3Client;

  static getInstance() {
    if (!this.instance) {
      this.instance = new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        },
        forcePathStyle: true,
        // Recent SDK versions default to auto-attaching a flexible checksum
        // (e.g. x-amz-checksum-crc32) to requests — including presigned URLs,
        // where the real body isn't known at sign time, so the checksum baked
        // into the URL is always wrong once real bytes are actually PUT through
        // it. "WHEN_REQUIRED" only computes one when an operation truly needs
        // it, which avoids BadDigest failures against S3-compatible backends
        // (SeaweedFS, MinIO) that validate it.
        requestChecksumCalculation: "WHEN_REQUIRED",
      });
    }
    return this.instance;
  }
}
