#!/usr/bin/env bash
#
# Copyright(c) 2025 Intel Corporation
# SPDX-License-Identifier: BSD-3-Clause
#

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
COMMON_DIR="${SCRIPT_DIR}/../../common/intel-tee-pccs-admin-tool"

rm -f ${SCRIPT_DIR}/intel-tee-pccs-admin-tool*.rpm
rm -f ${COMMON_DIR}/gen_source.py
rm -rf ${COMMON_DIR}/output
rm -rf ${SCRIPT_DIR}/intel-tee-pccs-admin-tool-*/
