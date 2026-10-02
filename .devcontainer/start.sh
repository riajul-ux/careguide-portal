#!/usr/bin/env bash
# Starts the production server in the background and tries to make port 3000 public.
cd "$(dirname "$0")/.."
[ -d .next ] || npm run build
node scripts/ensure-db.mjs
setsid nohup npx next start -p 3000 > /tmp/careguide.log 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3000/api/sample-csv && break; sleep 1; done
if [ -n "$CODESPACE_NAME" ]; then
  gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 \
    && echo "Port 3000 is public: https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}" \
    || echo "Set port 3000 to Public in the PORTS tab to share the link."
fi
