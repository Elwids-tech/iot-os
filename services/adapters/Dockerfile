FROM node:22-alpine AS manager
RUN apk add --no-cache docker-cli openssl
WORKDIR /app
COPY services/adapters/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/adapters/ ./
EXPOSE 8090
CMD ["node", "manager.cjs"]

FROM nodered/node-red:4.1.13-22 AS tenant-runtime
USER root
WORKDIR /opt/iot-adapter
COPY services/adapters/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/adapters/ ./
USER node-red
WORKDIR /usr/src/node-red
# The base entrypoint already runs `red.js --userDir /data "$@"`, so pass only red.js
# options. Wrapping them in `npm start --` made red.js ignore --settings, and the
# platform adapter nodes never loaded.
CMD ["--settings", "/opt/iot-adapter/runtime-settings.cjs"]
# The base image's healthcheck reads /data/settings.js, which this image never
# uses, so every tenant runtime reported unhealthy. Any HTTP answer from the
# token-protected admin API (401 without a token) means Node-RED is serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:1880/flows',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]
