FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --disable-pip-version-check -r requirements.txt

COPY main.py .

EXPOSE 80
ENV PORT=80

CMD ["python", "main.py"]
