# syntax=docker/dockerfile:1.5
FROM node:20-bookworm AS builder
WORKDIR /app
COPY shared ./shared
COPY catalog-agent/package*.json ./catalog-agent/
WORKDIR /app/catalog-agent
RUN npm ci --omit=optional
COPY catalog-agent/tsconfig.json ./
COPY catalog-agent/src ./src
RUN cp -r /app/shared ./src/shared && npm run build

FROM node:20-bookworm AS runner
ENV NODE_ENV=production
WORKDIR /app/catalog-agent
COPY catalog-agent/package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY --from=builder /app/catalog-agent/dist ./dist
EXPOSE 80
CMD ["node", "dist/index.js"]
