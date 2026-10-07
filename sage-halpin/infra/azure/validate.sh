#!/usr/bin/env bash
# Offline validation of the Bicep in this folder: build, lint and build-params
# for both parameter files. Exits non-zero on any error (and on warnings when
# STRICT=1). Does not contact Azure.
#
#   ./validate.sh                     # uses `bicep` on PATH, else `az bicep`
#   BICEP=/path/to/bicep ./validate.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

if [[ -n "${BICEP:-}" ]]; then
  bicep() { "$BICEP" "$@"; }
elif command -v bicep >/dev/null 2>&1; then
  :
elif command -v az >/dev/null 2>&1; then
  bicep() { az bicep "$@"; }
else
  echo "No Bicep CLI found (set BICEP=/path/to/bicep)" >&2
  exit 2
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
LOG="$OUT/log"
: > "$LOG"

run() {
  echo "+ $*"
  if ! "$@" 2>&1 | tee -a "$LOG"; then
    echo "FAILED: $*" >&2
    exit 1
  fi
  # bicep exits 0 on warnings; make sure no error slipped through a pipe.
  if grep -q ": Error " "$LOG"; then
    echo "FAILED (errors reported): $*" >&2
    exit 1
  fi
}

run bicep build main.bicep --outfile "$OUT/main.json"
run bicep lint main.bicep

# Placeholder values for the variables the param files require. They only
# prove the files compile; real values are supplied at deploy time.
export BUDGET_AMOUNT="${BUDGET_AMOUNT:-100}"
export ALERT_EMAILS="${ALERT_EMAILS:-ops@example.invalid}"
export FOUNDRY_RESOURCE_NAME="${FOUNDRY_RESOURCE_NAME:-validate-placeholder}"
export TAG_OWNER="${TAG_OWNER:-validate-placeholder}"

for p in prod nonprod; do
  run bicep build-params "params/$p.bicepparam" --outfile "$OUT/$p.parameters.json"
  run bicep lint "params/$p.bicepparam"
done

if grep -q ": Warning " "$LOG"; then
  echo "Completed with warnings (see above)."
  [[ "${STRICT:-0}" == "1" ]] && exit 1
else
  echo "OK: build, lint and build-params passed with no errors or warnings."
fi
