#!/usr/bin/env bash
# Shows the latest CI runs of a branch, and the failed steps of the newest one, using the
# credential git already has for github.com. The token is never printed nor stored.
#
#   bash tools/ci-status.sh [branch]          latest runs (default: current branch)
#   bash tools/ci-status.sh [branch] --log    also print the end of the log of each failed job
set -euo pipefail

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
remote="$(git remote get-url origin)"
repo="$(printf '%s' "$remote" | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"
token="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')"
[ -n "$token" ] || { echo "sem credencial do git para github.com" >&2; exit 1; }

api() { curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$@"; }

runs="$(api "https://api.github.com/repos/$repo/actions/runs?branch=$branch&per_page=5")"
RUNS="$runs" node -e '
  const { workflow_runs: runs = [] } = JSON.parse(process.env.RUNS);
  if (!runs.length) console.log("nenhuma execução para esta branch");
  for (const r of runs)
    console.log([r.id, r.name, r.head_sha.slice(0, 7), r.status, r.conclusion ?? "-", r.created_at].join("  "));
'
run_id="$(RUNS="$runs" node -e 'const r = JSON.parse(process.env.RUNS).workflow_runs?.[0]; if (r) console.log(r.id)')"
[ -n "$run_id" ] || exit 0

jobs="$(api "https://api.github.com/repos/$repo/actions/runs/$run_id/jobs?per_page=50")"
JOBS="$jobs" node -e '
  for (const j of JSON.parse(process.env.JOBS).jobs ?? []) {
    console.log(`\n${j.name}: ${j.status} ${j.conclusion ?? ""}`);
    for (const s of j.steps ?? [])
      if (s.conclusion && !["success", "skipped"].includes(s.conclusion)) console.log(`  ✘ ${s.name} (${s.conclusion})`);
  }
'
if [ "${2:-}" = "--log" ]; then
  for job_id in $(JOBS="$jobs" node -e 'for (const j of JSON.parse(process.env.JOBS).jobs ?? []) if (j.conclusion === "failure") console.log(j.id)'); do
    echo "===== log do job $job_id (fim) ====="
    api "https://api.github.com/repos/$repo/actions/jobs/$job_id/logs" | tail -n "${CI_LOG_LINES:-80}"
  done
fi
