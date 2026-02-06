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
      });
    }
    return this.instance;
  }
}
