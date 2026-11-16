# syntax=docker/dockerfile:1.5
# The deployed task preloads mirrord's remote bootstrap library, which is built
# against glibc and needs a dynamic loader. An Alpine/musl base would ignore
# LD_PRELOAD without reporting anything, so this stays on bookworm.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Node carries its own CA bundle, so this service needs none. The mirrord
# bootstrap preloaded into this container does: it reads the system trust store,
# and without one its TLS connection to sessions-manager fails on handshake.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server.js ./

USER node
EXPOSE 8080

CMD ["node", "server.js"]
