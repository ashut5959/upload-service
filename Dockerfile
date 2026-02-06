# -------- Builder --------
FROM oven/bun:1.1.34-alpine AS builder

WORKDIR /app

COPY bun.lock package.json tsconfig.json ./
COPY src ./src
RUN bun install --frozen-lockfile

COPY . .
RUN bun build index.ts --outdir dist --target=bun

# -------- Runtime --------
FROM oven/bun:1.1.34-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY package.json .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "dist/app.js"]
