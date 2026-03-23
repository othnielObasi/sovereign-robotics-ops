FROM python:3.11-slim

WORKDIR /app

# System deps (for psycopg2 if you enable Postgres)
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/pyproject.toml
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic
COPY app /app/app
RUN pip install --no-cache-dir .[postgres]
RUN mkdir -p /app/data

EXPOSE 8080

CMD ["sh", "-c", "python -m app.preflight && uvicorn app.main:app --host 0.0.0.0 --port 8080"]
