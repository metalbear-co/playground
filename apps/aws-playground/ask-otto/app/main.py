import logging
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ask-otto")

SEED_SQL = Path(__file__).with_name("seed.sql")
STATIC = Path(__file__).with_name("static")

INTENT_KEYWORDS = {
    "return": ["return", "refund", "send back", "send it back"],
    "warranty": ["warranty", "broken", "defect", "repair"],
    "weather": ["storm", "waterproof", "weather", "rain rating"],
}

PRODUCT_KEYWORDS = {
    "sleeping bag": ["sleeping bag"],
    "tent": ["tent"],
    "hiking boots": ["hiking boot", "boots", "boot"],
    "rain jacket": ["rain jacket", "jacket"],
}

# Shipped demo bug: "return" maps to the warranty topic, so a sleeping-bag
# return question pulls the hiking-boots warranty guide. The one-line fix is
# "return": "returns".
INTENT_TOPICS = {
    "return": "warranty",
    "warranty": "warranty",
    "weather": "specs",
}


def served_by() -> str:
    return os.environ.get("APP_INSTANCE", "unknown")


def conninfo() -> str:
    return psycopg.conninfo.make_conninfo(
        host=os.environ.get("DB_HOST", "localhost"),
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ.get("DB_NAME", "otto"),
        user=os.environ.get("DB_USER", "otto"),
        password=os.environ.get("DB_PASSWORD", ""),
        connect_timeout=5,
        application_name="ask-otto",
    )


def _matches(text: str, keyword: str) -> bool:
    return re.search(rf"\b{re.escape(keyword)}", text) is not None


def detect_intent(question: str) -> str | None:
    text = question.lower()
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(_matches(text, k) for k in keywords):
            return intent
    return None


def detect_product(question: str) -> str | None:
    text = question.lower()
    for product, keywords in PRODUCT_KEYWORDS.items():
        if any(_matches(text, k) for k in keywords):
            return product
    return None


def otto_reply(body: str, topic: str | None = None) -> str:
    """Wrap a product guide as Otto's cheerful AI reply. No model call."""
    text = body.rstrip(".")
    if topic == "warranty":
        return f"Of course — you're covered. {text}."
    if topic == "returns":
        return (
            f"Yes, we can take that back. {text}. "
            "Zip up your return and drop it at any parcel shop — happy trails!"
        )
    if topic == "specs":
        return (
            f"Great question. {text}. "
            "Want me to compare that with another piece of gear?"
        )
    return f"{text}."


def seed_database(attempts: int = 10, delay_s: float = 3.0) -> None:
    for attempt in range(1, attempts + 1):
        try:
            with psycopg.connect(conninfo()) as conn:
                conn.execute(SEED_SQL.read_text())
            log.info("seed complete")
            return
        except psycopg.OperationalError as exc:
            log.warning("seed attempt %d/%d failed: %s", attempt, attempts, exc)
            time.sleep(delay_s)
    log.error("seed gave up after %d attempts; serving without seed", attempts)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("SEED_ON_START", "false").lower() == "true":
        seed_database()
    yield


app = FastAPI(title="Ask Otto Lite", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_methods=["GET"],
    allow_headers=["*"],
)

_last_ask: dict = {"question": None, "at": None}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = int((time.perf_counter() - start) * 1000)
    log.info(
        "method=%s path=%s status=%d served_by=%s duration_ms=%d",
        request.method,
        request.url.path,
        response.status_code,
        served_by(),
        duration_ms,
    )
    return response


@app.exception_handler(psycopg.OperationalError)
async def database_unreachable(_: Request, exc: psycopg.OperationalError):
    return JSONResponse(
        status_code=503,
        content={"served_by": served_by(), "error": "database unreachable", "detail": str(exc).strip()},
    )


@app.get("/")
def home():
    return FileResponse(STATIC / "index.html")


@app.get("/healthz")
def healthz():
    return {"status": "ok", "served_by": served_by()}


@app.get("/debug/last-ask")
def last_ask():
    return {
        "served_by": served_by(),
        "question": _last_ask["question"],
        "at": _last_ask["at"],
    }


@app.get("/debug/db")
def debug_db():
    with psycopg.connect(conninfo()) as conn:
        server_addr, client_addr, version = conn.execute(
            "SELECT host(inet_server_addr()), host(inet_client_addr()), version()"
        ).fetchone()
    return {
        "served_by": served_by(),
        "db_server_addr": server_addr,
        "db_client_addr": client_addr,
        "db_version": version,
    }


class Question(BaseModel):
    question: str


def _log_stolen_ask(question: str, payload: dict) -> None:
    guide = payload.get("guide_product") or "none"
    topic = payload.get("topic") or "none"
    db_line = payload.get("db_line") or "db: not used"
    log.info(
        "\n----- stolen on %s -----\nQ: %s\n%s\nguide: %s / %s (id=%s)\nA: %s\n-------------------------",
        payload.get("served_by"),
        question,
        db_line,
        guide,
        topic,
        payload.get("guide_id"),
        payload.get("answer"),
    )


@app.post("/ask")
def ask(body: Question):
    _last_ask["question"] = body.question
    _last_ask["at"] = time.time()
    intent = detect_intent(body.question)
    product = detect_product(body.question)
    topic = INTENT_TOPICS.get(intent) if intent else None
    if topic is None:
        payload = {
            "served_by": served_by(),
            "intent": intent,
            "topic": None,
            "product": product,
            "answer": otto_reply(
                "I can help with returns, warranties, and whether the gear will survive the weather"
            ),
            "guide_id": None,
        }
        _log_stolen_ask(body.question, payload)
        return payload

    with psycopg.connect(conninfo()) as conn:
        row = conn.execute(
            "SELECT id, product, title, body FROM guides"
            " WHERE topic = %(topic)s"
            " ORDER BY (product = %(product)s) DESC, id"
            " LIMIT 1",
            {"topic": topic, "product": product},
        ).fetchone()
        db_server, db_client = conn.execute(
            "SELECT host(inet_server_addr()), host(inet_client_addr())"
        ).fetchone()

    if row is None:
        answer, guide_id, guide_product = otto_reply("I couldn't find a guide for that"), None, None
    else:
        guide_id, guide_product, _title, text = row
        answer = otto_reply(text, topic)

    payload = {
        "served_by": served_by(),
        "intent": intent,
        "topic": topic,
        "product": product,
        "guide_product": guide_product,
        "answer": answer,
        "guide_id": guide_id,
        "db_line": (
            f"db: {os.environ.get('DB_HOST', 'localhost')}  "
            f"server={db_server}  client={db_client}  "
            "(client is the Fargate task, not this laptop)"
        ),
    }
    _log_stolen_ask(body.question, payload)
    return payload
