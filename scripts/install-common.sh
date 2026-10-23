#!/usr/bin/env bash
# Shared user-level installer operations. Sourced only by the checkout scripts.
# Never installs packages, invokes sudo, changes services/SSH, or edits profiles.

installer_consent() {
  local answer
  printf '%s Type yes: ' "$1"
  IFS= read -r answer || return 1
  [[ "${answer}" == yes ]]
}

installer_paths_safe() {
  local path writable
  for path in "${HOME}" "${HOME}/.local" "${INSTALL_DIR}"; do
    if [[ -L "${path}" || ( -e "${path}" && ( ! -d "${path}" || ! -O "${path}" ) ) ]]; then
      echo 'jack: unsafe installation directory; inspect ownership/symlinks.' >&2; return 1
    fi
    if [[ -d "${path}" ]]; then
      writable="$(find "${path}" -prune \( -perm -002 -o -perm -020 \) -print)" || return 1
      [[ -z "${writable}" ]] || { echo 'jack: installation directories must not be group/other writable.' >&2; return 1; }
    fi
  done
}

installer_main() {
  local action="${1:-}"
  [[ $# -le 1 ]] || { echo 'jack: too many installer arguments' >&2; return 1; }
  case "${action}" in
    --help)
      echo 'Usage: setup script [--uninstall|--help]'
      echo 'Creates/removes only the ~/.local/bin/jack link for this checkout symlink, with consent.'
      echo 'No packages, services, SSH policies, shell profiles, or user config are changed.'
      return 0 ;;
    ''|--uninstall) ;;
    *) echo 'jack: unknown installer argument' >&2; return 1 ;;
  esac
  require_platform || return 1
  echo 'Required for connections: Bash, OpenSSH client, and connected Tailscale.'
  echo 'Git is needed for this checkout. Python 3 discovery is optional; Homebrew is not required.'
  echo 'This installer only manages the user-level JACK symlink after confirmation.'
  echo 'Install/connect Tailscale and configure any receiving SSH service separately.'
  echo 'No packages, services, SSH policies, keys, or shell profiles will be changed.'
  installer_paths_safe || return 1
  printf 'Source CLI: %s\nInstallation link: %s\n' "${JACK_SRC}" "${INSTALL_PATH}"
  if [[ "${action}" == --uninstall ]]; then
    if [[ -L "${INSTALL_PATH}" && "$(readlink "${INSTALL_PATH}")" == "${JACK_SRC}" ]]; then
      installer_consent 'Remove the JACK symlink for this checkout?' || { echo 'Cancelled; nothing changed.'; return 1; }
      installer_paths_safe || return 1
      [[ -L "${INSTALL_PATH}" && "$(readlink "${INSTALL_PATH}")" == "${JACK_SRC}" ]] || { echo 'jack: link changed; inspect before retrying.' >&2; return 1; }
      rm -f "${INSTALL_PATH}" || { echo 'jack: link removal failed; inspect the installation path before retrying. No other cleanup attempted.' >&2; return 1; }
      echo 'Removed the JACK symlink for this checkout.'
    elif [[ -e "${INSTALL_PATH}" || -L "${INSTALL_PATH}" ]]; then
      echo 'jack: refusing to remove a user-managed file or unrelated link.' >&2; return 1
    else
      echo 'No symlink from this checkout is installed.'
    fi
    echo 'Configuration, keys, packages, and profiles are untouched.'
    echo 'If an older installer added a PATH entry, inspect/remove that entry manually.'
    return 0
  fi
  [[ -f "${JACK_SRC}" && -x "${JACK_SRC}" ]] || { echo 'jack: checkout CLI missing or not executable; restore its tracked executable bit.' >&2; return 1; }
  if [[ -L "${INSTALL_PATH}" && "$(readlink "${INSTALL_PATH}")" == "${JACK_SRC}" ]]; then
    echo 'JACK already linked to this checkout; nothing changed.'
  elif [[ -e "${INSTALL_PATH}" || -L "${INSTALL_PATH}" ]]; then
    echo 'jack: refusing to overwrite ~/.local/bin/jack; inspect the existing file/link.' >&2; return 1
  else
    installer_consent 'Create the JACK symlink in ~/.local/bin?' || { echo 'Cancelled; nothing changed.'; return 1; }
    (umask 077; mkdir -p "${INSTALL_DIR}") || { echo 'jack: directory creation failed; inspect any partial directories. No cleanup attempted.' >&2; return 1; }
    installer_paths_safe || return 1
    if [[ -e "${INSTALL_PATH}" || -L "${INSTALL_PATH}" ]]; then
      echo 'jack: refusing installation; destination became occupied during consent. Inspect it before retrying.' >&2
      return 1
    fi
    # Both wrappers name the source jack. Anchor ln to the verified parent so
    # it constructs ./jack once, never treats an occupied jack as a container.
    # No force/replace options: even a leaf appearing after the check must fail.
    (cd -P -- "${INSTALL_DIR}" && ln -s "${JACK_SRC}" .) || { echo 'jack: link creation failed; inspect the destination. Created directories may remain; no cleanup attempted.' >&2; return 1; }
    echo 'JACK linked to this checkout. Keep the checkout in place.'
  fi
  echo 'Next: ~/.local/bin/jack doctor, jack setup, jack --status, then jack or jack mac.'
  echo 'If jack is not on PATH, use ~/.local/bin/jack and add ~/.local/bin to PATH manually (README).'
}
