FROM --platform=$BUILDPLATFORM golang:1.23-bookworm AS build

WORKDIR /app
COPY go.mod ./
COPY *.go ./

ARG TARGETARCH
# The deployed task preloads mirrord's remote bootstrap library, which needs a
# dynamic loader and glibc. A statically linked binary on a distroless-static
# base would ignore LD_PRELOAD without reporting anything, so this stays
# dynamically linked and the runtime below stays glibc-based.
RUN CGO_ENABLED=1 GOOS=linux GOARCH=$TARGETARCH go build -o /demo-service

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 demo

COPY --from=build /demo-service /usr/local/bin/demo-service

USER demo
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/demo-service"]
