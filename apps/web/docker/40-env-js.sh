#!/bin/sh
set -eu

API_URL="${API_URL:-/api}"

cat > /usr/share/nginx/html/env.js <<EOF
window.__env = { apiUrl: "${API_URL}" };
EOF

# The page may only talk to its own origin -- plus the API's, when API_URL points at another
# host (e.g. https://api.example.com rather than the default same-origin /api).
CONNECT_SRC="'self'"
case "$API_URL" in
  http://*|https://*)
    API_ORIGIN=$(printf '%s' "$API_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
    CONNECT_SRC="'self' ${API_ORIGIN}"
    ;;
esac

# Response headers for the web app, included by every location in nginx.conf (nginx drops
# server-level add_header lines in any location that sets its own, so they can't live there).
# Generated here, not static, only because connect-src depends on API_URL.
#
# CSP: scripts only from this origin (the build has no inline scripts: angular.json turns off
# critical-CSS inlining, whose onload= handler would need 'unsafe-inline'); styles allow inline
# because Angular injects component styles as <style> tags; fonts from Google Fonts.
cat > /etc/nginx/security-headers.conf <<EOF
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src ${CONNECT_SRC}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
EOF
