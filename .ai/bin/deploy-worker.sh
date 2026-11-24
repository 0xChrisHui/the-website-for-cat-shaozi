#!/usr/bin/env bash
set -euo pipefail

target=${1:-}
sha=${2:-}
if [[ "$target" == test && "$sha" == --latest ]]; then
  sha=$(timeout 30 gh api --method GET "repos/${WORKER_REPOSITORY:?}/git/ref/heads/integration" --jq .object.sha)
fi
[[ "$target" =~ ^(test|prod)$ && "$sha" =~ ^[a-f0-9]{40}$ ]] ||
  { echo '用法：deploy-worker.sh <test|prod> <完整 SHA>' >&2; exit 2; }
[[ $(id -un) == agent ]] || { echo '使用 agent 安装依赖。' >&2; exit 2; }
repository=${WORKER_REPOSITORY:?}
checkout=${WORKER_GIT_DIR:?}
root="/srv/memorial-worker/$target"
command -v flock >/dev/null
exec 9>"$root/deploy.lock"
flock -n 9

if [[ "$target" == test ]]; then
  [[ "$repository" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]
  url_prefix="https://github.com/$repository/actions/runs/"
  state=$(timeout 30 gh api --method GET "repos/$repository/commits/$sha/statuses?per_page=100" |
    jq -er 'first(.[] | select(.context == "integration-schema" and .creator.login == "github-actions[bot]")) | select(.state == "success") | .target_url')
  [[ "$state" == "$url_prefix"* ]]
  run=${state#"$url_prefix"}
  [[ "$run" =~ ^[0-9]+$ ]]
  timeout 30 gh api --method GET "repos/$repository/actions/runs/$run" |
    jq -e --arg repo "$repository" '.repository.full_name == $repo and .head_branch == "main"
      and .path == ".github/workflows/migrate-integration.yml" and .event == "workflow_run" and .conclusion == "success"' >/dev/null
  evidence=$(mktemp -d)
  trap 'rm -rf -- "$evidence"' EXIT
  timeout 60 gh run download "$run" -R "$repository" -n integration-schema-evidence -D "$evidence"
  jq -e --arg sha "$sha" 'any(.[]; .sha == $sha and all(.files[]; .sha256 | test("^[a-f0-9]{64}$")))' "$evidence/database.types.ts.manifest.json" >/dev/null
  test -f "$evidence/verified-types/$sha.ts"
  timeout 60 git -C "$checkout" fetch --no-tags origin refs/heads/integration:refs/remotes/origin/integration
  git -C "$checkout" rev-list --first-parent origin/integration | awk -v sha="$sha" '$0 == sha { found=1 } END { exit !found }'
else
  approval=/etc/memorial-worker/approved-production-sha
  [[ -f "$approval" && ! -L "$approval" && "$(stat -c '%U:%a' "$approval")" == root:644 && $(cat -- "$approval") == "$sha" ]] ||
    { echo '缺少管理员批准的生产提交。' >&2; exit 2; }
  timeout 60 git -C "$checkout" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
  git -C "$checkout" merge-base --is-ancestor "$sha" origin/main
fi

unit="memorial-worker@$target.service"
versions="$root/releases"
destination="$versions/$sha"
mkdir -p -- "$versions"
previous=$(readlink -- "$root/current" || true)
if [[ "$previous" == "$destination" ]] && systemctl is-active --quiet "$unit"; then exit 0; fi
if [[ ! -f "$destination/.release-complete" ]]; then
  temporary=$(mktemp -d "$versions/.release.XXXXXX")
  git -C "$checkout" archive "$sha" | tar -x -C "$temporary"
  if ! (cd "$temporary" && timeout 300 corepack pnpm install --frozen-lockfile && timeout 120 corepack pnpm verify); then
    rm -rf -- "$temporary"
    echo "安装或预检失败：$sha" >&2
    exit 1
  fi
  touch "$temporary/.release-complete"
  mv -T -- "$temporary" "$destination"
fi
# systemd sends SIGTERM; the worker stops claiming while the current task reaches a durable boundary.
if ! timeout 90 sudo -n systemctl stop "$unit"; then
  echo "工作器未在等待窗口内停止，保留当前版本：$sha" >&2
  exit 1
fi
link=$(mktemp -u "$root/.current.XXXXXX")
ln -s -- "$destination" "$link"
mv -fT -- "$link" "$root/current"
if ! timeout 30 sudo -n systemctl start "$unit" || ! systemctl is-active --quiet "$unit"; then
  timeout 30 sudo -n systemctl stop "$unit" || true
  if [[ "$target" == test && "$previous" == "$versions/"* && -f "$previous/.release-complete" ]]; then
    ln -s -- "$previous" "$link"
    mv -fT -- "$link" "$root/current"
    timeout 30 sudo -n systemctl start "$unit" || true
  fi
  echo "工作器启动失败：$sha" >&2
  exit 1
fi
printf 'worker %s %s\n' "$target" "$sha"
