# syntax=docker/dockerfile:1.5
FROM node:22-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=optional
COPY tsconfig.json .
COPY src src
RUN npm run build

# The bootstrap library a sidecar mounts into this container is built against
# glibc and needs a dynamic loader. An Alpine/musl base would ignore LD_PRELOAD
# without reporting anything, so this stays on bookworm.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# Node carries its own CA bundle, so nothing in this service needs these. The
# mirrord bootstrap preloaded into this container does: it is Rust, it reads the
# system trust store, and without one its TLS connection to sessions-manager
# fails on handshake and surfaces only as "EngineIO Error".
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "dist/index.js"]
