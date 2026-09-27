FROM python:3.13-slim
WORKDIR /simulator
COPY tooling/simulators/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY tooling/simulators ./
ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "sparkplug_simulator.py"]
