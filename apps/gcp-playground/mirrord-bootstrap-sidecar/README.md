# mirrord-bootstrap-sidecar

Publishes `libmirrord_remote_bootstrap.so` onto an in-memory volume that the
Cloud Run demo service preloads it from, then holds the container open.

## Why this exists

On ECS the same job is an init container that runs `cp` and exits, and the
application container waits on `dependsOn: {condition: SUCCESS}` — a guarantee
that the copy finished. Cloud Run has neither half of that:

- **No run-to-completion container.** Every container in a service is expected to
  stay up, so the copy cannot simply exit when it is done.
- **No exec probe.** Startup probes are HTTP, TCP or gRPC only, so nothing can
  test for the file directly.

The only ordering condition Cloud Run offers is "the container this one
`depends_on` passed its startup probe". So the entrypoint copies the library,
then listens on `READY_PORT` (9000 by default); a TCP startup probe on that port
is what releases the demo container to start. Nothing is served on the
connection — establishing it is the whole signal.

Skipping the probe does not fail loudly. Cloud Run would start both containers at
once, the dynamic loader would find no library at the `LD_PRELOAD` path, print
`cannot be preloaded … ignored` to stderr and carry on. The service comes up
healthy, serves traffic, and mirrord never attaches.

## Build

`BOOTSTRAP_IMAGE` is the published mirrord remote-bootstrap image, which carries
the library and nothing else. Deriving from it keeps the demo service image free
of any mirrord build dependency, so the two release independently; the only
coupling is the tag pinned at build time.

```bash
docker build --platform linux/amd64 \
  --build-arg BOOTSTRAP_IMAGE=<region>-docker.pkg.dev/<project>/s8s-mirrord-remote-bootstrap/<tag> \
  -t bootstrap-sidecar .
```

Cloud Run runs `linux/amd64` only, so `BOOTSTRAP_IMAGE` must resolve to an amd64
image. The ECS demo's ARM64 build of the same library will not load here.

The mirrord repository publishes no image of its own, so that base is pushed by
hand — see the comment in `infra/environments/s8s-gcp/artifact-registry.tf` for
the exact build.

## Behaviour worth knowing

The library is copied under a temporary name and renamed into place. Rename is
atomic within the volume, so the demo container can never observe a half-written
library at the path it preloads from.
