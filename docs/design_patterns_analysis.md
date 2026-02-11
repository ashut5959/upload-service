# Design Patterns Analysis - Upload Service

This document provides a comprehensive analysis of the design patterns implemented in the upload service codebase.

---

## 🏗️ Creational Patterns

### 1. **Singleton Pattern** ✅

The Singleton pattern ensures that a class has only one instance and provides a global point of access to it.

#### Implementation Examples:

**Redis Client Singleton**
- **File**: [redis.client.ts](file:///home/asutosh/Desktop/upload-service/src/clients/redis.client.ts)
- **Usage**: Ensures only one Redis connection instance exists throughout the application
```typescript
export default class RedisClient {
  private static instance: Redis;

  static getInstance() {
    if (!this.instance) this.instance = new Redis(env.REDIS_URL);
    return this.instance;
  }
}
```

**S3 Client Singleton**
- **File**: [s3.client.ts](file:///home/asutosh/Desktop/upload-service/src/clients/s3.client.ts)
- **Usage**: Maintains a single S3Client instance to avoid multiple credential initializations
```typescript
export default class S3ClientSingleton {
  private static instance: S3Client;

  static getInstance() {
    if (!this.instance) {
      this.instance = new S3Client({...config});
    }
    return this.instance;
  }
}
```

**Database Client (Module-based Singleton)**
- **File**: [db.client.ts](file:///home/asutosh/Desktop/upload-service/src/clients/db.client.ts)
- **Usage**: Uses module-level variables to ensure single database connection
```typescript
let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export const getDb = () => {
  if (!client || !db) {
    client = postgres(env.DATABASE_URL, {...});
    db = drizzle(client, { schema });
  }
  return db;
};
```

> [!IMPORTANT]
> **Benefits**: 
> - Prevents connection pool exhaustion
> - Reduces memory overhead
> - Ensures consistent configuration across the application

---

### 2. **Factory Pattern** ❌

**Status**: Not explicitly implemented

While there's no explicit Factory pattern, the pattern could be beneficial for:
- Creating different storage strategies based on configuration
- Generating different upload strategies (single-part vs multi-part)

**Potential Implementation**: A factory could be added to instantiate storage strategies based on environment:
```typescript
// Potential enhancement
class StorageFactory {
  static create(type: 's3' | 'minio'): StorageStrategy {
    switch(type) {
      case 's3': return new S3StorageStrategy();
      case 'minio': return new MinioStorageStrategy();
    }
  }
}
```

---

### 3. **Abstract Factory Pattern** ❌

**Status**: Not implemented

The codebase uses direct instantiation rather than abstract factories.

---

### 4. **Builder Pattern** ❌

**Status**: Not explicitly implemented

The codebase uses plain object construction and DTOs with Zod validation instead of builders.

**Alternative Approach**: The application uses **Data Transfer Objects (DTOs)** with schema validation, which provides similar benefits to the Builder pattern:
- [upload.dto.ts](file:///home/asutosh/Desktop/upload-service/src/dtos/upload.dto.ts)

---

## 🏛️ Structural Patterns

### 1. **Repository Pattern** ✅

The Repository pattern abstracts data access logic and provides a collection-like interface for accessing domain objects.

#### Implementation Examples:

**Upload Repository**
- **File**: [upload.repository.ts](file:///home/asutosh/Desktop/upload-service/src/repositories/upload.repository.ts)
- **Purpose**: Encapsulates all database operations related to uploads
- **Key Methods**:
  - `createUpload()`
  - `getUpload()`
  - `markCompleted()`
  - `markCanceled()`

**Part Repository**
- **File**: [part.repository.ts](file:///home/asutosh/Desktop/upload-service/src/repositories/part.repository.ts)
- **Purpose**: Manages upload part records
- **Key Methods**:
  - `savePart()`
  - `listParts()`
  - `countParts()`
  - `deleteParts()`

> [!NOTE]
> The Repository pattern provides:
> - Clean separation between business logic and data access
> - Easier testing through dependency injection
> - Centralized data access logic

---

### 2. **Strategy Pattern** ✅

The Strategy pattern defines a family of algorithms, encapsulates each one, and makes them interchangeable.

#### Implementation:

**Storage Strategy Interface**
- **File**: [storage.strategy.ts](file:///home/asutosh/Desktop/upload-service/src/strategies/storage.strategy.ts)
- **Purpose**: Defines contract for different storage implementations

**Concrete Strategies**:

1. **S3StorageStrategy**
   - **File**: [s3.storage.ts](file:///home/asutosh/Desktop/upload-service/src/strategies/s3.storage.ts)
   - **Implements**: AWS S3 multipart upload operations

2. **MinioStorageStrategy** (Placeholder)
   - **File**: [minio.storage.ts](file:///home/asutosh/Desktop/upload-service/src/strategies/minio.storage.ts)
   - **Status**: Prepared for future implementation

```typescript
export default interface StorageStrategy {
  createMultipartUpload(data: {...}): Promise<{...}>;
  presignPart(data: {...}): Promise<{...}>;
  completeMultipartUpload(data: {...}): Promise<any>;
  abortMultipartUpload(data: {...}): Promise<any>;
  checkMultipartUpload(data: {...}): Promise<boolean>;
}
```

**Usage in Service**:
```typescript
export default class UploadService {
  constructor(
    private uploadRepo: UploadRepository,
    private partRepo: PartRepository,
    private storage: StorageStrategy  // ← Strategy injected
  ) { }
}
```

> [!TIP]
> This allows switching between AWS S3, MinIO, or any other storage provider without changing service logic.

---

### 3. **Adapter Pattern** ✅

The Adapter pattern converts the interface of a class into another interface clients expect.

#### Implementation:

**Client Adapters**
- **S3 Client**: [s3.client.ts](file:///home/asutosh/Desktop/upload-service/src/clients/s3.client.ts)
  - Adapts AWS SDK S3Client to application needs
  - Provides singleton instance with pre-configured credentials

- **Redis Client**: [redis.client.ts](file:///home/asutosh/Desktop/upload-service/src/clients/redis.client.ts)
  - Adapts ioredis library to application interface
  - Wraps connection configuration

- **Database Client**: [db.client.ts](file:///home/asutosh/Desktop/upload-service/src/clients/db.client.ts)
  - Adapts Drizzle ORM with postgres driver
  - Provides consistent interface for database operations

---

### 4. **Decorator Pattern** ✅ (Implicit)

The Decorator pattern attaches additional responsibilities to an object dynamically.

#### Implementation through Middleware Pipeline:

The application uses middleware composition which follows the Decorator pattern philosophy:

**Middleware Chain** (from [app.ts](file:///home/asutosh/Desktop/upload-service/src/app.ts:L35-L52)):
```typescript
.onBeforeHandle(bodyLimit(1024 * 1024).before)
.onBeforeHandle(sanitizer.before)
.onAfterHandle((ctx) => {
  // Request metrics
  httpRequestDuration.observe({...}, durationSec);
  httpRequestCounter.inc({...});
  requestLogger.after(ctx);
})
```

**Middleware Files**:
- [body-limit.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/body-limit.ts)
- [sanitizer.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/sanitizer.ts)
- [request-logger.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/request-logger.ts)
- [rate-limit.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/rate-limit.ts)

Each middleware "decorates" the request/response with additional behavior.

---

### 5. **Proxy Pattern** ✅

The Proxy pattern provides a surrogate or placeholder for another object to control access to it.

#### Implementation:

**Redis Lock as Distributed Proxy**
- **File**: [redislock.ts](file:///home/asutosh/Desktop/upload-service/src/redis/redislock.ts)
- **Purpose**: Acts as a proxy to control access to critical sections in distributed systems

```typescript
export const redisLock = async (key: string, fn: Function, ttl = 15000) => {
  const redis = RedisClient.getInstance();
  const token = crypto.randomUUID();

  const acquired = await redis.set(key, token, "PX", ttl, "NX");
  if (!acquired) throw new Error("LOCK_NOT_ACQUIRED");

  try {
    return await fn();  // ← Controlled execution
  } finally {
    // Release lock atomically
    await redis.eval(script, 1, key, token);
  }
};
```

**Usage Example** (from [upload.service.ts](file:///home/asutosh/Desktop/upload-service/src/services/upload.service.ts:L214)):
```typescript
async completeUpload(uploadId: string) {
  return redisLock(`upload:${uploadId}:complete`, async () => {
    // Critical section protected by distributed lock
  });
}
```

---

### 6. **Facade Pattern** ✅

The Facade pattern provides a simplified interface to a complex subsystem.

#### Implementation:

**UploadService as Facade**
- **File**: [upload.service.ts](file:///home/asutosh/Desktop/upload-service/src/services/upload.service.ts)
- **Purpose**: Provides a simplified interface to the complex upload subsystem

The service orchestrates:
- Database operations (via repositories)
- Storage operations (via strategy)
- Distributed locking (via Redis)
- Business logic validation

```typescript
export default class UploadService {
  constructor(
    private uploadRepo: UploadRepository,
    private partRepo: PartRepository,
    private storage: StorageStrategy
  ) { }

  async initUpload(data: InitUploadRequestDto): Promise<InitUploadResponseDto> {
    // Coordinates: DB, S3, validation, resume logic
  }

  async completeUpload(uploadId: string) {
    // Coordinates: locking, DB queries, S3 completion, state updates
  }
}
```

---

## 🎭 Behavioral Patterns

### 1. **Chain of Responsibility Pattern** ✅

The Chain of Responsibility pattern passes requests along a chain of handlers.

#### Implementation:

**Middleware Pipeline**
- Requests pass through a chain of middleware handlers
- Each handler can process the request and pass it to the next

**Handler Chain** (from [app.ts](file:///home/asutosh/Desktop/upload-service/src/app.ts)):
```typescript
.onBeforeHandle(bodyLimit(1024 * 1024).before)
.onBeforeHandle(rateLimiter(100, 1000).before)  // commented
.onBeforeHandle(sanitizer.before)
```

**Error Handler Chain**
- **File**: [error-handler.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/error-handler.ts)
- Different error types handled sequentially:

```typescript
if (error instanceof ZodError) { /* handle validation */ }
else if (error.name === "DrizzleError") { /* handle DB */ }
else if (error.$metadata) { /* handle AWS */ }
else if (error.status) { /* handle custom */ }
```

---

### 2. **Template Method Pattern** ✅ (Implicit)

The Template Method pattern defines the skeleton of an algorithm in a method, deferring some steps to subclasses.

#### Implementation:

**Storage Strategy Template**
- The `StorageStrategy` interface defines the template for storage operations
- Concrete implementations (`S3StorageStrategy`) provide specific steps

```typescript
// Template defined in interface
interface StorageStrategy {
  createMultipartUpload(...)  // Step 1
  presignPart(...)            // Step 2
  completeMultipartUpload(...) // Step 3
  abortMultipartUpload(...)   // Step 4
}

// S3-specific implementation
class S3StorageStrategy implements StorageStrategy {
  // Implements each step for S3
}
```

---

### 3. **Observer Pattern** ❌

**Status**: Not explicitly implemented

However, the architecture is prepared for event-driven patterns:
- Commented event logging in services (e.g., `UPLOAD_COMPLETED`)
- Could be extended with event emitters or message queues

**Potential Enhancement**:
```typescript
// From upload.service.ts (lines 265, 327)
// await this.eventRepo.log(uploadId, "UPLOAD_COMPLETED", { result });
// await this.eventRepo.log(uploadId, "UPLOAD_CANCELED", { by: "uploader" });
```

---

### 4. **Command Pattern** ❌

**Status**: Not implemented

The application uses direct method calls rather than command objects.

---

### 5. **State Pattern** ✅ (Implicit)

The State pattern allows an object to alter its behavior when its internal state changes.

#### Implementation:

**Upload State Machine**
- **States**: `INIT` → `UPLOADING` → `COMPLETED` / `FAILED` / `CANCELED`
- **File**: [upload.repository.ts](file:///home/asutosh/Desktop/upload-service/src/repositories/upload.repository.ts)

```typescript
export interface CreateUploadData {
  state: "INIT" | "UPLOADING" | "COMPLETED" | "FAILED" | "CANCELED";
  // ...
}

// State transitions
async markCompleted(uploadId: string, data: MarkCompletedData) {
  // Transition to COMPLETED
}

async markCanceled(uploadId: string, data?: MarkCanceledData) {
  // Transition to CANCELED
}
```

**State-based Logic** (from [upload.service.ts](file:///home/asutosh/Desktop/upload-service/src/services/upload.service.ts:L286-L291)):
```typescript
if (upload.state === "CANCELED") {
  return { status: "already_canceled" as const, uploadId };
}
if (upload.state === "COMPLETED") {
  return { status: "already_completed" as const, uploadId };
}
```

---

### 6. **Strategy + Dependency Injection Pattern** ✅

The application uses **Dependency Injection** extensively, particularly in the composition root.

#### Implementation:

**Composition Root** (from [upload.route.ts](file:///home/asutosh/Desktop/upload-service/src/routes/upload.route.ts:L15-L21)):
```typescript
// Composition Root: Wire all dependencies
const db = getDb();
const uploadRepo = new UploadRepository(db);
const partRepo = new PartRepository(db);
const storage = new S3StorageStrategy();
const uploadService = new UploadService(uploadRepo, partRepo, storage);
const uploadController = new UploadController(uploadService);
```

**Constructor Injection Examples**:

```typescript
// Controller
export default class UploadController {
  constructor(private uploadService: UploadService) { }
}

// Service
export default class UploadService {
  constructor(
    private uploadRepo: UploadRepository,
    private partRepo: PartRepository,
    private storage: StorageStrategy
  ) { }
}

// Repository
export default class PartRepository {
  constructor(private db: DbClient) {}
}
```

> [!IMPORTANT]
> **Benefits of DI**:
> - Loose coupling between components
> - Easy testing (can inject mocks)
> - Clear dependency graph
> - Single Responsibility Principle

---

## 📊 Pattern Summary

### ✅ Implemented Patterns

| Category | Pattern | Implementation | Strength |
|----------|---------|----------------|----------|
| **Creational** | Singleton | Redis, S3, DB Clients | ⭐⭐⭐⭐⭐ |
| **Structural** | Repository | Upload & Part Repos | ⭐⭐⭐⭐⭐ |
| **Structural** | Strategy | Storage abstraction | ⭐⭐⭐⭐⭐ |
| **Structural** | Adapter | Client wrappers | ⭐⭐⭐⭐ |
| **Structural** | Decorator | Middleware pipeline | ⭐⭐⭐⭐ |
| **Structural** | Proxy | Redis distributed lock | ⭐⭐⭐⭐⭐ |
| **Structural** | Facade | UploadService | ⭐⭐⭐⭐ |
| **Behavioral** | Chain of Responsibility | Middleware & errors | ⭐⭐⭐⭐ |
| **Behavioral** | Template Method | Storage interface | ⭐⭐⭐⭐ |
| **Behavioral** | State | Upload state machine | ⭐⭐⭐ |
| **Other** | Dependency Injection | Constructor injection | ⭐⭐⭐⭐⭐ |

### ❌ Not Implemented

| Pattern | Reason | Potential Use Case |
|---------|--------|-------------------|
| Factory | Simple construction sufficient | Could create storage strategies dynamically |
| Abstract Factory | Not needed for current scale | Multi-cloud deployment scenarios |
| Builder | DTOs with validation used instead | Complex request object construction |
| Observer | No event system yet | Event-driven notifications |
| Command | Direct calls simpler | Undo/redo, task queuing |

---

## 🎯 Architecture Highlights

### Layered Architecture

The application follows a clean **layered architecture**:

```
┌─────────────────────────────────────┐
│   Controllers (HTTP Layer)          │
├─────────────────────────────────────┤
│   Services (Business Logic)         │
├─────────────────────────────────────┤
│   Repositories (Data Access)        │
│   Strategies (External Services)    │
├─────────────────────────────────────┤
│   Clients (Infrastructure)          │
└─────────────────────────────────────┘
```

### Design Principles Applied

> [!NOTE]
> **SOLID Principles**:
> - ✅ **Single Responsibility**: Each class has one reason to change
> - ✅ **Open/Closed**: Storage strategy open for extension, closed for modification
> - ✅ **Liskov Substitution**: Any `StorageStrategy` implementation is interchangeable
> - ✅ **Interface Segregation**: Clean, focused interfaces
> - ✅ **Dependency Inversion**: Depend on abstractions (interfaces), not concretions

---

## 🚀 Recommendations

### Potential Enhancements

1. **Add Factory Pattern** for storage strategy selection
2. **Implement Observer Pattern** for upload events and notifications
3. **Add Builder Pattern** for complex DTO construction
4. **Enhance State Pattern** with explicit state classes for upload lifecycle
5. **Consider Command Pattern** for queued operations

---

## 📝 Conclusion

The upload service demonstrates **excellent use of design patterns**, particularly:
- Strong use of **Dependency Injection** for testability
- **Strategy Pattern** for storage abstraction
- **Repository Pattern** for clean data access
- **Singleton Pattern** for resource management
- **Distributed Proxy** (Redis Lock) for concurrency control

The architecture is **clean, maintainable, and extensible**, following SOLID principles and industry best practices.
