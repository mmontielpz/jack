#!/usr/bin/env bash
set -Eeuo pipefail

# Prepares the Linux workstation (Arch / CachyOS) for jack.
# Never enables system sshd, opens ports, or touches the firewall:
# inbound access is Tailscale SSH only.

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly JACK_SRC="${REPO_ROOT}/bin/jack"

readonly INSTALL_DIR="${HOME}/.local/bin"
readonly INSTALL_PATH="${INSTALL_DIR}/jack"

readonly PATH_MARKER="# added by jack setup-workstation.sh"
readonly PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
readonly FISH_PATH_LINE='fish_add_path ~/.local/bin'

require_linux() {
  local os
  os="$(uname -s)"
  if [[ "${os}" != "Linux" ]]; then
    echo "jack: this script only supports Linux (detected: ${os})" >&2
    exit 1
  fi
}

require_pacman() {
  if ! command -v pacman >/dev/null 2>&1; then
    echo "jack: this script supports Arch-based systems (pacman) only" >&2
    exit 1
  fi
}

require_ssh_client() {
  if ! command -v ssh >/dev/null 2>&1; then
    echo "jack: ssh client not found. Install it with: sudo pacman -S --needed openssh" >&2
    exit 1
  fi
}

tailscale_backend_running() {
  tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'
}

tailscale_ssh_enabled() {
  tailscale debug prefs 2>/dev/null | grep -q '"RunSSH": *true'
}

setup_tailscale() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "Tailscale: not found. Installing via pacman..."
    sudo pacman -S --needed tailscale
  fi

  if systemctl is-enabled --quiet tailscaled && systemctl is-active --quiet tailscaled; then
    echo "tailscaled: enabled and active."
  else
    echo "tailscaled: enabling and starting..."
    sudo systemctl enable --now tailscaled
  fi
}

# Returns non-zero when a human action is still required.
setup_tailscale_ssh() {
  if ! tailscale_backend_running; then
    echo "Tailscale: not authenticated."
    return 1
  fi
  echo "Tailscale: connected."

  if tailscale_ssh_enabled; then
    echo "Tailscale SSH: enabled."
    return 0
  fi

  # Turning on Tailscale SSH takes over port 22 on the tailnet address,
  # which can drop an SSH session that arrived that way. Only do it locally.
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    echo "Tailscale SSH: disabled (not enabling from inside an SSH session)."
    return 1
  fi

  echo "Tailscale SSH: enabling..."
  tailscale set --ssh 2>/dev/null || sudo tailscale set --ssh
  echo "Tailscale SSH: enabled."
}

report_sshd() {
  if systemctl is-enabled --quiet sshd 2>/dev/null; then
    echo "System sshd: enabled (jack does not need it; left untouched)."
  else
    echo "System sshd: not enabled (good; jack does not use it)."
  fi
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
    zsh)  echo "${HOME}/.zshrc" ;;
    bash) echo "${HOME}/.bashrc" ;;
    fish) echo "${HOME}/.config/fish/conf.d/jack.fish" ;;
    *)    echo "${HOME}/.profile" ;;
  esac
}

# Returns non-zero when the shell must be restarted to pick up PATH.
configure_path() {
  if path_already_configured; then
    echo "PATH: ${INSTALL_DIR} already on PATH."
    return 0
  fi

  local rc_file line
  rc_file="$(shell_rc_file)"
  line="${PATH_LINE}"
  [[ "${rc_file}" == *.fish ]] && line="${FISH_PATH_LINE}"

  if [[ -f "${rc_file}" ]] && grep -qF "${PATH_MARKER}" "${rc_file}"; then
    echo "PATH: already configured in ${rc_file} (restart shell to apply)."
    return 1
  fi

  mkdir -p "$(dirname "${rc_file}")"
  {
    echo ""
    echo "${PATH_MARKER}"
    echo "${line}"
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
    grep -vF -e "${PATH_MARKER}" -e "${PATH_LINE}" -e "${FISH_PATH_LINE}" "${rc_file}" > "${tmp}" || true
    mv "${tmp}" "${rc_file}"
    echo "Removed PATH entry from ${rc_file}"
  fi

  echo "jack has been uninstalled."
  echo "Tailscale and SSH configuration were left untouched."
}

main() {
  if [[ "${1:-}" == "--uninstall" ]]; then
    uninstall
    exit 0
  fi

  require_linux
  require_pacman
  require_ssh_client

  setup_tailscale

  local tailscale_ready=0
  setup_tailscale_ssh || tailscale_ready=1

  report_sshd
  install_jack

  local path_needs_reload=0
  configure_path || path_needs_reload=1

  echo
  "${JACK_SRC}" --status || true
  echo

  if [[ "${tailscale_ready}" -ne 0 ]]; then
    if tailscale_backend_running; then
      echo "Next: enable Tailscale SSH from a local terminal:"
      echo "  sudo tailscale set --ssh"
    else
      echo "Next: authenticate Tailscale (opens a login URL):"
      echo "  sudo tailscale up --ssh"
    fi
  elif [[ "${path_needs_reload}" -eq 1 ]]; then
    echo "Next: restart your shell, then run: jack mac"
  else
    echo "Next: jack mac"
  fi
}

main "$@"
