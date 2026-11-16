import pytest
from fastapi.testclient import TestClient

from app.main import app, detect_intent, detect_product, otto_reply


@pytest.mark.parametrize(
    ("question", "intent"),
    [
        ("How do I return a sleeping bag?", "return"),
        ("Can I get a refund for my tent?", "return"),
        ("My boots are broken after a month", "warranty"),
        ("Is the warranty on rain jackets transferable?", "warranty"),
        ("Will this tent survive a storm in Iceland?", "weather"),
        ("How waterproof is the rain jacket?", "weather"),
        ("What colors does the tent come in?", None),
    ],
)
def test_detect_intent(question, intent):
    assert detect_intent(question) == intent


@pytest.mark.parametrize(
    ("question", "product"),
    [
        ("How do I return a sleeping bag?", "sleeping bag"),
        ("Will this tent survive a storm?", "tent"),
        ("My hiking boots leak", "hiking boots"),
        ("Are boots covered?", "hiking boots"),
        ("How waterproof is the rain jacket?", "rain jacket"),
        ("Do you sell kayaks?", None),
    ],
)
def test_detect_product(question, product):
    assert detect_product(question) == product


def test_otto_reply_sounds_like_the_article():
    boots = otto_reply(
        "Our hiking boots carry a two-year warranty against sole separation",
        "warranty",
    )
    assert "you're covered" in boots
    assert "hiking boots" in boots
    assert boots.count("order number") <= 1
    returns = otto_reply("Unused sleeping bags can be returned within 60 days", "returns")
    assert "Zip up your return" in returns


def test_home_serves_the_product_page():
    with TestClient(app) as client:
        response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Ask Otto" in response.text


def test_healthz_does_not_touch_the_database(monkeypatch):
    monkeypatch.setenv("APP_INSTANCE", "test")
    monkeypatch.setenv("DB_HOST", "203.0.113.1")
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "served_by": "test"}


def test_last_ask_records_the_question_on_the_laptop(monkeypatch):
    monkeypatch.setenv("APP_INSTANCE", "laptop")
    monkeypatch.setenv("DB_HOST", "203.0.113.1")
    from app import main as otto

    otto._last_ask.update({"question": None, "at": None})
    with TestClient(app) as client:
        empty = client.get("/debug/last-ask")
        assert empty.json() == {"served_by": "laptop", "question": None, "at": None}
        question = "How do I return a sleeping bag?"
        asked = client.post("/ask", json={"question": question})
        assert asked.status_code == 503
        live = client.get("/debug/last-ask")
    body = live.json()
    assert body["served_by"] == "laptop"
    assert body["question"] == question
    assert body["at"] is not None


def test_unknown_intent_answers_without_the_database(monkeypatch):
    monkeypatch.setenv("DB_HOST", "203.0.113.1")
    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What colors does the tent come in?"})
    assert response.status_code == 200
    assert response.json()["guide_id"] is None
