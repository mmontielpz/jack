#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
JACK_SRC="${REPO_ROOT}/bin/jack"
INSTALL_DIR="${HOME}/.local/bin"
INSTALL_PATH="${INSTALL_DIR}/jack"

require_platform() {
  [[ "$(uname -s)" == Darwin ]] || { echo 'jack: this script only supports macOS' >&2; return 1; }
}

# shellcheck source=scripts/install-common.sh
source "${SCRIPT_DIR}/install-common.sh"
installer_main "$@"
