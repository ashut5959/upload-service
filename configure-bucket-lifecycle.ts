import { PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";
import S3ClientSingleton from "@/clients/s3.client";
import { env } from "@/utils/env";

async function configureBucketLifecycle() {
  console.log(`🔄 Configuring lifecycle rules for bucket "${env.S3_BUCKET}"...`);

  const s3 = S3ClientSingleton.getInstance();

  const command = new PutBucketLifecycleConfigurationCommand({
    Bucket: env.S3_BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: "uploads-tiering",
          Status: "Enabled",
          Filter: { Prefix: "uploads/" },
          Transitions: [
            { Days: env.S3_IA_TRANSITION_DAYS, StorageClass: "STANDARD_IA" },
            { Days: env.S3_GLACIER_TRANSITION_DAYS, StorageClass: "GLACIER" },
          ],
        },
        {
          ID: "uploads-abort-incomplete-multipart",
          Status: "Enabled",
          Filter: { Prefix: "uploads/" },
          AbortIncompleteMultipartUpload: {
            DaysAfterInitiation: env.S3_ABORT_INCOMPLETE_MULTIPART_DAYS,
          },
        },
      ],
    },
  });

  try {
    await s3.send(command);
    console.log("✅ Bucket lifecycle configuration applied successfully!");
    console.log(
      `   uploads/ → Standard-IA after ${env.S3_IA_TRANSITION_DAYS}d, Glacier after ${env.S3_GLACIER_TRANSITION_DAYS}d`
    );
    console.log(
      `   Incomplete multipart uploads aborted after ${env.S3_ABORT_INCOMPLETE_MULTIPART_DAYS}d`
    );
  } catch (error) {
    console.error("❌ Failed to configure bucket lifecycle:", error);
    process.exit(1);
  }
}

configureBucketLifecycle();
