FROM python:3.12-slim

# rasterio's manylinux wheel dlopens libexpat, absent from -slim
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
# Retries and a longer timeout ride out transient PyPI fetch failures.
RUN pip install --no-cache-dir --retries 10 --timeout 120 -r requirements.txt

COPY app/ ./app

ENV PORT=8000
EXPOSE 8000

# Single worker: the field cache and icechunk session are per-process.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
