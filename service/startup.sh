#!/usr/bin/env bash
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


set -e

if test $(id -u) -ne 0; then
    echo "Root privilege is required."
    exit 1
fi

get_manual_command() {
    # Generate a command to run a command as a specific user (accounting for availability of 'su' or 'sudo')
    local cmd="$1"
    local user="${2:-$CCS_USER}"
    if [ -x /bin/su ]; then
        echo "/bin/su - ${user} -c '${cmd}'"
    else
        echo "sudo -u ${user} bash -c \"${cmd}\""
    fi
}

# Check if terminal supports colors
if [ -t 1 ] && tput colors &>/dev/null; then
    YELLOW='\033[1;33m'
    RED='\033[1;31m'
    CYAN='\033[1;36m'
    GRAY='\033[1;30m'
    MAGENTA='\033[1;35m'
    RESET='\033[0m'
else
    YELLOW=''
    RED=''
    CYAN=''
    GRAY=''
    MAGENTA=''
    RESET=''
fi

CCS_USER=ccs
CCS_HOME=$(readlink -m $(dirname "$0"))
if [ "$1" == "debian" ]; then
    adduser --quiet --system $CCS_USER --group --home $CCS_HOME --no-create-home --shell /bin/bash
else
    if ! getent group "$CCS_USER" >/dev/null 2>&1; then
        groupadd "$CCS_USER"
    fi
    if ! getent passwd "$CCS_USER" >/dev/null 2>&1; then
        if command -v adduser &>/dev/null; then
            adduser --system "$CCS_USER" -g "$CCS_USER" --home "$CCS_HOME" --no-create-home --shell /bin/bash
        else
            useradd -r -g "$CCS_USER" -d "$CCS_HOME" -s /bin/bash "$CCS_USER"
        fi
    fi
fi
chown -R "$CCS_USER:$CCS_USER" "$CCS_HOME"
if [ -f "$CCS_HOME/config/default.json" ]; then
    chmod 640 "$CCS_HOME/config/default.json"
fi
if [ "$1" == "debian" -a "${DEBIAN_FRONTEND}" != "noninteractive" ]
then
    /bin/su -c "$CCS_HOME/install.sh" "$CCS_USER"
else
    echo -e "$(cat <<EOF

${YELLOW}┌───────────────────────────────────────────────────────────────────────────────┐
│  ${RED}WARNING:${YELLOW} Non-interactive installation!                                       │
│           CCS post-install configuration has been SKIPPED.                   │
└───────────────────────────────────────────────────────────────────────────────┘${RESET}
┋ You need to configure the service manually before 1st startup. For example, by running: 
┋    ${CYAN}$(get_manual_command "$CCS_HOME/install.sh")${RESET}
┋
EOF
    )"
fi
#Install CCS as system service
echo -n "Installing CCS service ..."
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload
    systemctl enable ccs
    if [ "$1" == "debian" ]; then 
        systemctl start ccs
    fi
elif [ -d /etc/init/ ]; then
    /sbin/initctl reload-configuration
else
    echo " failed."
    if grep -qE 'docker|lxc' /proc/1/cgroup; then
        echo -e "$(cat <<EOF

${GRAY}┌───────────────────────────────────────────────────────────────────────────────┐
│  ${MAGENTA}NOTICE:${GRAY} Running inside a container (without systemd or init).                │
│          CCS service (daemon) startup has been SKIPPED.                      │
└───────────────────────────────────────────────────────────────────────────────┘${RESET}
┋ You can start CCS manually by running: 
┋    ${CYAN}$(get_manual_command "cd ${CCS_HOME} && NODE_ENV=production /usr/bin/node ./ccs_server.js")${RESET}
┋
EOF
        )"
    else
        # Non-Docker host without systemd or upstart (e.g., older Debian/Ubuntu - bail out)
        echo "Unsupported platform - neither systemctl nor initctl was found."
        exit 5
    fi    
fi
echo "finished."
echo "Installation completed successfully."
