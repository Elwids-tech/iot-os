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
CMD ["npm", "start", "--", "--userDir", "/data", "--settings", "/opt/iot-adapter/runtime-settings.cjs"]
