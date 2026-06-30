# syntax=docker/dockerfile:1.5
FROM node:20-bookworm AS builder
WORKDIR /app
COPY shared ./shared
COPY router-agent/package*.json ./router-agent/
WORKDIR /app/router-agent
RUN npm ci --omit=optional
COPY router-agent/tsconfig.json ./
COPY router-agent/src ./src
RUN cp -r /app/shared ./src/shared && npm run build

FROM node:20-bookworm AS runner
ENV NODE_ENV=production
WORKDIR /app/router-agent
COPY router-agent/package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY --from=builder /app/router-agent/dist ./dist
EXPOSE 80
CMD ["node", "dist/index.js"]
