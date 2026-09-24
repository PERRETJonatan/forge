#!/bin/sh
set -eu
cat > /usr/share/nginx/html/env.js <<EOF
window.__env = { apiUrl: "${API_URL:-/api}" };
EOF
