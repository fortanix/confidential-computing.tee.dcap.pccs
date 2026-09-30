#!/usr/bin/env bash

#
# Copyright(c) 2025 Intel Corporation
# SPDX-License-Identifier: BSD-3-Clause
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_NAME="intel-tee-pccs-admin-tool"
COMMON_DIR="$(cd "${SCRIPT_DIR}/../../common/${PACKAGE_NAME}" && pwd)"

# Remove various intel-tee-pccs-admin-tool artifacts
for ext in deb ddeb tar.gz tar.xz dsc changes buildinfo; do
    rm -f "${SCRIPT_DIR}/${PACKAGE_NAME}"*.${ext}
done

rm -f "${COMMON_DIR}/gen_source.py"

# Remove extracted directories except intel-tee-pccs-admin-tool-1.0
find "${SCRIPT_DIR}" -maxdepth 1 -type d -name "${PACKAGE_NAME}-*" ! -name "${PACKAGE_NAME}-1.0" -exec rm -rf {} +

rm -rf "${COMMON_DIR}/output"
