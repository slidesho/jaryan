#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js نصب نیست. نسخه‌ی LTS را از https://nodejs.org نصب کنید."; exit 1; }
echo "رابط روی http://127.0.0.1:3000 باز می‌شود"
node main.js
