# -------- Dependencies --------
FROM oven/bun:1.1.34-alpine AS deps

# Install only production dependencies for smaller image
WORKDIR /app
COPY bun.lock package.json ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# -------- Builder --------
FROM oven/bun:1.1.34-alpine AS builder

WORKDIR /app

# Copy dependency files first for better layer caching
COPY bun.lock package.json tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src

# -------- Runtime --------
FROM oven/bun:1.1.34-alpine AS runtime

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S bunuser && \
    adduser -S -u 1001 -G bunuser bunuser

# Create logs directory with proper ownership
RUN mkdir -p /app/logs && chown -R bunuser:bunuser /app/logs

# Copy only production dependencies from deps stage
COPY --from=deps --chown=bunuser:bunuser /app/node_modules ./node_modules

# Copy source code and config
COPY --from=builder --chown=bunuser:bunuser /app/src ./src
COPY --chown=bunuser:bunuser package.json tsconfig.json drizzle.config.ts ./

# Copy drizzle migrations folder
COPY --chown=bunuser:bunuser drizzle ./drizzle

# Switch to non-root user
USER bunuser

# Set environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start application
CMD ["bun", "src/app.ts"]
