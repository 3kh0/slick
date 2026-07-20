#!/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/install-linux.sh" --uninstall
