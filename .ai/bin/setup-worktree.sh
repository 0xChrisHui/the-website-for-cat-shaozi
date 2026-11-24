#!/usr/bin/env bash
set -euo pipefail

target=${1:?用法：setup-worktree.sh <worktree-dir> [env-file]}
source_env=${2:-$HOME/secrets/memorial.env.local}
for tool in git node corepack gh forge supabase psql install; do
  command -v "$tool" >/dev/null || { echo "安装缺失工具：$tool" >&2; exit 1; }
done
[[ -f "$source_env" && ! -L "$source_env" ]] || { echo '提供普通本机测试环境文件。' >&2; exit 1; }
source_env=$(realpath -e -- "$source_env")
cd -- "$target"
[[ "$(pwd -P)" == "$(git rev-parse --show-toplevel)" && -f pnpm-lock.yaml && -f .env.example && -f .ai/bin/delivery.sh ]] ||
  { echo '请使用已同步地基及 D3 脚本的 worktree。' >&2; exit 1; }
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major !== 24 || minor < 13) process.exit(1)' ||
  { echo '安装 Node 24.13 或更高的 24.x 版本。' >&2; exit 1; }
expected=$(node -p 'require("./package.json").packageManager.split("@")[1]')
[[ "$(corepack pnpm --version)" == "$expected" ]] || { echo '用 Corepack 获取 packageManager 固定的 pnpm。' >&2; exit 1; }
[[ ! -L .env.local ]] ||
  { echo '提供普通本机测试环境文件。' >&2; exit 1; }
git check-ignore -q .env.local || { echo '请先从 Git 排除 .env.local。' >&2; exit 1; }
node scripts/check-stage0.mjs --env-file "$source_env"
tmp=$(mktemp .env.local.XXXXXX)
trap 'rm -f -- "$tmp"' EXIT
install -m 0600 -- "$source_env" "$tmp"
mv -fT -- "$tmp" .env.local
corepack pnpm install --frozen-lockfile
if ! timeout 20 node --input-type=module -e 'import { chromium } from "@playwright/test"; const browser = await chromium.launch(); await browser.close()'; then
  echo '安装锁定的 Playwright Chromium 和系统依赖：corepack pnpm exec playwright install --with-deps chromium' >&2
  exit 1
fi
