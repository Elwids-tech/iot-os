#!/bin/sh
set -eu
# Renders the portal's nginx config (spec 036). With PORTAL_ADDRESSES on, every host
# except the platform's own portal host is a billing account's address, a name under
# PORTAL_ADDRESSES_DOMAIN or a custom domain: its runtime-config.js and API calls go to
# API_UPSTREAM, which decides whether the host is in use. With it off, or with no domain
# or upstream, nothing is an address and nginx serves as it always did.
template=/etc/nginx/portal.conf.template
target=/etc/nginx/conf.d/default.conf

default=0
hosts=""
domain=$(printf '%s' "${PORTAL_ADDRESSES_DOMAIN:-}" | tr 'A-Z' 'a-z' | sed 's/^\.*//;s/\.*$//')
case "$(printf '%s' "${PORTAL_ADDRESSES:-off}" | tr 'A-Z' 'a-z')" in
  on|true|1)
    # Only letters, digits, dots and hyphens reach the config.
    if [ -n "${API_UPSTREAM:-}" ] && printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'; then
      default=1
      # The platform's own hosts: this machine, for health checks and development, and
      # the portal's public host.
      hosts='    "localhost" 0;\n    "127.0.0.1" 0;'
      platform=$(printf '%s' "${PUBLIC_PORTAL_URL:-}" | sed -E 's#^[a-z]+://##;s#[:/].*$##' | tr 'A-Z' 'a-z')
      if printf '%s' "$platform" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' && [ "$platform" != localhost ] && [ "$platform" != 127.0.0.1 ]; then
        hosts="${hosts}\\n    \"${platform}\" 0;"
      fi
    fi
    ;;
esac

# The API on the private network, as host:port.
upstream=${API_UPSTREAM:-127.0.0.1:9}
printf '%s' "$upstream" | grep -Eq '^[a-z0-9.-]+(:[0-9]+)?$' || { echo "API_UPSTREAM must be host[:port]" >&2; exit 1; }

sed -e "s|@ADDRESS_DEFAULT@|${default}|" \
    -e "s|@ADDRESS_HOSTS@|${hosts}|" \
    -e "s|@API_UPSTREAM@|http://${upstream}|" \
    -e "s|@UPLOAD_LIMIT@|20m|" \
    "$template" > "$target"
