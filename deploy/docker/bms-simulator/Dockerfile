# The simulated building of spec 038 (tooling/simulators/bms_server.py).
# Development only; started by deploy/compose/compose.bms-simulator.yml.
FROM python:3.12-slim
WORKDIR /simulator
COPY tooling/simulators/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY tooling/simulators/bms ./bms
COPY tooling/simulators/bms_server.py tooling/simulators/bms_controls.html ./
ENV PYTHONUNBUFFERED=1
EXPOSE 4840 4841
ENTRYPOINT ["python", "bms_server.py"]
