import type { DbClient } from "@/repositories/upload.repository";
import { uploadParts } from "@/db/schema";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";

export default class PartRepository {
  constructor(private db: DbClient) {}

  async savePart(
    uploadId: string,
    partNumber: number,
    etag: string,
    size?: number,
    checksum?: string
  ) {
    // Upsert logic: insert or update
    const result = await this.db
      .insert(uploadParts)
      .values({
        id: randomUUID(),
        uploadId,
        partNumber,
        etag,
        size: size ?? 0,
        checksum: checksum ?? null,
      })
      .onConflictDoUpdate({
        target: [uploadParts.uploadId, uploadParts.partNumber],
        set: { etag },
      })
      .returning();

    return result[0];
  }

  async getParts(uploadId: string) {
    return this.db.select().from(uploadParts).where(eq(uploadParts.uploadId, uploadId));
  }

  async listParts(uploadId: string) {
    return this.db
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.uploadId, uploadId))
      .orderBy(uploadParts.partNumber);
  }

  async countParts(uploadId: string) {
    const rows = await this.db
      .select({
        count: sql`count(*)`.mapWith(Number),
      })
      .from(uploadParts)
      .where(eq(uploadParts.uploadId, uploadId));

    return rows[0]?.count ?? 0;
  }

  async deleteParts(uploadId: string) {
    return this.db.delete(uploadParts).where(eq(uploadParts.uploadId, uploadId));
  }
}
