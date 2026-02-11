# Security Recommendations - Backend Service Behind Gateway

## 🔍 Current Security Posture

### ✅ Currently Implemented

| Security Control | Status | Location |
|-----------------|--------|----------|
| Body Size Limiting | ✅ | [body-limit.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/body-limit.ts) |
| Input Sanitization | ✅ | [sanitizer.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/sanitizer.ts) |
| Request Validation | ✅ | Route-level schema validation |
| Error Handling | ✅ | [error-handler.ts](file:///home/asutosh/Desktop/upload-service/src/middleware/error-handler.ts) |
| CORS | ✅ | [app.ts:L22-L29](file:///home/asutosh/Desktop/upload-service/src/app.ts#L22-L29) |
| Rate Limiting | ⚠️ | Implemented but disabled |
| Distributed Locking | ✅ | [redislock.ts](file:///home/asutosh/Desktop/upload-service/src/redis/redislock.ts) |

---

## 🚨 Critical Gaps & Recommendations

### 1. **Authentication & Authorization** ⚠️ CRITICAL

> [!CAUTION]
> **No authentication/authorization is currently implemented!**

Even behind a gateway, you should validate authenticated requests.

#### Recommended: Add JWT Validation Middleware

```typescript
// src/middleware/auth.ts
import { verify } from 'jsonwebtoken';
import { env } from '@/utils/env';

export interface AuthContext {
  userId: string;
  tenantId?: string;
  role: string;
  permissions: string[];
}

export const authMiddleware = {
  before: async (ctx: any) => {
    // Extract token from header (gateway should forward this)
    const authHeader = ctx.request.headers.get('x-user-context') || 
                      ctx.request.headers.get('authorization');
    
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      // If gateway forwards user context as base64-encoded JSON
      if (authHeader.startsWith('x-user-context')) {
        const userContext = JSON.parse(
          Buffer.from(authHeader, 'base64').toString('utf-8')
        );
        ctx.user = userContext;
      } 
      // Or validate JWT if gateway forwards it
      else {
        const token = authHeader.replace('Bearer ', '');
        const decoded = verify(token, env.JWT_SECRET);
        ctx.user = decoded;
      }
    } catch (err) {
      return new Response('Invalid token', { status: 401 });
    }
  }
};
```

#### Add Ownership Validation in Services

```typescript
// Validate user ownership in upload operations
async cancelUpload(uploadId: string, userId: string) {
  const upload = await this.uploadRepo.getUpload(uploadId);
  
  // ⚠️ CRITICAL: Verify ownership
  if (upload.uploadedById !== userId) {
    throw new Error('FORBIDDEN: Access denied');
  }
  
  // ... rest of logic
}
```

---

### 2. **Request Context Headers** ✅ RECOMMENDED

> [!IMPORTANT]
> Gateway should forward trusted headers for tracing and validation.

#### Headers to Accept from Gateway

```typescript
// src/middleware/gateway-headers.ts
export const gatewayHeaders = {
  before: (ctx: any) => {
    // Trust headers from gateway only
    const trustedHeaders = {
      userId: ctx.request.headers.get('x-user-id'),
      tenantId: ctx.request.headers.get('x-tenant-id'),
      traceId: ctx.request.headers.get('x-trace-id'),
      requestId: ctx.request.headers.get('x-request-id'),
      clientIp: ctx.request.headers.get('x-forwarded-for'),
      userAgent: ctx.request.headers.get('x-forwarded-user-agent'),
    };

    // Attach to context
    ctx.gateway = trustedHeaders;
    
    // Override store.requestId with gateway's
    if (trustedHeaders.requestId) {
      ctx.store.requestId = trustedHeaders.requestId;
    }
  }
};
```

---

### 3. **Tenant Isolation** ⚠️ CRITICAL

> [!CAUTION]
> Current implementation accepts `tenantId` from request body without validation!

#### Add Multi-Tenancy Middleware

```typescript
// src/middleware/tenant-isolation.ts
export const tenantIsolation = {
  before: (ctx: any) => {
    const userTenantId = ctx.user?.tenantId; // from JWT
    const requestTenantId = ctx.body?.tenantId; // from payload

    // Enforce tenant boundary
    if (requestTenantId && requestTenantId !== userTenantId) {
      return new Response('Forbidden: Tenant mismatch', { status: 403 });
    }

    // Force tenant ID from authenticated context
    if (ctx.body && typeof ctx.body === 'object') {
      ctx.body.tenantId = userTenantId;
    }
  }
};
```

---

### 4. **Internal Service Communication Security** ✅ RECOMMENDED

Since this is behind a gateway, add validation that requests ONLY come from trusted sources.

```typescript
// src/middleware/internal-only.ts
export const internalOnly = {
  before: (ctx: any) => {
    const internalToken = ctx.request.headers.get('x-internal-token');
    
    // Shared secret between gateway and service
    if (internalToken !== env.INTERNAL_SERVICE_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
  }
};
```

**Alternative**: Use mTLS (Mutual TLS) for service-to-service communication.

---

### 5. **Modify CORS Configuration** ⚠️ ACTION REQUIRED

> [!WARNING]
> Current CORS is configured for direct browser access (`localhost:3000`)

**For Backend Service Behind Gateway:**
- CORS is typically NOT needed (gateway handles it)
- If health checks come from other services, allow them

#### Recommended Configuration

```typescript
// app.ts - Option 1: Disable CORS (recommended)
const app = new Elysia()
  // Remove .use(cors({...}))
  
// app.ts - Option 2: Restrict to internal services only
const app = new Elysia()
  .use(cors({
    origin: env.ALLOWED_INTERNAL_ORIGINS.split(','), // ['http://gateway:8080']
    credentials: false, // No cookies needed for service-to-service
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }))
```

---

### 6. **Rate Limiting Strategy** ⚠️ NEEDS DECISION

Current implementation:
```typescript
// Currently disabled in app.ts:36
// .onBeforeHandle(rateLimiter(100, 1000).before)
```

#### Recommendation for Backend Services

**Option A**: Remove service-level rate limiting (gateway handles it)
- Gateway already rate limits per user/IP
- Cleaner separation of concerns

**Option B**: Keep for defense in depth
- Protects against gateway bypass
- Different limits: per tenant, per upload session
- Use Redis-based rate limiting for distributed systems

```typescript
// Enhanced Redis-based rate limiter
import RedisClient from '@/clients/redis.client';

export const redisRateLimiter = (key: string, limit: number, window: number) => {
  return {
    before: async (ctx: any) => {
      const redis = RedisClient.getInstance();
      const identifier = `ratelimit:${key}:${ctx.user?.userId || ctx.gateway?.clientIp}`;
      
      const count = await redis.incr(identifier);
      
      if (count === 1) {
        await redis.expire(identifier, window);
      }
      
      if (count > limit) {
        return new Response('Too Many Requests', { 
          status: 429,
          headers: {
            'Retry-After': String(window)
          }
        });
      }
    }
  };
};
```

---

### 7. **Input Validation Enhancements** ✅ RECOMMENDED

Current sanitizer is basic. Enhance for upload-specific threats:

```typescript
// src/middleware/upload-validator.ts
export const uploadValidator = {
  before: (ctx: any) => {
    if (ctx.body?.filename) {
      const filename = ctx.body.filename;
      
      // Prevent path traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return new Response('Invalid filename', { status: 400 });
      }
      
      // Enforce allowed extensions
      const allowedExtensions = ['.jpg', '.png', '.pdf', '.mp4', '.zip'];
      const hasValidExt = allowedExtensions.some(ext => 
        filename.toLowerCase().endsWith(ext)
      );
      
      if (!hasValidExt) {
        return new Response('File type not allowed', { status: 400 });
      }
      
      // Max filename length
      if (filename.length > 255) {
        return new Response('Filename too long', { status: 400 });
      }
    }
    
    // Validate content type against allowed types
    if (ctx.body?.contentType) {
      const allowedTypes = /^(image|video|application)\/(jpeg|png|pdf|mp4|zip)$/;
      if (!allowedTypes.test(ctx.body.contentType)) {
        return new Response('Content type not allowed', { status: 400 });
      }
    }
    
    // Enforce max file size (e.g., 5GB)
    if (ctx.body?.size && ctx.body.size > 5 * 1024 * 1024 * 1024) {
      return new Response('File too large', { status: 413 });
    }
  }
};
```

---

### 8. **Audit Logging** ✅ RECOMMENDED

Track security-relevant events:

```typescript
// src/middleware/audit-logger.ts
import { logger } from '@/utils/logger';

export const auditLogger = {
  after: (ctx: any) => {
    // Log security events
    const auditableActions = [
      '/uploads/init',
      '/uploads/:uploadId/complete',
      '/uploads/:uploadId', // DELETE
    ];
    
    if (auditableActions.some(path => ctx.path.includes('uploads'))) {
      logger.info({
        event: 'UPLOAD_ACTION',
        userId: ctx.user?.userId,
        tenantId: ctx.user?.tenantId,
        action: ctx.request.method,
        path: ctx.path,
        ip: ctx.gateway?.clientIp,
        userAgent: ctx.gateway?.userAgent,
        requestId: ctx.store.requestId,
        timestamp: new Date().toISOString(),
      });
    }
  }
};
```

---

### 9. **Secrets Management** ⚠️ CRITICAL

> [!CAUTION]
> Never hardcode secrets. Use environment variables with proper validation.

Current implementation uses `env` utility. Ensure:

```typescript
// src/utils/env.ts - Add validation
export const env = {
  // Existing vars...
  JWT_SECRET: process.env.JWT_SECRET || throwError('JWT_SECRET required'),
  INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || throwError('Required'),
  
  // Validate critical configs
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || throwError('S3_ACCESS_KEY required'),
  REDIS_URL: process.env.REDIS_URL || throwError('REDIS_URL required'),
};

function throwError(msg: string): never {
  throw new Error(`Configuration Error: ${msg}`);
}
```

---

### 10. **Security Headers** ✅ OPTIONAL (Gateway's Job)

Typically gateway sets these, but for defense in depth:

```typescript
// src/middleware/security-headers.ts
export const securityHeaders = {
  after: (ctx: any) => {
    ctx.set.headers['X-Content-Type-Options'] = 'nosniff';
    ctx.set.headers['X-Frame-Options'] = 'DENY';
    ctx.set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    ctx.set.headers['X-XSS-Protection'] = '1; mode=block';
  }
};
```

---

### 11. **Database Query Safety** ✅ GOOD

Current implementation uses **Drizzle ORM**, which provides:
- ✅ Parameterized queries (SQL injection protection)
- ✅ Type safety

Keep using ORM, avoid raw SQL queries.

---

### 12. **Error Information Disclosure** ⚠️ NEEDS IMPROVEMENT

Current error handler:
```typescript
// app.ts:54-60
.onError(({ error, request }) => {
  logger.error({ err: error, url: request.url }, "Unhandled error");
  return {
    status: "error",
    message: env.NODE_ENV === "production" ? "Internal Server Error" : error,
  };
})
```

> [!WARNING]
> In production, this still exposes error details!

#### Improved Version:

```typescript
.onError(({ error, request, store }) => {
  logger.error({ err: error, url: request.url }, "Unhandled error");
  
  // Never expose internal errors in production
  if (env.NODE_ENV === "production") {
    return {
      status: "error",
      message: "An unexpected error occurred",
      requestId: store?.requestId // For support tracking
    };
  }
  
  return {
    status: "error",
    message: error.message,
    stack: error.stack,
  };
})
```

---

## 📋 Recommended Middleware Stack (Behind Gateway)

```typescript
// src/app.ts - Updated configuration
const app = new Elysia()
  // ❌ Remove public CORS (gateway handles it)
  // .use(cors({...}))
  
  .use(cookie()) // If needed for sessions
  
  .state({
    start: 0,
    requestId: "",
    user: null, // For authenticated user context
    gateway: null, // For gateway headers
  })
  
  // 1️⃣ Internal service validation (first!)
  .onBeforeHandle(internalOnly.before)
  
  // 2️⃣ Extract gateway headers (request ID, user context, etc.)
  .onBeforeHandle(gatewayHeaders.before)
  
  // 3️⃣ Authentication (validate user from gateway headers or JWT)
  .onBeforeHandle(authMiddleware.before)
  
  // 4️⃣ Tenant isolation
  .onBeforeHandle(tenantIsolation.before)
  
  // 5️⃣ Request size limits
  .onBeforeHandle(bodyLimit(10 * 1024 * 1024).before) // 10MB for metadata
  
  // 6️⃣ Input sanitization
  .onBeforeHandle(sanitizer.before)
  
  // 7️⃣ Upload-specific validation
  .onBeforeHandle(uploadValidator.before)
  
  // 8️⃣ Rate limiting (optional, if not handled by gateway)
  // .onBeforeHandle(redisRateLimiter('uploads', 100, 60).before)
  
  // After request handlers
  .onAfterHandle(auditLogger.after)
  .onAfterHandle(requestLogger.after)
  .onAfterHandle(metricsHandler)
  
  // Error handling
  .onError(globalErrorHandler());
```

---

## ✅ Action Items Summary

### 🔴 Critical (Do Immediately)

1. **Implement authentication middleware** with user context validation
2. **Add tenant isolation** to prevent cross-tenant access
3. **Validate request ownership** in all upload operations
4. **Remove or restrict CORS** (gateway's responsibility)
5. **Fix error disclosure** in production

### 🟡 High Priority

6. **Add internal service token validation** (`x-internal-token`)
7. **Implement upload-specific input validation** (filename, content-type, size)
8. **Add audit logging** for compliance
9. **Implement Redis-based rate limiting** (if not handled by gateway)

### 🟢 Nice to Have

10. **Add security headers** (defense in depth)
11. **Implement file type validation** beyond extension checking
12. **Add request size limits per route** (different for metadata vs. actual uploads)
13. **Monitor and alert** on suspicious patterns

---

## 🔐 Environment Variables Checklist

Add these to your `.env`:

```bash
# Authentication
JWT_SECRET=<strong-secret-key>
JWT_ISSUER=api-gateway

# Internal service security
INTERNAL_SERVICE_SECRET=<shared-gateway-secret>

# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60

# Upload restrictions
MAX_FILE_SIZE=5368709120  # 5GB
ALLOWED_FILE_TYPES=image/jpeg,image/png,video/mp4,application/pdf

# Logging
LOG_LEVEL=info
AUDIT_LOG_ENABLED=true
```

---

## 📊 Security vs. Performance Trade-offs

| Control | Performance Impact | Recommendation |
|---------|-------------------|----------------|
| JWT Validation | Low | ✅ Always enable |
| Tenant Isolation | Minimal | ✅ Always enable |
| Input Sanitization | Low-Medium | ✅ Always enable |
| Redis Rate Limiting | Low | ⚠️ Optional (gateway may handle) |
| Audit Logging | Low | ✅ Enable for compliance |
| File Type Validation | Low | ✅ Enable |
| Deep File Scanning | High | ⚠️ Consider async processing |

---

## 🎯 Conclusion

Since your service is **behind a gateway**, you can rely on the gateway for:
- ✅ Public-facing CORS
- ✅ TLS termination
- ✅ Public rate limiting
- ✅ DDoS protection

Your service should focus on:
- ✅ **Authentication/Authorization** (validate gateway-forwarded context)
- ✅ **Tenant isolation**
- ✅ **Business logic validation**
- ✅ **Audit logging**
- ✅ **Defense in depth** (don't trust gateway blindly)

> [!TIP]
> **Zero Trust Principle**: Even behind a gateway, validate everything!
