FROM python:3.11-slim

WORKDIR /app

# System deps (for psycopg2 if you enable Postgres)
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/pyproject.toml
RUN pip install --no-cache-dir -e .[postgres]

COPY app /app/app
RUN mkdir -p /app/data

EXPOSE 8080
