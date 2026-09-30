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
LINUX_INSTALLER_COMMON_PCCS_ADMIN_DIR="${LINUX_INSTALLER_COMMON_DIR}/intel-tee-pccs-admin-tool"

source "${LINUX_INSTALLER_COMMON_PCCS_ADMIN_DIR}"/installConfig
DEB_FOLDER=${PCCS_ADMIN_PACKAGE_NAME}-${PCCS_ADMIN_VERSION}


# Check if $1 is set and matches the version pattern X.X.X.X
if [[ -z "${1:-}" || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: First argument must be set and match the version pattern X.X.X.X" >&2
    exit 1
else
    TOOL_VERSION=$1
fi

DEB_BUILD_FOLDER=${PCCS_ADMIN_PACKAGE_NAME}-${TOOL_VERSION}

main() {
    pre_build
    create_upstream_tarball
    unpack_upstream_tarball
    generate_copyright
    update_version
    update_install_path
    rename_tarball
    build_deb_package
    post_build
}

pre_build() {
    rm -fR ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
    cp -fR ${SCRIPT_DIR}/${DEB_FOLDER} ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
}

post_build() {
    rm -fR ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
}

create_upstream_tarball() {
    ${LINUX_INSTALLER_COMMON_PCCS_ADMIN_DIR}/createTarball.sh
    cp ${LINUX_INSTALLER_COMMON_PCCS_ADMIN_DIR}/output/${TARBALL_NAME} ${SCRIPT_DIR}
}

unpack_upstream_tarball() {
    pushd ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
    cp ../${TARBALL_NAME} .
    tar xvf ${TARBALL_NAME}
    rm -f ${TARBALL_NAME}
    popd
}

generate_copyright() {
    pushd ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
    rm -f debian/copyright
    find package/licenses/ -type f -print0 | xargs -0 -n1 cat >> debian/copyright
    popd
}

get_os_code() {
    OS_CODE=$(lsb_release -cs 2> /dev/null)
    if [ -z ${OS_CODE} ]; then
        OS_CODE=$(grep "VERSION_CODENAME" /etc/os-release 2> /dev/null | cut -d= -f2)
    fi
    echo ${OS_CODE}
}

update_version() {
    pushd ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
    INS_VERSION=$(echo $(dpkg-parsechangelog |grep "Version" | cut -d: -f2))
    INS_DATE=$(dpkg-parsechangelog | awk '/^Date:/ {print substr($0, index($0,$2)) ; exit}')
    DEB_VERSION=$(echo $INS_VERSION | cut -d- -f2)

    FULL_VERSION=${TOOL_VERSION}-$(get_os_code)${DEB_VERSION}
    sed -i "0,/${INS_VERSION}/s//${FULL_VERSION}/" debian/changelog
    sed -i "0,/${INS_DATE}/s//$(date -u +"%a, %d %b %Y %H:%M:%S +0000")/" debian/changelog
    sed -i "s/@dep_version@/${FULL_VERSION}/g" debian/control    
    popd
}

update_install_path() {
    pushd ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
    sed -i "s#@pkg_path@#${PCCS_ADMIN_PACKAGE_PATH}/${PCCS_ADMIN_PACKAGE_INSTALL_DIR_NAME}#" debian/postinst
    sed -i "s#@main_script_name@#${PCCS_ADMIN_MAIN_SCRIPT_NAME}#" debian/postinst
    sed -i "s#@pkg_wrapper_script_name@#${PCCS_ADMIN_WRAPPER_SCRIPT_NAME}#" debian/postinst

    sed -i "s#@pkg_path@#${PCCS_ADMIN_PACKAGE_PATH}/${PCCS_ADMIN_PACKAGE_INSTALL_DIR_NAME}#" debian/prerm
    sed -i "s#@main_script_name@#${PCCS_ADMIN_MAIN_SCRIPT_NAME}#" debian/prerm
    sed -i "s#@pkg_wrapper_script_name@#${PCCS_ADMIN_WRAPPER_SCRIPT_NAME}#" debian/prerm
    popd
}

rename_tarball() {
    TARBALL_NAME_NEW_VERSION=$(echo ${TARBALL_NAME} | sed "s/${PCCS_ADMIN_VERSION}/${TOOL_VERSION}/")
    mv ${SCRIPT_DIR}/${TARBALL_NAME} ${SCRIPT_DIR}/${TARBALL_NAME_NEW_VERSION}
}

build_deb_package() {
    pushd ${SCRIPT_DIR}/${DEB_BUILD_FOLDER}
    SOURCE_DATE_EPOCH="$(date +%s)" dpkg-buildpackage -us -uc
    popd
}

main $@
