# syntax=docker/dockerfile:1
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 API_HOST=0.0.0.0 API_PORT=8000
# xgboost and scikit-learn need the OpenMP runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 ml
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY app ./app
COPY main.py ./
USER ml
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,sys,urllib.request as u; sys.exit(0 if u.urlopen('http://127.0.0.1:'+os.environ.get('API_PORT','8000')+'/health', timeout=4).status==200 else 1)"
CMD ["python", "main.py"]
