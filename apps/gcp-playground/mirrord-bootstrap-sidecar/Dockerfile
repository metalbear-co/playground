# syntax=docker/dockerfile:1.5
#
# The sidecar that hands the mirrord remote bootstrap library to the demo
# container on Cloud Run.
#
# BOOTSTRAP_IMAGE is the published mirrord remote-bootstrap image, which carries
# the library and nothing else. Deriving from it keeps the demo service image
# free of any mirrord build dependency, so the two release independently; the
# only coupling is the tag pinned at build time.
#
# Cloud Run runs linux/amd64 only, so BOOTSTRAP_IMAGE must resolve to an amd64
# image — the ECS demo's ARM64 build of the same library will not load here.
ARG BOOTSTRAP_IMAGE
FROM ${BOOTSTRAP_IMAGE} AS bootstrap

FROM debian:bookworm-slim

# socat gives the entrypoint a TCP listener with unambiguous flags. The base
# image has no listener of its own, and Cloud Run's only way to observe that
# this container finished its work is to connect to a port.
RUN apt-get update \
    && apt-get install -y --no-install-recommends socat \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bootstrap /opt/mirrord/lib/libmirrord_remote_bootstrap.so /opt/mirrord/lib/libmirrord_remote_bootstrap.so
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 9000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
