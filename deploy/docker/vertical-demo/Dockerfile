FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/vertical-demo/package.json apps/vertical-demo/package.json
COPY packages/integration-sdk/package.json packages/integration-sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY apps/vertical-demo apps/vertical-demo
COPY packages/integration-sdk packages/integration-sdk
COPY packages/ui packages/ui
RUN pnpm --filter @iot-os/integration-sdk build && pnpm --filter @iot-os/vertical-demo build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /workspace/apps/vertical-demo/dist ./
RUN printf '{"type":"module"}\n' > package.json
ENV IOT_BIND_ADDRESS=0.0.0.0 PORT=5180
USER node
EXPOSE 5180
CMD ["node", "server.js"]
