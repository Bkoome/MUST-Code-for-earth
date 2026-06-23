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

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -eq 0 ] && echo -e "${GREEN}All tests passed.${NC}" || echo -e "${RED}Some tests failed.${NC}"
exit $FAIL
