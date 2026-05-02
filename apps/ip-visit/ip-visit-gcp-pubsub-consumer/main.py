"""
Pull subscriber for GCP Pub/Sub — mirrors ip-visit-sqs-consumer for mirrord queue splitting demos.

Reads subscription ID from PUBSUB_SUBSCRIPTION_ID and project from GOOGLE_CLOUD_PROJECT
(or GCP_PROJECT). Uses Application Default Credentials (Workload Identity on GKE, or
gcloud locally).

Optional: PUBSUB_EMULATOR_HOST=http://host:port for local emulator testing.
"""

from __future__ import annotations

import logging
import os
import sys
import threading

from flask import Flask
from google.cloud import pubsub_v1

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)


def _project_id() -> str:
    return (
        os.environ.get("GOOGLE_CLOUD_PROJECT")
        or os.environ.get("GCP_PROJECT")
        or ""
    ).strip()


def _subscription_id() -> str:
    return os.environ.get("PUBSUB_SUBSCRIPTION_ID", "").strip()


@app.route("/health")
def health():
    return "", 200


def _run_subscriber() -> None:
    project = _project_id()
    sub_id = _subscription_id()
    if not project or not sub_id:
        logger.error(
            "Missing GOOGLE_CLOUD_PROJECT (or GCP_PROJECT) and/or PUBSUB_SUBSCRIPTION_ID"
        )
        sys.exit(1)

    subscriber = pubsub_v1.SubscriberClient()
    path = subscriber.subscription_path(project, sub_id)
    emulator = os.environ.get("PUBSUB_EMULATOR_HOST")
    if emulator:
        logger.info("Using Pub/Sub emulator at %s", emulator)

    def callback(message) -> None:
        try:
            body = message.data.decode("utf-8", errors="replace")
        except Exception:
            body = "<binary>"
        attrs = dict(message.attributes)
        logger.info(
            "Pub/Sub message message_id=%s publish_time=%s attributes=%s body=%s",
            message.message_id,
            getattr(message, "publish_time", None),
            attrs,
            body,
        )
        message.ack()

    logger.info("Subscribing to %s", path)
    streaming_pull_future = subscriber.subscribe(path, callback=callback)
    try:
        streaming_pull_future.result()
    except KeyboardInterrupt:
        streaming_pull_future.cancel()
        raise


def main() -> None:
    port = int(os.environ.get("PORT", "8080"), 10)
    t = threading.Thread(target=_run_subscriber, name="pubsub-subscriber", daemon=True)
    t.start()
    logger.info("HTTP server listening on 0.0.0.0:%s", port)
    app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
