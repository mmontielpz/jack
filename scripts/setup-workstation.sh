#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
JACK_SRC="${REPO_ROOT}/bin/jack"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_PATH="${INSTALL_DIR}/jack"

require_platform() {
  [[ "$(uname -s)" == Linux ]] || { echo 'jack: this script only supports Linux' >&2; return 1; }
  command -v pacman >/dev/null 2>&1 || { echo 'jack: this script supports Arch-based systems (pacman) only' >&2; return 1; }
  local release line supported=0
  release="$(cat /etc/os-release 2>/dev/null)" || return 1
  while IFS= read -r line; do
    case "${line}" in ID=arch|ID=cachyos|'ID="arch"'|'ID="cachyos"') supported=1 ;; esac
  done <<< "${release}"
  [[ "${supported}" -eq 1 ]] || { echo 'jack: supported Linux targets are Arch Linux/CachyOS only.' >&2; return 1; }
}

# shellcheck source=scripts/install-common.sh
source "${SCRIPT_DIR}/install-common.sh"
installer_main "$@"
