#!/usr/bin/env bash
set -euo pipefail
BASE_URL="http://localhost:3011"
AUTH="Authorization: Bearer kd-a7f3b9c2e1d4"
ADMIN="X-Konductor-User: deanwheatley"
CT="Content-Type: application/json"

echo "1. Assign prod 0.5.1"
curl -s --max-time 3 -H "Connection: close" -X PUT -H "$AUTH" -H "$ADMIN" -H "$CT" -d '{"version":"0.5.1"}' "$BASE_URL/api/admin/channels/prod/assign" > /dev/null

echo "2. Set user to latest"
curl -s --max-time 3 -H "Connection: close" -X PUT -H "$AUTH" -H "$ADMIN" -H "$CT" -d '{"installerChannel":"latest"}' "$BASE_URL/api/admin/users/deanwheatley" > /dev/null
sleep 0.2

echo "3. Register with 0.5.0"
R=$(curl -s --max-time 3 -H "Connection: close" -X POST -H "$AUTH" -H "X-Konductor-Client-Version: 0.5.0" -H "$CT" -d '{"userId":"deanwheatley","repo":"deanwheatley/testrepo","branch":"main","files":["test.txt"]}' "$BASE_URL/api/register")

echo "4. Result:"
echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  UR:', d.get('updateRequired','ABSENT')); print('  SV:', d.get('serverVersion','NONE')); print('  UU:', d.get('updateUrl','NONE'))"
