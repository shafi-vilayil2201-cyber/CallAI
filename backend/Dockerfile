# Multi-stage Docker build for CallAI NestJS application

# ─── Stage 1: Builder ───────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source code
COPY tsconfig.json nest-cli.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ─── Stage 2: Runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Security: run as non-root user
RUN addgroup --system --gid 1001 callai && \
    adduser --system --uid 1001 callai

WORKDIR /app

# Copy production artifacts from builder
COPY --from=builder --chown=callai:callai /app/dist ./dist
COPY --from=builder --chown=callai:callai /app/node_modules ./node_modules
COPY --from=builder --chown=callai:callai /app/prisma ./prisma
COPY --from=builder --chown=callai:callai /app/package.json ./
COPY --chown=callai:callai public ./public

# Switch to non-root user
USER callai

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "dist/src/main"]
