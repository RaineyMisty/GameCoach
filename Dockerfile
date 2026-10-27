FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY back-end/requirements.txt /app/back-end/requirements.txt
RUN pip install --no-cache-dir -r back-end/requirements.txt \
    && useradd --uid 10001 --create-home gamecoach \
    && mkdir -p /app/back-end/data && chown gamecoach:gamecoach /app/back-end/data
COPY back-end/main.py back-end/providers.py back-end/secure_config.py back-end/training_memory.py /app/back-end/
COPY frontend/ /app/frontend/
COPY ai-core/ /app/ai-core/
COPY skill/ /app/skill/
COPY memory/ /app/memory/
COPY resources/ /app/resources/
USER 10001:10001
EXPOSE 8000
# Only Caddy can reach this service in compose; it supplies the HTTPS forwarding header.
CMD ["uvicorn", "main:app", "--app-dir", "back-end", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
