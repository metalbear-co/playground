#!/bin/sh
# Publishes the mirrord remote bootstrap library onto a volume the demo
# container preloads from, then holds the container open.
#
# Cloud Run has no run-to-completion container: every container in a service is
# expected to stay up, and the only ordering condition available to the demo
# container's `depends_on` is "this container's startup probe passed". Probes
# are HTTP, TCP or gRPC — there is no exec probe that could test for the file —
# so accepting a TCP connection is how this script reports that the copy is
# done. Exiting after the copy would instead take the whole instance down.
set -eu

BOOTSTRAP_SOURCE="${BOOTSTRAP_SOURCE:-/opt/mirrord/lib/libmirrord_remote_bootstrap.so}"
BOOTSTRAP_TARGET_DIR="${BOOTSTRAP_TARGET_DIR:-/bootstrap}"
READY_PORT="${READY_PORT:-9000}"

target="${BOOTSTRAP_TARGET_DIR}/libmirrord_remote_bootstrap.so"
staged="${BOOTSTRAP_TARGET_DIR}/.libmirrord_remote_bootstrap.so.$$"

# Copy under a temporary name and rename into place. Rename is atomic within
# the volume, so the demo container can never observe a half-written library at
# the path it preloads from.
cp "$BOOTSTRAP_SOURCE" "$staged"
chmod 0444 "$staged"
mv "$staged" "$target"

echo "published $target from $BOOTSTRAP_SOURCE"

# Nothing is served on this port. The probe only checks that a connection can
# be established, and `fork` keeps the listener up across repeated probes.
exec socat "TCP-LISTEN:${READY_PORT},bind=0.0.0.0,fork,reuseaddr" /dev/null
