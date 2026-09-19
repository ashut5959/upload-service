# Architecture

## Purpose

This service is the control plane for large-file uploads. It never touches file bytes — clients upload each part directly to S3 (or MinIO) using presigned URLs. The service's job is to keep an authoritative record of an upload's state, so that:

- Uploads survive client disconnects/retries (resumable via `uploadId`).
- Completion is safe under concurrent/duplicate requests (Redis-backed locking).
- A partial upload can be identified and cleaned up (cancel/abort).

## Layers

```
Routes            HTTP method/path + request schema validation (Elysia's `t.Object` schemas)
  -> Controllers   Thin adapters: pull params/body, call the service, return its result
    -> Services    Business logic: upload lifecycle, validation, locking, orchestration
      -> Repositories   Drizzle queries against Postgres (uploads, upload_parts)
      -> Strategies      Storage backend abstraction (S3StorageStrategy today)
        -> Clients        Singletons: S3Client, Postgres connection, Redis connection
```

Dependencies are wired manually in a composition root ([src/routes/upload.route.ts](../src/routes/upload.route.ts)) rather than via a DI container — each route file constructs its own repository/service/controller graph.

`StorageStrategy` ([src/strategies/storage.strategy.ts](../src/strategies/storage.strategy.ts)) is the seam for supporting other object stores; only `S3StorageStrategy` is implemented (it also talks to MinIO, since MinIO is S3-API-compatible and `forcePathStyle: true` is set on the client). `src/strategies/minio.storage.ts` is a placeholder for a dedicated implementation, currently unused.

## Upload Lifecycle

```
Client                          Upload Service                         S3
  |                                    |                                 |
  |--- POST /uploads/init ----------->|                                 |
  |                                    |--- CreateMultipartUpload ----->|
  |                                    |<-- s3UploadId ------------------|
  |                                    |--- INSERT uploads (state=INIT) |
  |<-- uploadId, totalParts, chunkSize |                                 |
  |                                    |                                 |
  |--- POST .../presign-part -------->|                                 |
  |                                    |--- getSignedUrl(UploadPart) --->|
  |<-- presigned PUT url --------------|                                 |
  |                                                                      |
  |=== PUT <presigned url> with part bytes ============================>|
  |<================================================= ETag (S3 response) |
  |                                    |                                 |
  |--- POST .../part-complete ------->|                                 |
  |     { PartNumber, ETag }          |--- ListParts(partNumber) ----->|
  |                                    |<-- authoritative ETag/size -----|
  |                                    |--- UPSERT upload_parts          |
  |                                    |     (S3-verified ETag/size)    |
  |                                    |--- recount uploadedParts       |
  |<-- uploadedParts / totalParts ----|                                 |
  |                                    | (if last part: auto-complete) |
  |                                                                      |
  |         ... repeat presign-part / upload / part-complete ...        |
  |                                                                      |
  |--- POST .../complete ------------>|                                 |
  |                                    |--- redisLock(upload:<id>:complete)
  |                                    |--- verify parts.length == totalParts
  |                                    |--- verify sum(part sizes) == size
  |                                    |--- CompleteMultipartUpload --->|
  |                                    |<-- final ETag ------------------|
  |                                    |--- UPDATE uploads (COMPLETED)  |
  |<-- finalKey, etag -----------------|                                 |
```

On a new (non-resume) `init`, the service enforces S3's own multipart limits plus a couple of policy knobs before ever calling S3: `size` against `MAX_UPLOAD_SIZE_BYTES`, `totalParts` against S3's 10,000-part hard cap (`MAX_PARTS`), `chunkSize` against S3's 5MB-per-part minimum (`MIN_PART_SIZE_BYTES`), and optionally `contentType` against `ALLOWED_CONTENT_TYPES` if that's configured (unset by default — no content-type restriction). If the S3-side `CreateMultipartUpload` succeeds but the subsequent DB insert fails, the service aborts that S3 session before propagating the error, so a DB failure never leaves an untracked (and billable) multipart upload behind.

`init` is also the **resume** path: if `uploadId` is passed in the request body, the service looks up the existing row, checks that the S3-side multipart upload still exists (`ListParts`), transparently recreates it if S3 has expired/aborted it, and returns the already-uploaded parts so the client can skip them.

`part-complete` no longer trusts the client's reported `ETag`: it fetches the part directly from S3 (`ListParts` with `PartNumberMarker: partNumber - 1, MaxParts: 1`, the cheapest way to fetch one specific part) and only persists S3's own `ETag`/size. If `uploadedParts` then equals `totalParts`, the service auto-invokes the same completion logic as an explicit `/complete` call (best-effort — failure just means the client falls back to calling `/complete` itself). `/complete` is therefore idempotent: it short-circuits if the upload is already `COMPLETED`.

Cancellation (`DELETE /uploads/:uploadId`) is idempotent: already-canceled or already-completed uploads return early rather than erroring, and it aborts the S3-side multipart upload (best-effort) before deleting part rows and marking the upload `CANCELED`.

## State Machine

`uploads.state` moves through:

```
INIT -> UPLOADING -> COMPLETED
                   -> CANCELED
                   -> FAILED
```

In the current implementation, only `INIT`, `COMPLETED`, and `CANCELED` are actively set by code ([src/repositories/upload.repository.ts](../src/repositories/upload.repository.ts)); `UPLOADING` and `FAILED` are modeled in the schema/type but nothing transitions a row into them yet.

## Stale Upload Cleanup

Every new upload gets `expiresAt = now + UPLOAD_EXPIRY_HOURS` (default 24h). [src/workers/completion.worker.ts](../src/workers/completion.worker.ts) is a standalone process (`bun run worker`) that, on a `CLEANUP_INTERVAL_MS` interval (default 15 min), queries `uploads` for rows still in `INIT` past their `expiresAt` — via `UploadRepository.findExpiredUploads()`, which uses the `idxPendingUploads`/`idxExpiresAt` indexes that were already defined in the schema for exactly this purpose — aborts each one's S3 multipart session, deletes its part rows, and marks it `CANCELED` with `lastError: "Expired — abandoned upload"`. It is not started by `app.ts`; run it as a separate process/container (or a Kubernetes CronJob) alongside the API.

## Concurrency: Distributed Locking

`completeUpload` and `cancelUpload` both wrap their critical section in `redisLock` ([src/redis/redislock.ts](../src/redis/redislock.ts)):

- Acquires a key with `SET key token PX <ttl> NX` (default TTL 15s).
- Releases it with a Lua script that only deletes the key if the token still matches (prevents releasing a lock some other process now owns after TTL expiry).
- If the lock can't be acquired, the call throws immediately (`LOCK_NOT_ACQUIRED`) rather than queueing or retrying — a concurrent `complete`/`cancel` call on the same `uploadId` fails fast instead of blocking.

This guards against the same upload being completed or canceled twice concurrently (e.g. a client double-submitting "Finish upload").

## Data Model

Three Drizzle-defined tables ([src/db/schema.ts](../src/db/schema.ts)):

- **`uploads`** — one row per upload session: identity (`uploadedById`, `uploadedByType`, `tenantId`), file metadata (`filename`, `contentType`, `size`, `chunkSize`, `totalParts`), S3 location (`s3Bucket`, `s3KeyPrefix`, `s3UploadId`), `state`, progress (`uploadedParts`), and retry/error bookkeeping (`attempts`, `retryCount`, `lastError`, `lastErrorAt`). Indexed on `uploadedById`, `tenantId`, `state`, and `expiresAt`, with partial indexes for pending (`state = 'INIT'`) and non-deleted rows.
- **`upload_parts`** — one row per uploaded part (`uploadId`, `partNumber`, `etag`, `size`, `checksum`), unique on `(uploadId, partNumber)` so re-reporting the same part upserts rather than duplicates.
- **`upload_events`** — an append-only event log (`eventType`, `data` jsonb) keyed by `uploadId`, written via `EventRepository` ([src/repositories/event.repository.ts](../src/repositories/event.repository.ts)). `PART_COMPLETED`, `UPLOAD_COMPLETED`, `UPLOAD_CANCELED`, `UPLOAD_CANCEL_FAILED`, and `UPLOAD_EXPIRED` (from the cleanup worker) are logged today; nothing yet consumes this table (e.g. a webhook dispatcher), so it's currently a queryable audit trail rather than a trigger for downstream systems.

S3 object keys are always `uploads/<uploadId>/<filename>` — one physical key per upload, derived from `s3KeyPrefix + filename`, never a client-supplied path.

## Cross-Cutting Middleware

Wired in [src/app.ts](../src/app.ts), applied in this order: CORS (`@elysiajs/cors`, currently hardcoded to `http://localhost:3000`) → cookie plugin → body size limit (1 MiB) → input sanitizer (regex-based stripping of script tags / SQL-ish / NoSQL-ish patterns) → route handler → metrics + request logging (`onAfterHandle`) → global error handler.

Metrics are exposed at `/metrics` in Prometheus text format (`prom-client`), including default Node process metrics plus `http_requests_total` and `http_request_duration_seconds` recorded per request.

## Known Gaps

See [security_recommendations.md](security_recommendations.md) for the full list. The most significant remaining structural gap: there is no authentication and no ownership check on `uploadId`-scoped endpoints, so any caller who knows/guesses a UUID can act on that upload, list uploads for an arbitrary `uploadedById`, or download a completed file. `src/services/part.service.ts` and `src/services/completion.service.ts` remain unimplemented stubs.

As of this revision, the following are handled: server-side ETag/size verification against S3 (part-complete no longer trusts the client), an accurate `uploadedParts` count, upload-size/content-type/chunk-size guardrails at `init`, S3-session rollback if the DB write fails, stale-upload cleanup via the completion worker, completion events, and auto-complete.
