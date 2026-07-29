#!/bin/bash

set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '需要先安装 Node.js 18+ 和 npm。\n' >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend install
fi

exec npm run dev
