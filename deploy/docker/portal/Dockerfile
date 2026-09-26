FROM node:22-alpine AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/portal/package.json apps/portal/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

COPY apps/portal apps/portal
COPY packages/api-client packages/api-client
COPY packages/ui packages/ui
COPY packages/auth packages/auth
# Device Profile fixture contracts are imported by the contract-driven editor.
COPY contracts contracts

ARG VITE_API_URL=http://localhost:8001
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_ADMIN_URL=http://localhost:5174
ENV VITE_ADMIN_URL=${VITE_ADMIN_URL}
ARG VITE_MAP_STYLE_URL
ENV VITE_MAP_STYLE_URL=${VITE_MAP_STYLE_URL}
RUN pnpm --filter @iot-os/portal build

FROM nginx:1.29-alpine

COPY deploy/docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/portal/dist /usr/share/nginx/html

EXPOSE 80
