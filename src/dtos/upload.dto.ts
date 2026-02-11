import { z } from "zod";

// ============================================================================
// Init Upload DTOs
// ============================================================================

export const InitUploadRequestSchema = z.object({
  // For resuming existing upload
  uploadId: z.string().uuid().optional(),

  // For new upload
  filename: z.string().min(1).max(255),
  contentType: z
    .string()
    .regex(/^[a-z]+\/[a-z0-9+.-]+$/i, { message: "Invalid content type format" }),
  size: z.number().positive().int(),
  chunkSize: z.number().positive().int(),

  // User context
  uploadedById: z.string().min(1),
  uploadedByType: z.string().min(1),
  tenantId: z.string().optional(),

  // Optional metadata
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InitUploadRequestDto = z.infer<typeof InitUploadRequestSchema>;

export const PartInfoSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string(),
  size: z.number().int().positive().optional(),
});

export type PartInfo = z.infer<typeof PartInfoSchema>;

export const InitUploadResponseSchema = z.object({
  uploadId: z.string().uuid(),
  bucket: z.string(),
  key: z.string(),
  chunkSize: z.number().int().positive(),
  totalParts: z.number().int().positive(),
  uploadedParts: z.array(PartInfoSchema),
  message: z.string(),
});

export type InitUploadResponseDto = z.infer<typeof InitUploadResponseSchema>;

// ============================================================================
// Presign Part DTOs
// ============================================================================

export const PresignPartRequestSchema = z.object({
  partNumber: z.number().int().positive(),
});

export type PresignPartRequestDto = z.infer<typeof PresignPartRequestSchema>;

export const PresignPartResponseSchema = z.object({
  url: z.string().url(),
});

export type PresignPartResponseDto = z.infer<typeof PresignPartResponseSchema>;

// ============================================================================
// Part Complete DTOs
// ============================================================================

export const PartCompleteRequestSchema = z.object({
  PartNumber: z.number().int().positive(),
  ETag: z.string().min(1),
});

export type PartCompleteRequestDto = z.infer<typeof PartCompleteRequestSchema>;

export const PartCompleteResponseSchema = z.object({
  message: z.string(),
  uploadedParts: z.number().int().nonnegative(),
  totalParts: z.number().int().positive(),
});

export type PartCompleteResponseDto = z.infer<typeof PartCompleteResponseSchema>;

// ============================================================================
// Complete Upload DTOs
// ============================================================================

export const CompleteUploadResponseSchema = z.object({
  status: z.literal("completed"),
  uploadId: z.string().uuid(),
  finalKey: z.string(),
  etag: z.string(),
});

export type CompleteUploadResponseDto = z.infer<typeof CompleteUploadResponseSchema>;

// ============================================================================
// Cancel Upload DTOs
// ============================================================================

export const CancelUploadResponseSchema = z.union([
  z.object({
    status: z.enum(["canceled", "not_found", "already_canceled", "already_completed"]),
    uploadId: z.string().uuid(),
  }),
  z.object({
    status: z.literal("s3_abort_failed"),
    uploadId: z.string().uuid(),
    error: z.string(),
  }),
]);

export type CancelUploadResponseDto = z.infer<typeof CancelUploadResponseSchema>;
