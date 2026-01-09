FROM ghcr.io/astral-sh/uv:python3.13-bookworm

ADD . /app
WORKDIR /app

RUN uv sync --locked

CMD ["uv", "run", "/app/main.py"]