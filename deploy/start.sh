#!/bin/sh
set -eu
node /app/server/votes-server.mjs &
vote_pid=$!
trap 'kill "$vote_pid" 2>/dev/null || true' EXIT INT TERM
nginx -g 'daemon off;'
