#!/usr/bin/env bash
# Copyright (c) Fortanix, Inc. SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail

# Refresh-date coverage lives in service/test/live/refresh.spec.js.
exec cargo test --locked -p dcap-artifact-retrieval "pccs::" -- --ignored
