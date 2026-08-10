#!/usr/bin/env bash
# اختبار العقد. بدون معامل: بيتوقّع الخدمة المفتوحة.
# مع مفتاح: بيتوقّع المصادقة مفروضة (401 بدونه، نجاح معه).
set -euo pipefail

BASE="http://localhost:8080"
KEY="${1:-}"

hdr=()
if [[ -n "$KEY" ]]; then
  hdr=(-H "Authorization: Bearer $KEY")
fi

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

# /health دايماً مفتوح.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")
[[ "$code" == "200" ]] || fail "/health returned $code"

if [[ -n "$KEY" ]]; then
  # بدون بيانات اعتماد لازم يرجّع 401 (مش 500، ومش 200).
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/logs")
  [[ "$code" == "401" ]] || fail "GET /logs without creds returned $code, expected 401"
fi

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# دفعة مختلطة: ٢ صالح و١ فاسد. لازم accepted=2 والفاسد مبلَّغ بفهرسه.
resp=$(curl -s "${hdr[@]}" -X POST "$BASE/logs" \
  -H 'content-type: application/json' \
  -d "{\"logs\":[
        {\"timestamp\":\"$now\",\"level\":\"info\",\"service\":\"smoke\",\"message\":\"hello\",\"attributes\":{\"run\":\"ci\"}},
        {\"timestamp\":\"$now\",\"level\":\"error\",\"service\":\"smoke\",\"message\":\"boom\"},
        {\"timestamp\":\"$now\",\"level\":\"critical\",\"service\":\"smoke\",\"message\":\"bad\"}
      ]}")
echo "$resp" | grep -q '"accepted":2' || fail "ingest response unexpected: $resp"
echo "$resp" | grep -q '"index":2'    || fail "invalid entry not reported: $resp"

# استرجاع بفلاتر مدمجة.
resp=$(curl -s "${hdr[@]}" "$BASE/logs?service=smoke&limit=10")
echo "$resp" | grep -q '"message":"hello"' || fail "query missing ingested log: $resp"
echo "$resp" | grep -q '"next_cursor"'     || fail "query missing next_cursor: $resp"

# تجميع على آخر ساعة.
since=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
until=$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)
resp=$(curl -s "${hdr[@]}" "$BASE/logs/aggregate?since=$since&until=$until&bucket=1m&group_by=service")
echo "$resp" | grep -q '"buckets"' || fail "aggregate response unexpected: $resp"

# المعاملات الغلط لازم ترجّع 400 بالشكل الموثّق.
code=$(curl -s -o /dev/null -w '%{http_code}' "${hdr[@]}" "$BASE/logs?limit=nope")
[[ "$code" == "400" ]] || fail "invalid limit returned $code, expected 400"
code=$(curl -s -o /dev/null -w '%{http_code}' "${hdr[@]}" "$BASE/logs?cursor=garbage")
[[ "$code" == "400" ]] || fail "invalid cursor returned $code, expected 400"

echo "SMOKE OK"