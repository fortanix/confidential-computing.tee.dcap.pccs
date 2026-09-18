#
# Copyright (C) 2011-2026 Intel Corporation
#
# Redistribution and use in source and binary forms, with or without modification,
# are permitted provided that the following conditions are met:
#
# 1. Redistributions of source code must retain the above copyright notice,
#    this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright notice,
#    this list of conditions and the following disclaimer in the documentation
#    and/or other materials provided with the distribution.
# 3. Neither the name of the copyright holder nor the names of its contributors
#    may be used to endorse or promote products derived from this software
#    without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
# THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
# BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
# OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
# OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
# OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
# WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
# OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
# EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
#
#
# SPDX-License-Identifier: BSD-3-Clause

%define _install_path @install_path@
%define _legacy_install_path @legacy_install_path@
%define _license_file COPYING

Name:           sgx-dcap-ccs
Version:        @version@
Release:        1%{?dist}
Summary:        Intel(R) Software Guard Extensions PCK Caching Service
Group:          Applications/Internet

# Note: NodeJS version constraint is deliberately lax, to allow for forward-compat
#       As of time of this writing, we declare official support
#       for Active LTS (v24) or Maintenance LTS (v22) versions
#
# Note2: RedHat-based systems have the virtual nodejs package with epoch 1, so a naive 'nodejs >= 22.13.0' does not work due to '1:16.20.2' > '0:22.13.0'
#        Also, while 'nodejsXX' packages are more commonly in use, the NodeSource project provides backports at epoch 0 or 2, so the below may not be 100% robust if
#        there's a package like 2:1.1.0, but should be versatile enough to catch most issues and not create a false-negative scenario w/ a proper version not allowed.
#        For example, every nsolid package will saturate the nodejs >= 1:22.13.0 predicate which is why we exclude it there (but it still provides nodejs(engine) so would be allowed)
#
Requires:       ((nodejs(engine) >= 22.13.0) or (nodejs >= 1:22.13.0 unless nsolid) or ((nodejs >= 0:22.13.0 and nodejs < 1:) unless nsolid) or nodejs24 or nodejs22)

Requires:       (npm or nodejs24-npm or npm24 or nodejs22-npm or npm22)

Requires:       cracklib
@legacy_provides@
@legacy_obsoletes@
@legacy_conflicts@

%if 0%{?suse_version} == 0
# On OpenSUSE cracklib comes with `cracklib-dict` as a required dep (and `cracklib-dict` is n/a). On other systems, it needs to be installed separate.
Requires:       cracklib-dicts
# 'startup.sh' is using 'adduser', which is provided by the shadow-utils package
Requires:       shadow-utils
%else
# OpenSUSE has 'shadow' package instead of 'shadow-utils' (also no adduser by default, so the script falls back to useradd)
Requires:       shadow
%endif

# If openssl is present, it allows to auto-generate self-signed TLS certificates for HTTPS support at install-time
Recommends:     openssl

# intel-tee-ccs-admin-tool is a recommended dependency (especially for managing pccs in REQ and OFFLINE modes).
#   While, in some deployments, it is installed on a different host from the CCS system itself, it is considered
#   a weak dependency due to the practicality of having it also available on the localhost.
#   Note the reverse is not true: CCS package is merely a *hint* for intel-tee-ccs-admin-tool.
Recommends:     intel-tee-ccs-admin-tool >= %{version}-%{release}

License:        BSD License
URL:            https://github.com/intel/confidential-computing.tee.dcap.pccs
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch

%description
Intel(R) Software Guard Extensions PCK Caching Service

%prep
%setup -qc

%install
make DESTDIR=%{?buildroot} install
install -d %{?buildroot}%{_docdir}/%{name}
find linux/installer/common/sdk/output/package/licenses/ -type f -print0 | \
xargs -0 -n1 cat >> %{?buildroot}%{_docdir}/%{name}/%{_license_file}
find %{?buildroot} -type d -links 2 | \
sed -e "s#^%{?buildroot}##" | \
grep -v "^%{_libdir}" | \
grep -v "^%{_bindir}" | \
grep -v "^%{_sysconfdir}" | \
grep -v "^%{_install_path}" | \
sed -e "s#^#%dir #" > %{_specdir}/listfiles
for f in $(find %{?buildroot}); do
    if [ -d ${f} ]; then
        echo ${f} | \
        sed -e "s#^%{?buildroot}##" | \
        grep "^%{_install_path}" | \
        sed -e "s#^#%dir #" >> %{_specdir}/listfiles
    else
        echo ${f} | \
        sed -e "s#^%{?buildroot}##" >> %{_specdir}/listfiles
    fi
done
sed -i 's#^%{_install_path}/config/default.json#%config &#' %{_specdir}/listfiles

%files -f %{_specdir}/listfiles

%post
if [ "%{_install_path}" != "%{_legacy_install_path}" ] && [ -d "%{_legacy_install_path}" ]; then
    copy_legacy_dir_contents() {
        SOURCE_DIR="$1"
        TARGET_DIR="$2"

        if [ -d "${SOURCE_DIR}" ]; then
            mkdir -p "${TARGET_DIR}"
            cp -a "${SOURCE_DIR}/." "${TARGET_DIR}/" 2>/dev/null || true
        fi
    }

    mkdir -p "%{_install_path}/config" "%{_install_path}/ssl_key"

    copy_legacy_dir_contents "%{_legacy_install_path}/config" "%{_install_path}/config"

    if [ -f "%{_legacy_install_path}/pckcache.db" ]; then
        cp -f "%{_legacy_install_path}/pckcache.db" "%{_install_path}/pckcache.db"
    fi

    copy_legacy_dir_contents "%{_legacy_install_path}/ssl_key" "%{_install_path}/ssl_key"

    rm -rf "%{_legacy_install_path}/node_modules"
    rm -f "%{_legacy_install_path}/.npmrc"
    rm -rf "%{_legacy_install_path}/.npm"
fi

cleanup_legacy_service_account() {
    if [ "%{_install_path}" = "%{_legacy_install_path}" ]; then
        return
    fi

    if getent passwd pccs >/dev/null 2>&1; then
        if command -v deluser >/dev/null 2>&1; then
            deluser --quiet --system pccs || true
        else
            userdel pccs || true
        fi
    fi

    if getent group pccs >/dev/null 2>&1; then
        if command -v delgroup >/dev/null 2>&1; then
            delgroup --quiet --system pccs || true
        else
            groupdel pccs || true
        fi
    fi
}

cleanup_legacy_service_account

if [ ! -z "$(getent passwd ccs)" -a ! -z "$(getent group ccs)" ]; then
    for d in config ssl_key; do
        if [ -d "%{_install_path}/${d}" ]; then
            chown -R ccs:ccs "%{_install_path}/${d}"
        fi
    done

    if [ -f "%{_install_path}/pckcache.db" ]; then
        chown ccs:ccs "%{_install_path}/pckcache.db"
    fi
fi

if [ -x %{_install_path}/startup.sh ]; then %{_install_path}/startup.sh; fi

%preun
if [ "$1" -eq 0 ] && [ -x %{_install_path}/uninstall.sh ]; then %{_install_path}/uninstall.sh; fi

%postun
if [ "$1" -eq 0 ]; then
    rm -rf "%{_install_path}/node_modules"
    rm -f  "%{_install_path}/.npmrc"
    rm -rf "%{_install_path}/.npm"
    rm -f  "%{_install_path}/pckcache.db"
    rm -rf "%{_install_path}/logs"
    rm -rf "%{_install_path}/ssl_key"
    rm -rf "%{_install_path}/config"
    rmdir  "%{_install_path}" 2>/dev/null || true
fi

%changelog
* Mon Mar 10 2020 SGX Team
- Initial Release
