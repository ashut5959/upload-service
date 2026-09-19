# API Reference

Base URL: `http://localhost:<PORT>` (default port `3001`). No authentication is currently required or enforced — see [security_recommendations.md](security_recommendations.md).

All request bodies are JSON (`Content-Type: application/json`). Request bodies are validated against schemas defined at the route level ([src/routes/upload.route.ts](../src/routes/upload.route.ts)); a request that fails validation gets a `400` from Elysia before it reaches the controller.

## Error Format

Unhandled errors are caught by the global error handler ([src/app.ts](../src/app.ts)) and returned as:

```json
{
  "status": "error",
  "message": "Internal Server Error"
}
```

In non-production environments (`NODE_ENV !== "production"`), `message` contains the raw error instead of a generic string. Business-logic errors thrown by the service layer (e.g. `"Upload not found"`) currently surface this way with a `500` status — there is no typed error-to-status mapping in the upload flow, so expect `500` for conditions that are really `400`/`404`/`409`.

---

## Health & Meta

| Method | Path | Response |
|---|---|---|
| `GET` | `/` | `{ "service": "Upload Service", "status": "OK" }` |
| `GET` | `/health` | `{ "status": "OK" }` |
| `GET` | `/ready` | `{ "ready": true }` |
| `GET` | `/version` | `{ "version": "1.0.0" }` |
| `GET` | `/info` | `{ "info": "Upload Service" }` |
| `GET` | `/metrics` | Prometheus text-format metrics |

---

## `POST /uploads/init`

Starts a new upload, or resumes an existing one if `uploadId` is supplied.

### Request Body

| Field | Type | Required | Notes |
|---|---|---|---|
| `uploadId` | `string` (uuid) | No | If present, resumes an existing upload; all other fields are ignored on the resume path |
| `filename` | `string` | Yes | 1–255 chars |
| `contentType` | `string` | Yes | MIME type, pattern `^[a-z]+/[a-z0-9+.-]+$` |
| `size` | `integer` | Yes | Total file size in bytes, `>= 1` |
| `chunkSize` | `integer` | Yes | Bytes per part, `>= 1`; `totalParts = ceil(size / chunkSize)` |
| `uploadedById` | `string` | Yes | Caller-supplied identity — **not verified against any auth context** |
| `uploadedByType` | `string` | Yes | e.g. `"user"`, `"service"` — caller-defined |
| `tenantId` | `string` | No | Caller-supplied — **not verified**, see security doc |
| `metadata` | `object` | No | Free-form JSON, stored as-is |

### Response — new upload

```json
{
  "uploadId": "b3f1...-uuid",
  "bucket": "mangaread",
  "key": "uploads/b3f1.../myfile.pdf",
  "chunkSize": 5242880,
  "totalParts": 4,
  "uploadedParts": [],
  "message": "Upload initialized"
}
```

### Response — resume

```json
{
  "uploadId": "b3f1...-uuid",
  "bucket": "mangaread",
  "key": "uploads/b3f1.../",
  "chunkSize": 5242880,
  "totalParts": 4,
  "uploadedParts": [
    { "id": "...", "uploadId": "b3f1...", "partNumber": 1, "etag": "\"...\"", "size": 0, "checksum": null, "uploadedAt": "..." }
  ],
  "message": "Upload resumed"
}
```

Note the `key` field differs between the two responses: on a new upload it's the full object key (`s3KeyPrefix + filename`); on resume it's just `s3KeyPrefix`. Treat `bucket` + `s3KeyPrefix` + `filename` as the source of truth if building the key client-side.

If the resumed upload's S3-side multipart session has expired or been aborted, it is transparently recreated (new `s3UploadId`) and any parts already uploaded to the old session are no longer valid — the client should re-upload from the returned `uploadedParts` list forward, though note the old session's parts (if any) are **not** cleared from `uploadedParts` in this path, only replaced going forward.

A newly created upload gets `expiresAt = now + UPLOAD_EXPIRY_HOURS` (default 24h). If the client never finishes it, a background worker aborts the S3 session and marks it `CANCELED` after that window — see [architecture.md](architecture.md#stale-upload-cleanup).

### Validation (new uploads only)

- `size` must not exceed `MAX_UPLOAD_SIZE_BYTES` (default 5GB) → `"FILE_TOO_LARGE"`.
- If `ALLOWED_CONTENT_TYPES` is configured, `contentType` must be in that list → `"CONTENT_TYPE_NOT_ALLOWED"`. Unset by default (all content types allowed, including video).
- `totalParts` (`ceil(size / chunkSize)`) must not exceed `MAX_PARTS` (S3's hard limit, default 10000) → `"TOO_MANY_PARTS"`.
- For multi-part uploads, `chunkSize` must be at least `MIN_PART_SIZE_BYTES` (S3's per-part minimum, default 5MB) → `"CHUNK_SIZE_TOO_SMALL"`.

### Errors

- Resuming a nonexistent `uploadId` → `"UPLOAD_NOT_FOUND"`.
- If the DB write fails after the S3 multipart session was created, the S3 session is aborted automatically before the error is re-thrown (no orphaned session left behind).

---

## `POST /uploads/:uploadId/presign-part`

Returns a presigned S3 `UploadPart` URL for a single part. The client `PUT`s the part's raw bytes directly to this URL.

### Params

- `uploadId` (path, uuid)

### Request Body

| Field | Type | Required | Notes |
|---|---|---|---|
| `partNumber` | `integer` | Yes | `>= 1`, must be `<= totalParts` for the upload |

### Response

```json
{ "url": "https://s3.../uploads/.../myfile.pdf?X-Amz-Signature=..." }
```

The URL expires in 9000 seconds (2.5 hours).

### Errors

- `"Upload not found"` — no upload with that ID.
- `"Upload missing S3 UploadId"` — inconsistent record state.
- `"Part number exceeds totalParts"`.

### Uploading the part

```bash
curl -X PUT "<presigned-url>" --data-binary @part-1.bin
```

Capture the `ETag` response header — it's required for the next step.

---

## `POST /uploads/:uploadId/part-complete`

Records that a part finished uploading to S3.

### Params

- `uploadId` (path, uuid)

### Request Body

| Field | Type | Required | Notes |
|---|---|---|---|
| `PartNumber` | `integer` | Yes | `>= 1` |
| `ETag` | `string` | Yes | The `ETag` header S3 returned from the part `PUT` |

### Response

```json
{
  "message": "Part uploaded successfully",
  "uploadedParts": 2,
  "totalParts": 4,
  "autoCompleted": false
}
```

`autoCompleted` is `true` if this was the last outstanding part and the upload was automatically finalized as a result (see below) — in that case the upload is already `COMPLETED` and calling `POST /uploads/:uploadId/complete` afterward just returns the same completed result rather than erroring.

### Behavior

- The server does **not** trust the client's reported `ETag`. It looks up the part directly from S3 (`ListParts`) and compares S3's authoritative `ETag` and size against what the client sent:
  - Part not found on S3 → `"PART_NOT_FOUND_IN_S3"`.
  - Client's `ETag` doesn't match what S3 actually has → `"ETAG_MISMATCH"`.
  - Only the S3-verified `ETag` and size are persisted.
- Re-reporting the same `PartNumber` upserts the stored row rather than creating a duplicate (unique on `uploadId, partNumber`). `uploadedParts` is always the true count of distinct recorded parts (recounted, not incremented), so retries can't inflate it past `totalParts`.
- **Auto-complete**: once `uploadedParts === totalParts`, the service automatically calls the same logic as `POST /uploads/:uploadId/complete`. This is best-effort — if it fails (e.g. a lock is held), the part-complete call still succeeds and the client should fall back to explicitly calling `/complete`.

---

## `POST /uploads/:uploadId/complete`

Finalizes the multipart upload once all parts are uploaded and reported.

### Params

- `uploadId` (path, uuid)

### Request Body

None.

### Response

```json
{
  "status": "completed",
  "uploadId": "b3f1...-uuid",
  "finalKey": "uploads/b3f1.../myfile.pdf",
  "etag": "\"final-etag-from-s3\""
}
```

### Behavior

- Idempotent: if the upload is already `COMPLETED` (e.g. auto-completed by the last `part-complete` call), this just returns that result again rather than re-running S3's `CompleteMultipartUpload`.
- Guarded by a Redis lock (`upload:<uploadId>:complete`); a concurrent second call fails with `LOCK_NOT_ACQUIRED` instead of double-completing.
- Requires the number of recorded `upload_parts` rows to exactly equal `totalParts`; otherwise:  
  `"Upload incomplete: expected {totalParts}, but only {n} parts uploaded"`.
- Requires the sum of recorded part sizes (S3-verified, from `part-complete`) to exactly equal the `size` declared at `init`; otherwise `"SIZE_MISMATCH"`.
- On success, logs an `UPLOAD_COMPLETED` event to the `upload_events` table.

### Errors

- `"Upload not found"`
- `"S3 uploadId missing — cannot complete multipart upload"`
- `"No uploaded parts found"`
- `"Upload incomplete: expected N, but only M parts uploaded"`
- `"SIZE_MISMATCH: expected N bytes but uploaded parts total M bytes"`
- `"LOCK_NOT_ACQUIRED"` — another complete/cancel is in flight for this upload

---

## `DELETE /uploads/:uploadId`

Cancels an upload: aborts the S3 multipart upload, deletes recorded part rows, and marks the upload row `CANCELED`. Idempotent.

### Params

- `uploadId` (path, uuid)

### Response

One of:

```json
{ "status": "canceled", "uploadId": "..." }
{ "status": "not_found", "uploadId": "..." }
{ "status": "already_canceled", "uploadId": "..." }
{ "status": "already_completed", "uploadId": "..." }
{ "status": "s3_abort_failed", "uploadId": "...", "error": "..." }
```

`not_found` is returned (not a 404 error) if the upload doesn't exist, treating "nothing to cancel" as success. `s3_abort_failed` means the DB row was marked canceled with `lastError` set, but the S3-side multipart upload may still exist — this can leave orphaned incomplete-multipart-upload storage costs in S3 until a lifecycle rule or manual cleanup removes it.

### Errors

Guarded by a Redis lock (`upload:<uploadId>:cancel`); concurrent cancel/complete calls on the same upload fail fast with `LOCK_NOT_ACQUIRED`.

---

## `GET /uploads/:uploadId`

Returns the current status of an upload, including recorded parts.

### Params

- `uploadId` (path, uuid)

### Response

```json
{
  "uploadId": "b3f1...-uuid",
  "state": "INIT",
  "filename": "video.mp4",
  "contentType": "video/mp4",
  "size": 10485760,
  "chunkSize": 5242880,
  "totalParts": 2,
  "uploadedParts": 1,
  "parts": [
    { "partNumber": 1, "etag": "\"...\"", "size": 5242880 }
  ],
  "createdAt": "...",
  "updatedAt": "...",
  "expiresAt": "..."
}
```

### Errors

- `"Upload not found"`

---

## `GET /uploads`

Lists uploads for a given uploader.

### Query Parameters

| Field | Type | Required | Notes |
|---|---|---|---|
| `uploadedById` | `string` | Yes | Matches the value passed at `init` |
| `tenantId` | `string` | No | Filter to a tenant |
| `state` | `string` | No | One of `INIT`, `UPLOADING`, `COMPLETED`, `FAILED`, `CANCELED` |

### Response

An array of upload rows (same shape as the `uploads` table), newest first.

---

## `GET /uploads/:uploadId/download`

Returns a presigned S3 GET URL for a completed upload.

### Params

- `uploadId` (path, uuid)

### Response

```json
{ "url": "https://s3.../uploads/.../myfile.pdf?X-Amz-Signature=..." }
```

The URL expires in 3600 seconds.

### Errors

- `"Upload not found"`
- `"UPLOAD_NOT_COMPLETED"` — the upload exists but hasn't finished (or was canceled)

---

## Example: End-to-End Flow

```bash
BASE=http://localhost:3001

# 1. Init
curl -s -X POST $BASE/uploads/init -H 'Content-Type: application/json' -d '{
  "filename": "video.mp4",
  "contentType": "video/mp4",
  "size": 10485760,
  "chunkSize": 5242880,
  "uploadedById": "user-123",
  "uploadedByType": "user"
}'
# -> { "uploadId": "...", "totalParts": 2, ... }

# 2. Presign + upload each part
curl -s -X POST $BASE/uploads/$UPLOAD_ID/presign-part -H 'Content-Type: application/json' -d '{"partNumber": 1}'
curl -X PUT "<presigned-url>" --data-binary @part1.bin -D headers.txt
ETAG=$(grep -i etag headers.txt | cut -d' ' -f2 | tr -d '\r')

# 3. Report completion
curl -s -X POST $BASE/uploads/$UPLOAD_ID/part-complete -H 'Content-Type: application/json' \
  -d "{\"PartNumber\": 1, \"ETag\": $ETAG}"

# ... repeat for remaining parts ...
# (the last part-complete call auto-completes the upload if all parts are in)

# 4. Complete (idempotent — safe to call even if auto-completed already)
curl -s -X POST $BASE/uploads/$UPLOAD_ID/complete

# 5. Download
curl -s $BASE/uploads/$UPLOAD_ID/download
```
