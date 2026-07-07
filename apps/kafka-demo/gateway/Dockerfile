# Build context is the repo root (needs the shared go.mod/go.sum).
#   docker build -f apps/kafka-demo/gateway/Dockerfile -t kafka-demo-gateway:latest .
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS build-env

WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download
COPY apps/kafka-demo/gateway ./gateway

ARG TARGETARCH
# index.html is embedded via go:embed, so it must be present in ./gateway (it is).
RUN GOARCH=$TARGETARCH go build -o /main ./gateway

FROM gcr.io/distroless/static-debian11
COPY --from=build-env /main /main
CMD ["/main"]
