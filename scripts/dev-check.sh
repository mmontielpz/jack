#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2329
# Read-only contributor validation for jack. Works on macOS (Bash 3.2) and Linux.
# Never installs, uses sudo, touches the network, or runs a real ssh/tailscale.
# Every jack run is isolated: empty HOME, minimal PATH of stubs, env -i.
# No `set -e`: all checks run, and any failure makes the exit status non-zero.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
JACK="${ROOT}/bin/jack"

T=""
cleanup() {
  if [[ -n "${T}" && -d "${T}" && "${T}" == *jack-dev-check.* ]]; then
    rm -rf "${T}"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() { echo "  ! $*"; }

contains() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }

source_files() {
  local f
  for f in "${ROOT}"/bin/* "${ROOT}"/scripts/*.sh; do
    [[ -f "${f}" ]] && echo "${f}"
  done
}

# --- fixtures ---------------------------------------------------------------

link_tool() { # dir name
  local src
  src="$(command -v "$2")" || { fail "required tool not found: $2"; return 1; }
  ln -s "${src}" "$1/$2"
}

write_stub() { # path, body
  printf '#!/bin/sh\n%s\n' "$2" > "$1"
  chmod +x "$1"
}

TRIPWIRE='printf "%s\n" "${0##*/} $*" >> "${STUB_LOG:-/dev/null}"; exit 99'

make_fixtures() {
  T="$(mktemp -d "${TMPDIR:-/tmp}/jack-dev-check.XXXXXX")" || return 1
  mkdir "${T}/home" "${T}/bin-notail" "${T}/bin-tail" "${T}/bin-linux" "${T}/bin-darwin" "${T}/bin-nopacman"
  : > "${T}/calls.log"
  : > "${T}/ts.log"

  local d n
  for d in bin-notail bin-tail; do
    link_tool "${T}/${d}" cat || return 1
    link_tool "${T}/${d}" grep || return 1
    write_stub "${T}/${d}/ssh" "${TRIPWIRE}"
  done
  write_stub "${T}/bin-tail/tailscale" \
'printf "%s\n" "$*" >> "${TS_LOG:-/dev/null}"
case "$1" in
  status) printf "{\"BackendState\": \"%s\"}\n" "${TS_STATE:-Stopped}"; exit 0 ;;
  ping) exit 1 ;;
esac
exit 99'

  # Installer fixtures: fake OS name, tripwires for anything that would mutate.
  for d in bin-linux bin-darwin bin-nopacman; do
    link_tool "${T}/${d}" dirname || return 1
    write_stub "${T}/${d}/uname" 'printf "%s\n" "${FAKE_OS:-Linux}"'
    for n in sudo brew systemctl launchctl tailscale ssh; do
      write_stub "${T}/${d}/${n}" "${TRIPWIRE}"
    done
  done
  write_stub "${T}/bin-linux/pacman" "${TRIPWIRE}"
  write_stub "${T}/bin-darwin/pacman" "${TRIPWIRE}"
}

FAKE_OS=Linux
TS_STATE=Stopped

run_iso() { # pathdir command args...
  local p="$1"
  shift
  env -i HOME="${T}/home" PATH="${p}" TERM=dumb STUB_LOG="${T}/calls.log" \
    TS_LOG="${T}/ts.log" TS_STATE="${TS_STATE}" FAKE_OS="${FAKE_OS}" "${BASH}" "$@"
}

untouched() { # nothing real was invoked, fake HOME still empty
  local ok=0
  if [[ -s "${T}/calls.log" ]]; then fail "stubbed command was invoked: $(tr '\n' ';' < "${T}/calls.log")"; ok=1; fi
  if [[ -n "$(ls -A "${T}/home")" ]]; then fail "HOME was modified"; ok=1; fi
  return "${ok}"
}

# --- checks -----------------------------------------------------------------

check_syntax() {
  local f ok=0
  for f in $(source_files); do
    "${BASH}" -n "${f}" 2>&1 || { fail "syntax error: ${f}"; ok=1; }
  done
  return "${ok}"
}

check_executables() {
  local f ok=0
  for f in $(source_files); do
    [[ -x "${f}" ]] || { fail "not executable: ${f}"; ok=1; }
  done
  return "${ok}"
}

check_help() {
  local out rc=0
  out="$(run_iso "${T}/bin-notail" "${JACK}" --help 2>&1)" || rc=$?
  [[ "${rc}" -eq 0 ]] || { fail "--help exited ${rc}"; return 1; }
  contains "${out}" "Usage:" || { fail "--help output lacks 'Usage:'"; return 1; }
  untouched
}

check_unknown_argument() {
  local out rc=0 ok=0
  out="$(run_iso "${T}/bin-notail" "${JACK}" bogus 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "unknown argument"; then fail "'bogus' not rejected (rc=${rc})"; ok=1; fi
  rc=0
  out="$(run_iso "${T}/bin-notail" "${JACK}" mac extra 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "too many arguments"; then fail "'mac extra' not rejected (rc=${rc})"; ok=1; fi
  untouched || ok=1
  return "${ok}"
}

check_offline_status() {
  local out rc=0 ok=0

  # Tailscale absent.
  out="$(run_iso "${T}/bin-notail" "${JACK}" --status 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "Tailscale: not installed" || ! contains "${out}" "Not ready."; then
    fail "--status without Tailscale unexpected (rc=${rc})"; ok=1
  fi
  rc=0
  out="$(run_iso "${T}/bin-notail" "${JACK}" mac 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "Tailscale is not installed"; then
    fail "'jack mac' without Tailscale unexpected (rc=${rc})"; ok=1
  fi

  # Tailscale installed but stopped (stub): must not ping.
  : > "${T}/ts.log"
  TS_STATE=Stopped
  rc=0
  out="$(run_iso "${T}/bin-tail" "${JACK}" --status 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "Tailscale: not connected"; then
    fail "--status with stopped Tailscale unexpected (rc=${rc})"; ok=1
  fi
  if grep -q '^ping' "${T}/ts.log"; then fail "stopped Tailscale was pinged"; ok=1; fi

  # Tailscale running (stub), peers unreachable: still offline and deterministic.
  TS_STATE=Running
  rc=0
  out="$(run_iso "${T}/bin-tail" "${JACK}" --status 2>&1)" || rc=$?
  if ! contains "${out}" "Tailscale: connected" || ! contains "${out}" "not reachable"; then
    fail "--status with running stub Tailscale unexpected (rc=${rc})"; ok=1
  fi
  TS_STATE=Stopped

  untouched || ok=1
  return "${ok}"
}

installer_refuses() { # label pathdir os script expected-text
  local out rc=0
  FAKE_OS="$3"
  out="$(run_iso "$2" "${ROOT}/scripts/$4" 2>&1)" || rc=$?
  FAKE_OS=Linux
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "$5"; then
    fail "$1: expected refusal containing '$5' (rc=${rc})"
    return 1
  fi
  untouched
}

# The installers are only ever run against stubbed uname/PATH, so they cannot
# reach their install paths on any host (Linux or macOS).
check_installer_refusal() {
  local ok=0
  installer_refuses "setup-macos on non-macOS" "${T}/bin-linux" Linux setup-macos.sh "only supports macOS" || ok=1
  installer_refuses "setup-workstation on non-Linux" "${T}/bin-darwin" Darwin setup-workstation.sh "only supports Linux" || ok=1
  installer_refuses "setup-workstation without pacman" "${T}/bin-nopacman" Linux setup-workstation.sh "Arch-based" || ok=1
  return "${ok}"
}

# --- run --------------------------------------------------------------------

OVERALL=0
run_check() { # NAME function
  if "$2"; then
    echo "$1=PASS"
  else
    echo "$1=FAIL"
    OVERALL=1
  fi
}

if ! make_fixtures; then
  echo "RESULT=FAIL (could not create fixtures)"
  exit 1
fi

run_check BASH_SYNTAX check_syntax
run_check EXECUTABLES check_executables
run_check CLI_HELP check_help
run_check UNKNOWN_ARGUMENT check_unknown_argument
run_check OFFLINE_STATUS check_offline_status
run_check INSTALLER_REFUSAL check_installer_refusal

if command -v shellcheck >/dev/null 2>&1; then
  # shellcheck disable=SC2046
  sc_count="$(shellcheck -x $(source_files) 2>/dev/null | grep -c '^In ' || true)"
  echo "SHELLCHECK=INFO (${sc_count} finding(s), non-blocking)"
else
  echo "SHELLCHECK=SKIP (shellcheck not installed)"
fi

if [[ "${OVERALL}" -eq 0 ]]; then
  echo "RESULT=PASS"
else
  echo "RESULT=FAIL"
fi
exit "${OVERALL}"
