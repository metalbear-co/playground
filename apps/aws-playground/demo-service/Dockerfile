# syntax=docker/dockerfile:1.5
FROM node:22-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=optional
COPY tsconfig.json .
COPY src src
RUN npm run build

# The deployed task preloads mirrord's remote bootstrap library, which is built
# against glibc and needs a dynamic loader. An Alpine/musl base would ignore
# LD_PRELOAD without reporting anything, so this stays on bookworm.
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "dist/index.js"]
