#!/bin/sh
set -eu
# jq encodes values as data, never executable shell/JavaScript interpolation.
jq -n --arg api "${PUBLIC_API_URL:-}" --arg portal "${PUBLIC_PORTAL_URL:-}" \
  --arg admin "${PUBLIC_ADMIN_URL:-}" --arg map "${PUBLIC_MAP_STYLE_URL:-}" \
  --arg environment "${DEPLOY_ENVIRONMENT:-local}" \
  '{VITE_API_URL:$api,VITE_PORTAL_URL:$portal,VITE_ADMIN_URL:$admin,VITE_MAP_STYLE_URL:$map,environment:$environment}' \
  | sed '1s/^/window.__IOT_CONFIG__ = /;$s/$/;/' > /usr/share/nginx/html/runtime-config.js
