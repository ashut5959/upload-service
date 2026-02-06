CREATE TABLE "upload_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "upload_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"etag" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"uploaded_by_type" text NOT NULL,
	"tenant_id" text,
	"filename" text NOT NULL,
	"content_type" text,
	"size" bigint NOT NULL,
	"chunk_size" integer NOT NULL,
	"total_parts" integer NOT NULL,
	"s3_bucket" text NOT NULL,
	"s3_key_prefix" text NOT NULL,
	"s3_upload_id" text NOT NULL,
	"state" text DEFAULT 'INIT' NOT NULL,
	"uploaded_parts" integer DEFAULT 0,
	"etag" text,
	"final_s3_key" text,
	"metadata" jsonb,
	"attempts" integer DEFAULT 0,
	"retry_count" integer DEFAULT 0,
	"last_error" text,
	"last_error_at" timestamp,
	"last_tried_at" timestamp,
	"upload_ip" text,
	"upload_device" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "upload_events" ADD CONSTRAINT "upload_events_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_upload_events_upload_id" ON "upload_events" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "idx_upload_events_event_type" ON "upload_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_upload_part" ON "upload_parts" USING btree ("upload_id","part_number");--> statement-breakpoint
CREATE INDEX "idx_upload_parts_upload_id" ON "upload_parts" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_uploaded_by_id" ON "uploads" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_tenant_id" ON "uploads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_state" ON "uploads" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_uploads_expires_at" ON "uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_uploads_pending" ON "uploads" USING btree ("state") WHERE state = 'INIT';--> statement-breakpoint
CREATE INDEX "idx_uploads_not_deleted" ON "uploads" USING btree ("state") WHERE deleted_at IS NULL;