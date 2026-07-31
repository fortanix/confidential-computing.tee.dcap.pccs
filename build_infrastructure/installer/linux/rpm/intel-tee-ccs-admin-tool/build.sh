#!/usr/bin/env bash
#
# Copyright(c) 2025 Intel Corporation
# SPDX-License-Identifier: BSD-3-Clause
#

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
ROOT_DIR="${SCRIPT_DIR}/../../../../../"
LINUX_INSTALLER_DIR="${ROOT_DIR}/build_infrastructure/installer/linux"
LINUX_INSTALLER_COMMON_DIR="${LINUX_INSTALLER_DIR}/common"
LINUX_INSTALLER_COMMON_CCS_ADMIN_DIR="${LINUX_INSTALLER_COMMON_DIR}/intel-tee-ccs-admin-tool"

source ${LINUX_INSTALLER_COMMON_CCS_ADMIN_DIR}/installConfig

# Check if $1 is set and matches the version pattern X.X.X.X
if [[ -z "${1:-}" || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: First argument must be set and match the version pattern X.X.X.X" >&2
    exit 1
else
    TOOL_VERSION=$1
fi
RPM_BUILD_FOLDER=${CCS_ADMIN_PACKAGE_NAME}-${TOOL_VERSION}

main() {
    pre_build
    update_spec
    create_upstream_tarball
    build_rpm_package
    post_build
}

pre_build() {
    rm -fR ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}
    mkdir -p ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
    cp -f ${SCRIPT_DIR}/${CCS_ADMIN_PACKAGE_NAME}.spec ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}/SPECS
}

post_build() {
    for FILE in $(find ${SCRIPT_DIR}/${RPM_BUILD_FOLDER} -name "*.rpm" 2> /dev/null); do
        cp "${FILE}" ${SCRIPT_DIR}
    done
    rm -fR ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}
}

update_spec() {
    pushd ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}

    if [ "${LEGACY_PCCS_ADMIN_PACKAGE_NAME}" != "${CCS_ADMIN_PACKAGE_NAME}" ]; then
        sed -i "s#@legacy_provides@#Provides:       ${LEGACY_PCCS_ADMIN_PACKAGE_NAME} = %{version}-%{release}#" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
        sed -i "s#@legacy_obsoletes@#Obsoletes:      ${LEGACY_PCCS_ADMIN_PACKAGE_NAME} < %{version}-%{release}#" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    else
        sed -i "s#@legacy_provides@##" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
        sed -i "s#@legacy_obsoletes@##" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    fi
    
    sed -i "s#@install_path@#${INTEL_PACKAGES_PATH}/${CCS_ADMIN_PACKAGE_INSTALL_DIR_NAME}#" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    sed -i "s/@version@/${TOOL_VERSION}/" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    sed -i "s#@date@#$(date +"%a %b %d %Y")#" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    sed -i "s#@main_script_name@#${CCS_ADMIN_MAIN_SCRIPT_NAME}#" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    sed -i "s#@pkg_wrapper_script_name@#${CCS_ADMIN_WRAPPER_SCRIPT_NAME}#" SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec

    popd
}

create_upstream_tarball() {
    ${LINUX_INSTALLER_COMMON_CCS_ADMIN_DIR}/createTarball.sh
    tar -xvf ${LINUX_INSTALLER_COMMON_CCS_ADMIN_DIR}/output/${TARBALL_NAME} -C ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}/SOURCES
    pushd ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}/SOURCES
    tar -zcvf ${RPM_BUILD_FOLDER}$(echo ${TARBALL_NAME}|awk -F'.' '{print "."$(NF-1)"."$(NF)}') *
    popd
}

build_rpm_package() {
    pushd ${SCRIPT_DIR}/${RPM_BUILD_FOLDER}
    rpmbuild --define="_topdir `pwd`" --define='debug_package %{nil}' --nodebuginfo -bb SPECS/${CCS_ADMIN_PACKAGE_NAME}.spec
    popd
}

main $@
