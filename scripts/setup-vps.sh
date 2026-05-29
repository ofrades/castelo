#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${DEPLOY_HOST:-root@mohshoo.tailf9eafe.ts.net}"

echo "Creating persistent data directory on ${REMOTE_HOST}..."
ssh "${REMOTE_HOST}" 'mkdir -p /var/lib/castelo/data && chown -R 1001:1001 /var/lib/castelo/data'

echo "Host prep complete"
echo "Next steps:"
echo "  1. Make sure .kamal/secrets exists locally"
echo "  2. Add castelo.mohshoo.com DNS/tunnel route to the VPS/kamal-proxy"
echo "  3. Run: kamal setup"
echo "  4. Deploy with: kamal deploy"
