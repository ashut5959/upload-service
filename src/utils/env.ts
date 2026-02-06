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
});

export const env = envSchema.parse(process.env);
