# The build stage runs on the target platform rather than the builder's, because
# the binary below needs cgo and cross-compiling it would need an aarch64
# toolchain in the image. On an amd64 CI runner this means the stage runs under
# emulation, which for a dependency-free Go program is cheap.
FROM golang:1.23-bookworm AS build

WORKDIR /app
COPY go.mod ./
COPY *.go ./

# The deployed task preloads mirrord's remote bootstrap library, which needs a
# dynamic loader and glibc. A statically linked binary on a distroless-static
# base would ignore LD_PRELOAD without reporting anything, so this stays
# dynamically linked and the runtime below stays glibc-based.
RUN CGO_ENABLED=1 go build -o /demo-service

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 demo

COPY --from=build /demo-service /usr/local/bin/demo-service

USER demo
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/demo-service"]
