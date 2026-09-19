import type { DbClient } from "@/repositories/upload.repository";
import { uploadEvents } from "@/db/schema";
import { randomUUID } from "crypto";

export default class EventRepository {
  constructor(private db: DbClient) {}

  async log(uploadId: string, eventType: string, data: Record<string, unknown> = {}) {
    return this.db
      .insert(uploadEvents)
      .values({ id: randomUUID(), uploadId, eventType, data })
      .returning();
  }
}
