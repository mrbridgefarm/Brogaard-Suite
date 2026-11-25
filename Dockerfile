# ==============================================================================
# Hurtig Multi-Arch Dockerfile (linux/amd64 & linux/arm64) for Brogaard Suite
# Bruger --platform=$BUILDPLATFORM i build-stages, så Vite og TypeScript
# ikke skal emuleres i langsom QEMU på GitHub Actions (bygger på < 1 minut!)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend (Nativt på build-serveren)
# ------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:26-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Build Backend & Prod node_modules (Ren JS - arkitekturuafhængig)
# ------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:26-alpine AS backend-builder
WORKDIR /app/backend

COPY backend/package.json ./
RUN npm install --no-audit --no-fund

COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 3: Production Runtime (Target arkitektur: linux/amd64 eller linux/arm64)
# CVE-hærdet: Opgraderer alle Alpine OS-pakker og fjerner npm/corepack/yarn.
# ------------------------------------------------------------------------------
FROM node:26-alpine AS runtime
WORKDIR /app

RUN apk update && apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /var/cache/apk/*

ENV NODE_ENV=production
ENV PORT=3000
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

COPY backend/package.json ./
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./public

# Opret data-mappe til krypteret sessionsnøgle, aliaser, abonnementer og delingslinks
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
