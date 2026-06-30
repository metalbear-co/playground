# syntax=docker/dockerfile:1.5
FROM node:20-bookworm AS builder
WORKDIR /app
COPY shared ./shared
COPY order-agent/package*.json ./order-agent/
WORKDIR /app/order-agent
RUN npm ci --omit=optional
COPY order-agent/tsconfig.json ./
COPY order-agent/src ./src
RUN cp -r /app/shared ./src/shared && npm run build

FROM node:20-bookworm AS runner
ENV NODE_ENV=production
WORKDIR /app/order-agent
COPY order-agent/package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY --from=builder /app/order-agent/dist ./dist
EXPOSE 80
CMD ["node", "dist/index.js"]
