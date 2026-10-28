FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 ENDED_DB=/data/ended.db
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
COPY static static
COPY sources.yaml .
RUN useradd -m ended && mkdir /data && chown ended /data
USER ended
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request as u;u.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
