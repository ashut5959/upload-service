ALTER TABLE "uploads" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "idx_uploads_content_hash" ON "uploads" USING btree ("content_hash") WHERE state = 'COMPLETED';