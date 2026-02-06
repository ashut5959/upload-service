import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

// ----------------------------
// Uploads Table
// ----------------------------
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey(),

    uploadedById: text("uploaded_by_id").notNull(),
    uploadedByType: text("uploaded_by_type").notNull(),
    tenantId: text("tenant_id"),

    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: bigint("size", { mode: "number" }).notNull(),
    chunkSize: integer("chunk_size").notNull(),
    totalParts: integer("total_parts").notNull(),

    s3Bucket: text("s3_bucket").notNull(),
    s3KeyPrefix: text("s3_key_prefix").notNull(),
    s3UploadId: text("s3_upload_id").notNull(),

    state: text("state")
      .$type<"INIT" | "UPLOADING" | "COMPLETED" | "FAILED" | "CANCELED">()
      .notNull()
      .default("INIT"),

    uploadedParts: integer("uploaded_parts").default(0),

    etag: text("etag"),
    finalS3Key: text("final_s3_key"),

    metadata: jsonb("metadata"),

    attempts: integer("attempts").default(0),
    retryCount: integer("retry_count").default(0),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at"),
    lastTriedAt: timestamp("last_tried_at"),

    uploadIp: text("upload_ip"),
    uploadDevice: text("upload_device"),

    deletedAt: timestamp("deleted_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => {
    return {
      // ---- INDEXES ----
      idxUploadedById: index("idx_uploads_uploaded_by_id").on(table.uploadedById),
      idxTenantId: index("idx_uploads_tenant_id").on(table.tenantId),
      idxState: index("idx_uploads_state").on(table.state),
      idxExpiresAt: index("idx_uploads_expires_at").on(table.expiresAt),

      idxPendingUploads: index("idx_uploads_pending")
        .on(table.state)
        .where(sql`state = 'INIT'`),

      idxNotDeleted: index("idx_uploads_not_deleted")
        .on(table.state)
        .where(sql`deleted_at IS NULL`),

      // ---- CHECK CONSTRAINTS ----
      chkSizePositive: sql`CHECK (size > 0)`,
      chkChunkPositive: sql`CHECK (chunk_size > 0)`,
      chkTotalPartsPositive: sql`CHECK (total_parts > 0)`,
    };
  }
);

// ----------------------------
// Upload Parts Table
// ----------------------------
export const uploadParts = pgTable(
  "upload_parts",
  {
    id: uuid("id").primaryKey(),

    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade", onUpdate: "cascade" }),

    partNumber: integer("part_number").notNull(),
    etag: text("etag").notNull(),
    size: integer("size").notNull(),
    checksum: text("checksum"),

    uploadedAt: timestamp("uploaded_at").defaultNow(),
  },
  (table) => {
    return {
      // composite unique
      uniqueUploadPart: uniqueIndex("unique_upload_part").on(table.uploadId, table.partNumber),

      idxUploadId: index("idx_upload_parts_upload_id").on(table.uploadId),

      chkPartPositive: sql`CHECK (part_number > 0)`,
    };
  }
);

// ----------------------------
// Upload Events Table
// ----------------------------
export const uploadEvents = pgTable(
  "upload_events",
  {
    id: uuid("id").primaryKey(),

    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),

    eventType: text("event_type").notNull(),
    data: jsonb("data").notNull(),

    timestamp: timestamp("timestamp").defaultNow(),
  },
  (table) => {
    return {
      idxUploadId: index("idx_upload_events_upload_id").on(table.uploadId),
      idxEventType: index("idx_upload_events_event_type").on(table.eventType),
    };
  }
);
