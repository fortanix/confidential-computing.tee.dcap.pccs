#
# Copyright(c) 2025 Intel Corporation
# SPDX-License-Identifier: BSD-3-Clause
#

CCS_VERSION ?= "9.9.9.9"
CCS_ADMIN_TOOL_VERSION ?= $(CCS_VERSION)

.PHONY: default deb rpm build test all
default: all

deb: deb_sgx_dcap_ccs_pkg deb_ccs_admin_tool_pkg
rpm: rpm_sgx_dcap_ccs_pkg rpm_ccs_admin_tool_pkg
all: build test
build: deb rpm
test:
	cd service && npm install && npm test && cd -

.PHONY: deb_sgx_dcap_ccs_pkg
deb_sgx_dcap_ccs_pkg:
	./build_infrastructure/installer/linux/deb/sgx-dcap-ccs/build.sh $(CCS_VERSION)

.PHONY: deb_ccs_admin_tool_pkg
deb_ccs_admin_tool_pkg:
	./build_infrastructure/installer/linux/deb/intel-tee-ccs-admin-tool/build.sh $(CCS_ADMIN_TOOL_VERSION)

.PHONY: rpm_sgx_dcap_ccs_pkg
rpm_sgx_dcap_ccs_pkg:
	./build_infrastructure/installer/linux/rpm/sgx-dcap-ccs/build.sh $(CCS_VERSION)

.PHONY: rpm_ccs_admin_tool_pkg
rpm_ccs_admin_tool_pkg:
	./build_infrastructure/installer/linux/rpm/intel-tee-ccs-admin-tool/build.sh $(CCS_ADMIN_TOOL_VERSION)

clean:
	./build_infrastructure/installer/linux/deb/sgx-dcap-ccs/clean.sh
	./build_infrastructure/installer/linux/rpm/sgx-dcap-ccs/clean.sh
	./build_infrastructure/installer/linux/deb/intel-tee-ccs-admin-tool/clean.sh
	./build_infrastructure/installer/linux/rpm/intel-tee-ccs-admin-tool/clean.sh
