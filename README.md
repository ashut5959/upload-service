# Upload Service

A backend service for resumable, chunked file uploads to S3-compatible object storage, built with [Bun](https://bun.com) and [Elysia](https://elysiajs.com). It coordinates S3 multipart uploads with a Postgres-backed upload ledger and Redis-based distributed locking, so large file uploads can pause, resume, and complete reliably from the client side.

## Overview

Clients don't upload file bytes through this service — they upload parts directly to S3 using presigned URLs. This service is the control plane:

1. Initializes (or resumes) an S3 multipart upload and records it in Postgres.
2. Issues presigned PUT URLs for individual parts.
3. Records each part's ETag as the client reports it uploaded.
4. Completes the S3 multipart upload once all parts are accounted for.
5. Aborts and cleans up on cancellation.

See [docs/architecture.md](docs/architecture.md) for the full request flow and data model, and [docs/api.md](docs/api.md) for the complete API reference.

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime / HTTP framework | [Bun](https://bun.com) + [Elysia](https://elysiajs.com) |
| Object storage | AWS S3 (or any S3-compatible store, e.g. MinIO) via `@aws-sdk/client-s3` |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team) |
| Locking / coordination | Redis via `ioredis` |
| Validation | Zod (env, DTOs) + Elysia's built-in schema validation |
| Logging | Pino (stdout + rotating file) |
| Metrics | `prom-client`, scraped at `/metrics` |

## Getting Started

### Prerequisites

- [Bun](https://bun.com) v1.3+
- Docker (for Postgres, Redis, and MinIO if you don't have them already)

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

Copy `.env` (already present for local dev) and adjust as needed. See [Configuration](#configuration) below for the full variable list.

### 3. Start infrastructure

The included `docker-compose.yml` provides Postgres (+ PgBouncer), Redis, MinIO, and an Elasticsearch/Kibana logging stack.

```bash
# Core services only
docker compose up -d postgres pgbouncer redis minio elasticsearch

# Include dev-only UIs (pgAdmin, RedisInsight, Kibana)
docker compose --profile dev up -d
```

### 4. Run database migrations

```bash
bun run migrate        # drizzle-kit push (schema sync, good for local dev)
# or
bun run migrate:run    # applies versioned migrations from ./drizzle via migrate.ts
```

### 5. Run the service

```bash
bun run dev    # bun --watch index.ts
```

The service listens on `PORT` (default `3001`). Verify it's up:

```bash
curl http://localhost:3001/health
```

## Configuration

Environment variables are validated at startup via Zod ([src/utils/env.ts](src/utils/env.ts)); the process exits immediately if a required variable is missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | HTTP port the service listens on |
| `NODE_ENV` | No | `development` | `development` \| `production` \| `test` |
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `REDIS_URL` | Yes | — | Redis connection string (used for distributed locks) |
| `S3_ENDPOINT` | Yes | — | S3 / MinIO endpoint URL |
| `S3_REGION` | Yes | — | S3 region |
| `S3_ACCESS_KEY` | Yes | — | S3 access key |
| `S3_SECRET_KEY` | Yes | — | S3 secret key |
| `S3_BUCKET` | Yes | — | Target bucket for uploads |
| `ELASTICSEARCH_URL` | Yes | — | Elasticsearch endpoint (log shipping) |
| `ELASTIC_USERNAME` | Yes | — | Elasticsearch username |
| `ELASTIC_PASSWORD` | Yes | — | Elasticsearch password |

> `JWT_SECRET` appears in `.env` but is not currently read or enforced anywhere in the code — authentication is not yet implemented. See [docs/security_recommendations.md](docs/security_recommendations.md).

## API Reference

Full request/response schemas, examples, and error formats are in [docs/api.md](docs/api.md). Summary:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health`, `/ready`, `/`, `/version`, `/info` | Health and liveness checks |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/uploads/init` | Start a new upload, or resume an existing one |
| `POST` | `/uploads/:uploadId/presign-part` | Get a presigned URL for one part |
| `POST` | `/uploads/:uploadId/part-complete` | Record a completed part's ETag |
| `POST` | `/uploads/:uploadId/complete` | Finalize the multipart upload |
| `DELETE` | `/uploads/:uploadId` | Cancel/abort an upload |

## Project Structure

```
src/
├── app.ts                    # Elysia app: middleware wiring, health routes
├── routes/                   # Route definitions + request schema validation
├── controllers/              # Thin HTTP-to-service adapters
├── services/                 # Business logic (upload lifecycle, locking)
├── repositories/              # Drizzle-backed data access
├── strategies/                # Storage backends (S3StorageStrategy)
├── dtos/                     # Zod schemas / types shared across layers
├── db/schema.ts               # Drizzle table definitions
├── clients/                  # Singletons: Postgres, Redis, S3
├── middleware/                # Body limits, CORS, sanitization, metrics, logging, error handling
├── redis/redislock.ts         # Distributed lock (SET NX + Lua-guarded release)
├── utils/                    # env validation, logger
└── workers/                   # Background worker scaffold (not yet implemented)

drizzle/          # SQL migrations + schema snapshots
docs/             # Architecture, API, design-pattern, and security docs
k8s/              # Kustomize manifests for base/dev/production
```

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the service with file watching |
| `bun run start` | Start the service (no watch) |
| `bun run build` | Bundle to `dist/server.js` |
| `bun run db:generate` | Generate a new Drizzle migration from schema changes |
| `bun run db:push` | Push schema changes directly to the DB (dev) |
| `bun run db:migrate` | Apply migrations via drizzle-kit |
| `bun run migrate:run` | Apply migrations via `migrate.ts` (used in Docker/k8s init) |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run lint` / `lint:fix` | ESLint |
| `bun run format` / `format:check` | Prettier |
| `bun run typecheck` | `tsc --noEmit` |

## Deployment

- **Docker**: multi-stage [Dockerfile](Dockerfile) (deps → builder → runtime), runs as a non-root user. `docker-compose.yml` wires up the full local stack, including a one-shot `migrate` service (`--profile migrate`).
- **Kubernetes**: Kustomize manifests under [k8s/](k8s/base) with `dev` and `production` overlays. See [k8s/README.md](k8s/README.md) for the full deployment guide and [k8s/QUICKSTART.md](k8s/QUICKSTART.md) for the condensed version.

## Further Reading

- [docs/architecture.md](docs/architecture.md) — layers, upload lifecycle, state machine, data model
- [docs/api.md](docs/api.md) — full API reference
- [docs/design_patterns_analysis.md](docs/design_patterns_analysis.md) — design patterns used in the codebase
- [docs/security_recommendations.md](docs/security_recommendations.md) — current security posture and open gaps (notably: no auth/ownership checks yet)
- [k8s/README.md](k8s/README.md) — Kubernetes deployment guide
