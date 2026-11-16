FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS build

RUN python -m venv /opt/venv
COPY requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# The mirrord bootstrap preloaded into this container is Rust and reads the
# system trust store. Without ca-certificates, TLS to sessions-manager fails
# and the companion never checks in. Bookworm (glibc) is required so LD_PRELOAD
# is not silently ignored the way it is on musl/Alpine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin otto

COPY --from=build /opt/venv /opt/venv
WORKDIR /srv
COPY --chown=root:root app /srv/app

USER 10001
EXPOSE 8080

# Exec form, so LD_PRELOAD loads the mirrord bootstrap into uvicorn itself and not a wrapping shell.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
