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

COPY apps/admin apps/admin
COPY packages/api-client packages/api-client
COPY packages/ui packages/ui
COPY packages/auth packages/auth
# Device Profile fixture contracts are imported by the contract-driven editor.
COPY contracts contracts

ARG VITE_API_URL=http://localhost:8001
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_PORTAL_URL
ENV VITE_PORTAL_URL=${VITE_PORTAL_URL}
RUN pnpm --filter @iot-os/admin build

FROM nginx:1.29-alpine

COPY deploy/docker/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin/dist /usr/share/nginx/html

EXPOSE 80
