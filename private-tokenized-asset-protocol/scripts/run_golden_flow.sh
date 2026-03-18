#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"
SUBJECT_COMMITMENT="${SUBJECT_COMMITMENT:-subj_demo_001}"
POLICY_ID="${POLICY_ID:-1}"

PROOF=$(curl -s "$API_BASE_URL/api/v1/proof/eligibility" \
  -H 'content-type: application/json' \
  -d "{\"subjectCommitment\":\"$SUBJECT_COMMITMENT\",\"policyId\":$POLICY_ID}")

echo "Proof:"
echo "$PROOF"
echo

VERIFY=$(curl -s "$API_BASE_URL/api/v1/proof/verify" \
  -H 'content-type: application/json' \
  -d "$PROOF")

echo "Verify:"
echo "$VERIFY"
echo

SETTLEMENT_PAYLOAD=$(printf '{"operation":"eligibility","subjectCommitment":"%s","proof":%s}' "$SUBJECT_COMMITMENT" "$PROOF")
SETTLED=$(curl -s "$API_BASE_URL/api/v1/settlement/record" \
  -H 'content-type: application/json' \
  -d "$SETTLEMENT_PAYLOAD")

echo "Settlement:"
echo "$SETTLED"
echo

RECENT=$(curl -s "$API_BASE_URL/api/v1/settlement/recent")
echo "Recent settlements:"
echo "$RECENT"
