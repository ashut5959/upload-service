import { getDb } from "@/clients/db.client";
import { uploads } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export default class UploadRepository {
  private db = getDb();

  async createUpload(data: any) {
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

  async markCompleted(uploadId: string, data: { etag: string; finalS3Key: string }) {
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

  async markCanceled(uploadId: string, data?: { lastError?: string }) {
    const setObj: any = {
      state: "CANCELED",
      updatedAt: new Date(),
    };

    if (data?.lastError) setObj.lastError = data.lastError;

    return this.db.update(uploads).set(setObj).where(eq(uploads.id, uploadId));
  }
}
