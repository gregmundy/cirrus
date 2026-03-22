FROM python:3.12-slim

RUN apt-get update && apt-get install -y libeccodes-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir .
