#!/bin/bash
# Quick smoke test for MUST dashboard APIs
# Usage: ./scripts/test_api.sh
# Requires: FastAPI on :8000, Next.js on :3000

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
PASS=0; FAIL=0

check() {
  if [ $1 -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} $2"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} $2"
    ((FAIL++))
  fi
}

Q="window=24h&rp=10yr&hazard=flood"

echo "=== FastAPI (port 8000) ==="

curl -sf http://localhost:8000/ > /dev/null 2>&1
check $? "Health check"

curl -sf "http://localhost:8000/api/exceedance-calendar?$Q" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; assert len(d)>0; print(f'    {len(d)} forecast days')" 2>/dev/null
check $? "Exceedance calendar data"

FIRST=$(curl -sf "http://localhost:8000/api/exceedance-calendar?$Q" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['date'])" 2>/dev/null)
curl -sf "http://localhost:8000/api/exceedance-regions/${FIRST}?$Q" | python3 -c "import sys,json; r=json.load(sys.stdin)['regions']; assert len(r)>0; print(f'    {len(r)} admin-1 regions')" 2>/dev/null
check $? "Region exceedance ($FIRST)"

curl -sf "http://localhost:8000/icpac_adm1v3.json" | python3 -c "import sys,json; t=json.load(sys.stdin); print(f'    {len(t[\"objects\"][\"icpac_adm1v3\"][\"geometries\"])} geometries')" 2>/dev/null
check $? "TopoJSON Admin1 boundaries"

echo ""
echo "=== Next.js (port 3000) ==="

curl -sf -o /dev/null "http://localhost:3000/?view=index&hazard=flood"
check $? "Index page loads"

curl -sf -o /dev/null "http://localhost:3000/?view=story&date=2023-11-22"
check $? "Story page loads"

curl -sf "http://localhost:3000/api/exceedance-calendar?$Q" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; assert len(d)>0; print(f'    {len(d)} days via Next proxy')" 2>/dev/null
check $? "Exceedance calendar via Next route"

# TiTiler live tiles - runs only when the live-tile env is configured.
# Reads NEXT_PUBLIC_TITILER_BASE / NEXT_PUBLIC_COG_BASE from .env.local if present.
ENV_FILE="$(dirname "$0")/../.env.local"
[ -f "$ENV_FILE" ] && eval "$(grep -E '^NEXT_PUBLIC_(TITILER_BASE|COG_BASE)=' "$ENV_FILE")"
TITILER="${NEXT_PUBLIC_TITILER_BASE}"; COGS="${NEXT_PUBLIC_COG_BASE}"
TILE_DATE="${TILE_DATE:-2026-03-04}"

if [ -n "$TITILER" ] && [ -n "$COGS" ]; then
  echo ""
  echo "=== TiTiler ($TITILER) ==="

  curl -sf "$TITILER/cog/info?url=$COGS/gpm_${TILE_DATE}.tif" > /dev/null
  check $? "GPM COG readable (/cog/info)"

  TILE="cog/tiles/WebMercatorQuad/5/18/15@1x.png"
  curl -sf -o /dev/null "$TITILER/$TILE?url=$COGS/gpm_${TILE_DATE}.tif&colormap_name=blues&rescale=0,100"
  check $? "GPM tile renders"

  curl -sf -o /dev/null "$TITILER/$TILE?url=$COGS/exceedance_${TILE_DATE}_24_10.tif&colormap_name=ylorrd&rescale=0,1"
  check $? "Exceedance tile renders"

  RISK_CMAP='%7B%220%22%3A%22%2310B981%22%2C%221%22%3A%22%23F59E0B%22%2C%222%22%3A%22%23FF9800%22%2C%223%22%3A%22%23FF2626%22%7D'
  curl -sf -o /dev/null "$TITILER/$TILE?url=$COGS/risk_${TILE_DATE}.tif&colormap=$RISK_CMAP"
  check $? "Risk tile renders (discrete colormap)"
fi

# titiler-xarray on-demand tiles - runs only when NEXT_PUBLIC_TILER_XR_BASE is
# configured. First tile of a cold date derives the whole field via Dask
# (~1 min on a cold cache); later tiles are served from the in-memory cache.
[ -f "$ENV_FILE" ] && eval "$(grep -E '^NEXT_PUBLIC_TILER_XR_BASE=' "$ENV_FILE")"
XR="${NEXT_PUBLIC_TILER_XR_BASE}"

if [ -n "$XR" ]; then
  echo ""
  echo "=== titiler-xarray ($XR) ==="

  curl -sf "$XR/health" > /dev/null
  check $? "Health check"

  XR_DATE=$(curl -sf "$XR/xr/dates" | python3 -c "import sys,json; d=json.load(sys.stdin)['dates']; assert d; print(d[-1])" 2>/dev/null)
  [ -n "$XR_DATE" ]
  check $? "Store init dates (latest: ${XR_DATE:-none})"

  XR_TILE="xr/tiles/WebMercatorQuad/5/19/16.png"
  curl -sf -o /dev/null --max-time 300 "$XR/$XR_TILE?date=$XR_DATE&layer=tp&window=24h"
  check $? "tp 24h tile renders (on-demand)"

  curl -sf -o /dev/null --max-time 300 "$XR/$XR_TILE?date=$XR_DATE&layer=exceedance&window=24h&rp=10"
  check $? "Exceedance 24h/10yr tile renders (on-demand)"

  curl -sf "$XR/xr/calendar?window=24h&rp=10yr" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; assert isinstance(d,list); assert not d or 'tp_max_mm' in d[0]; print(f'    {len(d)} summarized days')" 2>/dev/null
  check $? "Calendar feed (with tp_max_mm)"

  curl -sf "$XR/xr/status" | python3 -c "import sys,json; s=json.load(sys.stdin); assert set(s) >= {'summarized','total','active_date','dates','queued'}; print(f'    builder {s[\"summarized\"]}/{s[\"total\"]}, active: {s[\"active_date\"]}')" 2>/dev/null
  check $? "Builder status"

  # Summarized dates serve regions from the precomputed summaries with an ETag.
  SUM_DATE=$(curl -sf "$XR/xr/status" | python3 -c "import sys,json; d=json.load(sys.stdin)['dates']; print(d[0] if d else '')" 2>/dev/null)
  if [ -n "$SUM_DATE" ]; then
    OUT=$(curl -sf -o /dev/null -w "%{http_code} %{time_total} %header{etag}" "$XR/xr/regions/$SUM_DATE?window=24h&rp=10yr")
    echo "$OUT" | python3 -c "import sys; c,t,e=sys.stdin.read().split(maxsplit=2); assert c=='200' and float(t)<0.2 and e; print(f'    {float(t)*1000:.0f}ms, etag {e}')" 2>/dev/null
    check $? "Regions served from summaries ($SUM_DATE)"

    ETAG=$(curl -sf -o /dev/null -w "%header{etag}" "$XR/xr/regions/$SUM_DATE?window=24h&rp=10yr")
    [ "$(curl -s -o /dev/null -w "%{http_code}" -H "If-None-Match: $ETAG" "$XR/xr/regions/$SUM_DATE?window=24h&rp=10yr")" = "304" ]
    check $? "Regions ETag revalidation (304)"

    curl -sf "$XR/xr/regions-batch?window=24h&rp=10yr" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; assert d; n=len(next(iter(d.values()))); assert n>200; print(f'    {len(d)} dates x {n} regions')" 2>/dev/null
    check $? "Regions batch"
  fi

  # Unsummarized dates answer 202 and are queued for the builder.
  COLD_DATE=$(curl -sf "$XR/xr/status" | python3 -c "
import sys, json, urllib.request
s = json.load(sys.stdin)
dates = json.load(urllib.request.urlopen('$XR/xr/dates'))['dates']
done = set(s['dates']) | {s['active_date']} | set(s['queued'])
missing = [d for d in dates if d not in done]
print(missing[0] if missing else '')" 2>/dev/null)
  if [ -n "$COLD_DATE" ]; then
    [ "$(curl -s -o /dev/null -w "%{http_code}" "$XR/xr/regions/$COLD_DATE?window=24h&rp=10yr")" = "202" ]
    check $? "Cold date answers 202 pending ($COLD_DATE)"
  else
    echo "    (no cold date left; archive complete)"
  fi

  curl -sf "$XR/xr/stats" | python3 -c "import sys,json; s=json.load(sys.stdin); print(f'    cache: {s[\"cache_hits\"]} hits, {s[\"cache_misses\"]} misses, summary {s[\"summary\"][\"summarized\"]}/{s[\"summary\"][\"total_dates\"]}')" 2>/dev/null
  check $? "Cache stats"
fi

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -eq 0 ] && echo -e "${GREEN}All tests passed.${NC}" || echo -e "${RED}Some tests failed.${NC}"
exit $FAIL
