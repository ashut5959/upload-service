import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT is required"),
  S3_REGION: z.string().min(1, "S3_REGION is required"),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY is required"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development").optional(),
  ELASTICSEARCH_URL: z.string().min(1, "ELASTICSEARCH_URL is required"),
  ELASTIC_USERNAME: z.string().min(1, "ELASTIC_USERNAME is required"),
  ELASTIC_PASSWORD: z.string().min(1, "ELASTIC_PASSWORD is required"),

  // Upload guardrails (S3 multipart hard limits: 5MB min part size, 10,000 max parts)
  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .positive()
    .default(5 * 1024 * 1024 * 1024),
  MIN_PART_SIZE_BYTES: z.coerce
    .number()
    .positive()
    .default(5 * 1024 * 1024),
  MAX_PARTS: z.coerce.number().positive().default(10000),
  ALLOWED_CONTENT_TYPES: z.string().optional(),
  UPLOAD_EXPIRY_HOURS: z.coerce.number().positive().default(24),
  CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .positive()
    .default(15 * 60 * 1000),
});

export const env = envSchema.parse(process.env);
