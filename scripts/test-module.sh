#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <test-script>"
  exit 1
fi

npm run "$1"
