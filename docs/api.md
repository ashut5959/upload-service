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

In non-production environments (`NODE_ENV !== "production"`), `message` contains the raw error instead of a generic string. Business-logic errors thrown by the service layer (e.g. `"Upload not found"`) currently surface this way with a `500` status — there is no typed error-to-status mapping in the upload flow, so expect `500` for conditions that are really `400`/`404`/`409` (see [architecture.md](architecture.md#known-gaps)).

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

### Errors

- Resuming a nonexistent `uploadId` → `"UPLOAD_NOT_FOUND"`.

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
  "totalParts": 4
}
```

Re-reporting the same `PartNumber` upserts the stored ETag rather than creating a duplicate row (unique on `uploadId, partNumber`), but note the `uploadedParts` counter increments on every call regardless — see [architecture.md](architecture.md#known-gaps) for the caveat that this counter can drift above the true distinct-parts count on retries. `POST /uploads/:uploadId/complete` does not rely on this counter — it recounts actual `upload_parts` rows.

Nothing in this endpoint verifies the `ETag` against S3; a client can report an incorrect ETag and it will only fail later, at `complete`, when S3 rejects the mismatched part list.

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

- Guarded by a Redis lock (`upload:<uploadId>:complete`); a concurrent second call fails with `LOCK_NOT_ACQUIRED` instead of double-completing.
- Requires the number of recorded `upload_parts` rows to exactly equal `totalParts`; otherwise:  
  `"Upload incomplete: expected {totalParts}, but only {n} parts uploaded"`.

### Errors

- `"Upload not found"`
- `"S3 uploadId missing — cannot complete multipart upload"`
- `"No uploaded parts found"`
- `"Upload incomplete: expected N, but only M parts uploaded"`
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

# 4. Complete
curl -s -X POST $BASE/uploads/$UPLOAD_ID/complete
```
