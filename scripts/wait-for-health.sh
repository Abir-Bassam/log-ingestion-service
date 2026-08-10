#!/usr/bin/env bash
# بنستنّى الخدمة تصير جاهزة قبل ما نبلّش الفحص.
set -euo pipefail

for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/health > /dev/null; then
    echo "service is healthy"
    exit 0
  fi
  sleep 2
done

echo "service did not become healthy in time" >&2
exit 1