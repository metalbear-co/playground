FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js server.js ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /src/package.json /src/server.js ./
COPY --from=build /src/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server.js"]
