# Build context is the repo root (needs the shared go.mod/go.sum).
#   docker build -f apps/kafka-demo/service-a/Dockerfile -t kafka-demo-service-a:latest .
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS build-env

WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download
COPY apps/kafka-demo/service-a ./service-a

ARG TARGETARCH
RUN GOARCH=$TARGETARCH go build -o /main ./service-a

FROM gcr.io/distroless/static-debian11
COPY --from=build-env /main /main
CMD ["/main"]
