#!/usr/bin/env bash
set -Eeuo pipefail

readonly REMOTE_USER="mike"
readonly REMOTE_HOST="100.90.245.116"

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly JACK_SRC="${REPO_ROOT}/bin/jack"

readonly INSTALL_DIR="${HOME}/.local/bin"
readonly INSTALL_PATH="${INSTALL_DIR}/jack"

readonly PATH_MARKER="# added by jack setup-macos.sh"
readonly PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'

require_macos() {
  local os
  os="$(uname -s)"
  if [[ "${os}" != "Darwin" ]]; then
    echo "jack: this script only supports macOS (detected: ${os})" >&2
    exit 1
  fi
}

require_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi

  cat >&2 <<'EOF'
jack: Homebrew is required for automated setup.

Install Homebrew (https://brew.sh), then re-run:
  ./scripts/setup-macos.sh
EOF
  exit 1
}

check_ssh() {
  command -v ssh >/dev/null 2>&1
}

tailscale_installed() {
  command -v tailscale >/dev/null 2>&1
}

tailscale_connected() {
  tailscale_installed || return 1
  tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'
}

setup_tailscale() {
  if tailscale_connected; then
    echo "Tailscale: already installed and connected."
    return 0
  fi

  if tailscale_installed; then
    echo "Tailscale: installed but not connected."
    return 1
  fi

  echo "Tailscale: not found. Installing via Homebrew..."
  brew install --cask tailscale

  echo "Tailscale: installed."
  return 1
}

install_jack() {
  mkdir -p "${INSTALL_DIR}"
  chmod +x "${JACK_SRC}"

  if [[ -L "${INSTALL_PATH}" && "$(readlink "${INSTALL_PATH}")" == "${JACK_SRC}" ]]; then
    echo "jack: already installed at ${INSTALL_PATH}"
    return 0
  fi

  ln -sf "${JACK_SRC}" "${INSTALL_PATH}"
  echo "jack: installed at ${INSTALL_PATH} (symlink -> ${JACK_SRC})"
}

path_already_configured() {
  echo "${PATH}" | tr ':' '\n' | grep -qx "${INSTALL_DIR}"
}

shell_rc_file() {
  case "$(basename "${SHELL:-}")" in
    zsh)
      echo "${HOME}/.zprofile"
      ;;
    bash)
      echo "${HOME}/.bash_profile"
      ;;
    *)
      echo "${HOME}/.profile"
      ;;
  esac
}

configure_path() {
  if path_already_configured; then
    return 0
  fi

  local rc_file
  rc_file="$(shell_rc_file)"

  if [[ -f "${rc_file}" ]] && grep -qF "${PATH_MARKER}" "${rc_file}"; then
    echo "PATH: already configured in ${rc_file} (restart shell to apply)."
    return 1
  fi

  {
    echo ""
    echo "${PATH_MARKER}"
    echo "${PATH_LINE}"
  } >> "${rc_file}"

  echo "PATH: added ${INSTALL_DIR} to PATH via ${rc_file}."
  return 1
}

uninstall() {
  if [[ -L "${INSTALL_PATH}" && "$(readlink "${INSTALL_PATH}")" == "${JACK_SRC}" ]]; then
    rm -f "${INSTALL_PATH}"
    echo "Removed ${INSTALL_PATH}"
  fi

  local rc_file
  rc_file="$(shell_rc_file)"

  if [[ -f "${rc_file}" ]] && grep -qF "${PATH_MARKER}" "${rc_file}"; then
    local tmp
    tmp="$(mktemp)"
    grep -vF -e "${PATH_MARKER}" -e "${PATH_LINE}" "${rc_file}" > "${tmp}" || true
    mv "${tmp}" "${rc_file}"
    echo "Removed PATH entry from ${rc_file}"
  fi

  echo "jack has been uninstalled."
  echo "Homebrew, Tailscale, and SSH configuration were left untouched."
}

main() {
  if [[ "${1:-}" == "--uninstall" ]]; then
    uninstall
    exit 0
  fi

  require_macos
  require_homebrew

  if ! check_ssh; then
    echo "jack: ssh client not found (unexpected on macOS)" >&2
    exit 1
  fi

  local tailscale_ready=0
  setup_tailscale || tailscale_ready=1

  install_jack

  local path_needs_reload=0
  configure_path || path_needs_reload=1

  echo
  if [[ "${tailscale_ready}" -eq 0 ]]; then
    cat <<EOF
jack installed.

Workstation:
  ${REMOTE_USER}@${REMOTE_HOST}

Next:
EOF
    if [[ "${path_needs_reload}" -eq 1 ]]; then
      echo "  Restart your shell (or open a new terminal), then:"
    fi
    cat <<'EOF'
  jack --status
  jack
EOF
  else
    cat <<EOF
jack installed.

Tailscale requires authentication.

Open the Tailscale app and complete login/approval, then run:

  jack --status
  jack
EOF
  fi
}

main "$@"
