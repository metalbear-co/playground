# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
ARG NEXT_BASE_PATH=""
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_DISABLE_TURBO=1
ENV NEXT_BASE_PATH=${NEXT_BASE_PATH}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
ARG NEXT_BASE_PATH=""
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV NEXT_BASE_PATH=${NEXT_BASE_PATH}
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_BASE_PATH}
WORKDIR /app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
