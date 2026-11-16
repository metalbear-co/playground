SHELL := /bin/bash

.DEFAULT_GOAL := help

VENV := .venv
PY := $(VENV)/bin/python
COMPOSE := docker compose -f local/compose.yaml
INTRO_PORT := 8765

.PHONY: help test local-secret local-up local-verify local-logs local-down intro

help:
	@echo "Local-only targets. Nothing here deploys to AWS or touches s8s-demo."
	@echo "  test          Unit tests"
	@echo "  local-up      Build the image and start alb, ask-otto, and rds"
	@echo "  local-verify  ALB, shipped bug, private RDS, laptop locked out"
	@echo "  local-logs    Follow the task stand-in's logs"
	@echo "  local-down    Stop the local stack and delete its database"
	@echo "  intro         Serve the How it works diagram on http://127.0.0.1:$(INTRO_PORT)"

$(VENV)/.installed: requirements-dev.txt requirements.txt
	python3.12 -m venv $(VENV)
	$(PY) -m pip install --quiet --upgrade pip
	$(PY) -m pip install --quiet -r requirements-dev.txt
	@touch $@

test: $(VENV)/.installed
	$(PY) -m pytest -q app/tests

local/.env:
	@umask 077 && echo "OTTO_DB_PASSWORD=$$(openssl rand -hex 24)" > $@
	@echo "Generated a random local DB password in local/.env (git-ignored)."

local-secret: local/.env

local-up: local/.env
	$(COMPOSE) up --build --detach --wait

local-verify:
	@./scripts/local-verify.sh

local-logs:
	$(COMPOSE) logs --follow ask-otto

local-down:
	$(COMPOSE) down --volumes --remove-orphans

intro:
	python3 -m http.server $(INTRO_PORT) --bind 127.0.0.1 --directory docs/intro
