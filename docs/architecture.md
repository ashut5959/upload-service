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
  |     { PartNumber, ETag }          |--- UPSERT upload_parts          |
  |                                    |--- increment uploadedParts     |
  |<-- uploadedParts / totalParts ----|                                 |
  |                                                                      |
  |         ... repeat presign-part / upload / part-complete ...        |
  |                                                                      |
  |--- POST .../complete ------------>|                                 |
  |                                    |--- redisLock(upload:<id>:complete)
  |                                    |--- verify parts.length == totalParts
  |                                    |--- CompleteMultipartUpload --->|
  |                                    |<-- final ETag ------------------|
  |                                    |--- UPDATE uploads (COMPLETED)  |
  |<-- finalKey, etag -----------------|                                 |
```

`init` is also the **resume** path: if `uploadId` is passed in the request body, the service looks up the existing row, checks that the S3-side multipart upload still exists (`ListParts`), transparently recreates it if S3 has expired/aborted it, and returns the already-uploaded parts so the client can skip them.

Cancellation (`DELETE /uploads/:uploadId`) is idempotent: already-canceled or already-completed uploads return early rather than erroring, and it aborts the S3-side multipart upload (best-effort) before deleting part rows and marking the upload `CANCELED`.

## State Machine

`uploads.state` moves through:

```
INIT -> UPLOADING -> COMPLETED
                   -> CANCELED
                   -> FAILED
```

In the current implementation, only `INIT`, `COMPLETED`, and `CANCELED` are actively set by code ([src/repositories/upload.repository.ts](../src/repositories/upload.repository.ts)); `UPLOADING` and `FAILED` are modeled in the schema/type but nothing transitions a row into them yet.

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
- **`upload_events`** — an append-only event log (`eventType`, `data` jsonb) keyed by `uploadId`. Defined but not currently written to; services have commented-out `eventRepo.log(...)` calls marking where this would plug in.

S3 object keys are always `uploads/<uploadId>/<filename>` — one physical key per upload, derived from `s3KeyPrefix + filename`, never a client-supplied path.

## Cross-Cutting Middleware

Wired in [src/app.ts](../src/app.ts), applied in this order: CORS (`@elysiajs/cors`, currently hardcoded to `http://localhost:3000`) → cookie plugin → body size limit (1 MiB) → input sanitizer (regex-based stripping of script tags / SQL-ish / NoSQL-ish patterns) → route handler → metrics + request logging (`onAfterHandle`) → global error handler.

Notable: a per-route `uploadDelay()` (1.5s artificial delay) is applied to every request under `/uploads/*` ([src/routes/upload.route.ts](../src/routes/upload.route.ts)) via `uploadTestRate.ts` — this looks like leftover load-testing scaffolding rather than an intentional production throttle.

Metrics are exposed at `/metrics` in Prometheus text format (`prom-client`), including default Node process metrics plus `http_requests_total` and `http_request_duration_seconds` recorded per request.

## Known Gaps

See [security_recommendations.md](security_recommendations.md) for the full list. The most significant structural gap: there is no authentication and no ownership check on `uploadId`-scoped endpoints, so any caller who knows/guesses a UUID can act on that upload. `src/services/part.service.ts`, `src/services/completion.service.ts`, and `src/workers/completion.worker.ts` are unimplemented stubs reserved for future background reconciliation (e.g. sweeping stalled `INIT` uploads).
