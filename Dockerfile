# ClimaSP — backend Python (FastAPI: clima, previsão, ML) + painel estático em /.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY models ./models
COPY data ./data
COPY index.html styles.css config.js manifest.webmanifest sw.js ./
COPY icons ./icons
COPY js ./js
RUN useradd --system --uid 10001 climasp && mkdir -p /app/var && chown -R climasp /app/var /app/models
USER climasp
ENV DATABASE_URL=sqlite+aiosqlite:////app/var/climasp.db
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
