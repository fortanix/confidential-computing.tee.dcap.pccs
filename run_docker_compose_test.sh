#!/usr/bin/env bash
# Copyright (c) Fortanix, Inc. SPDX-License-Identifier: BSD-3-Clause
# Adapted from source 89ae25e6; run the original Compose/Rust integration tests.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$repo_root"
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-pccs-test-$$}
reports="$repo_root/service/test-reports/compose"
mkdir -p "$reports"
compose=(docker compose --file "$repo_root/container/compose.yml")
cleanup() {
    local test_exit=$?
    trap - EXIT
    "${compose[@]}" logs --no-color > "$reports/containers.log" 2>&1 || true
    "${compose[@]}" down --volumes --timeout 10 || true
    exit "$test_exit"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${compose[@]}" up --build --abort-on-container-exit --exit-code-from pccs-dev-test --timeout 10
