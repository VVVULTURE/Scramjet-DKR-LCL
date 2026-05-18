# ── Scramjet Proxy — Render Dockerfile ───────────────────────────
# Pure node:http server (no Fastify). Render injects $PORT at runtime.
# The scramjet package is fetched from a GitHub release tarball.

FROM node:20-alpine

# Non-root user for security
RUN addgroup -S scramjet && adduser -S scramjet -G scramjet

WORKDIR /app

# Install build tools needed for native deps (e.g. ws, libcurl bindings)
RUN apk add --no-cache python3 make g++

# Copy package manifest and install deps
COPY --chown=scramjet:scramjet package.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy app source
COPY --chown=scramjet:scramjet . .

USER scramjet

# Render sets PORT at runtime; 8080 is just the build-time default
EXPOSE 8080

# Health check for Render's load balancer
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

CMD ["node", "src/index.js"]
