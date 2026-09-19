import type { getDb } from "@/clients/db.client";
import { uploads } from "@/db/schema";
import { and, desc, eq, lt, sql } from "drizzle-orm";

export type DbClient = ReturnType<typeof getDb>;

export interface CreateUploadData {
  id: string;
  uploadedById: string;
  uploadedByType: string;
  tenantId: string | null;
  filename: string;
  contentType: string;
  size: number;
  chunkSize: number;
  totalParts: number;
  s3Bucket: string;
  s3KeyPrefix: string;
  s3UploadId: string;
  state: "INIT" | "UPLOADING" | "COMPLETED" | "FAILED" | "CANCELED";
  metadata: Record<string, unknown>;
  expiresAt?: Date;
}

export interface ListUploadsFilter {
  uploadedById: string;
  tenantId?: string;
  state?: "INIT" | "UPLOADING" | "COMPLETED" | "FAILED" | "CANCELED";
}

export interface MarkCompletedData {
  etag: string;
  finalS3Key: string;
}

export interface MarkCanceledData {
  lastError?: string;
}

export default class UploadRepository {
  constructor(private db: DbClient) {}

  async createUpload(data: CreateUploadData) {
    return this.db.insert(uploads).values(data).returning();
  }

  async updateS3UploadId(uploadId: string, s3UploadId: string) {
    return this.db.update(uploads).set({ s3UploadId }).where(eq(uploads.id, uploadId));
  }

  async getUpload(uploadId: string) {
    const rows = await this.db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);

    return rows[0];
  }

  async incrementUploadedParts(uploadId: string) {
    return this.db
      .update(uploads)
      .set({
        uploadedParts: sql`${uploads.uploadedParts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, uploadId));
  }

  async setUploadedParts(uploadId: string, count: number) {
    return this.db
      .update(uploads)
      .set({ uploadedParts: count, updatedAt: new Date() })
      .where(eq(uploads.id, uploadId));
  }

  async listUploads(filter: ListUploadsFilter) {
    const conditions = [eq(uploads.uploadedById, filter.uploadedById)];

    if (filter.tenantId) conditions.push(eq(uploads.tenantId, filter.tenantId));
    if (filter.state) conditions.push(eq(uploads.state, filter.state));

    return this.db
      .select()
      .from(uploads)
      .where(and(...conditions))
      .orderBy(desc(uploads.createdAt));
  }

  async findExpiredUploads() {
    return this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.state, "INIT"), lt(uploads.expiresAt, new Date())));
  }

  async markCompleted(uploadId: string, data: MarkCompletedData) {
    return this.db
      .update(uploads)
      .set({
        state: "COMPLETED",
        etag: data.etag,
        finalS3Key: data.finalS3Key,
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, uploadId));
  }

  async markCanceled(uploadId: string, data?: MarkCanceledData) {
    const setObj: Partial<typeof uploads.$inferInsert> = {
      state: "CANCELED",
      updatedAt: new Date(),
    };

    if (data?.lastError) setObj.lastError = data.lastError;

    return this.db.update(uploads).set(setObj).where(eq(uploads.id, uploadId));
  }
}
