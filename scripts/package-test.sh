#!/usr/bin/env bash
# ساخت بسته‌ی آزمایشی (فقط به Node.js نیاز دارد؛ بدون npm install)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist-test/jaryan-test"
rm -rf "$ROOT/dist-test" && mkdir -p "$OUT"
(cd "$ROOT/web" && npm run build)
(cd "$ROOT/server" && npm run bundle)
cp "$ROOT/server/dist/main.js" "$OUT/main.js"
cp -r "$ROOT/server/public" "$OUT/public"
cp "$ROOT/scripts/test-pack/"* "$OUT/"
(cd "$ROOT/dist-test" && zip -qr jaryan-test.zip jaryan-test)
echo "ساخته شد: $ROOT/dist-test/jaryan-test.zip"
