#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2329
# Read-only contributor validation for jack. Works on macOS (Bash 3.2) and Linux.
# Never installs, uses sudo, touches the network, or runs a real ssh/tailscale.
# Every jack run is isolated: temporary HOME, minimal PATH of stubs, env -i.
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
  mkdir "${T}/home" "${T}/expected-home" "${T}/bin-route" "${T}/bin-notail" "${T}/bin-tail" "${T}/bin-linux" "${T}/bin-darwin" "${T}/bin-nopacman"
  : > "${T}/calls.log"
  : > "${T}/ts.log"
  : > "${T}/ssh.log"

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
  ping) exit "${TS_PING_RC:-1}" ;;
esac
exit 99'

  link_tool "${T}/bin-route" cat || return 1
  link_tool "${T}/bin-route" grep || return 1
  ln -s "${T}/bin-tail/tailscale" "${T}/bin-route/tailscale"
  write_stub "${T}/bin-route/ssh" 'printf "%s\n" "$#" "$@" >> "${SSH_LOG}"; exit 0'

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
TS_PING_RC=1

run_iso() { # pathdir command args...
  local p="$1"
  shift
  env -i HOME="${T}/home" PATH="${p}" TERM=dumb STUB_LOG="${T}/calls.log" \
    LC_ALL=C SSH_LOG="${T}/ssh.log" TS_PING_RC="${TS_PING_RC}" \
    TS_LOG="${T}/ts.log" TS_STATE="${TS_STATE}" FAKE_OS="${FAKE_OS}" "${BASH}" "$@"
}

untouched() { # tripwires silent, fake HOME matches the fixture
  local ok=0
  if [[ -s "${T}/calls.log" ]]; then fail "stubbed command was invoked: $(tr '\n' ';' < "${T}/calls.log")"; ok=1; fi
  if ! diff -r "${T}/expected-home" "${T}/home" >/dev/null; then fail "HOME was modified"; ok=1; fi
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
  set_config "${VALID_CONFIG}"

  # Tailscale absent.
  out="$(run_iso "${T}/bin-notail" "${JACK}" --status 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "Tailscale: not installed" || ! contains "${out}" "unknown"; then
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
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "Tailscale: connected" || ! contains "${out}" "unreachable"; then
    fail "--status with running stub Tailscale unexpected (rc=${rc})"; ok=1
  fi
  TS_STATE=Stopped
  untouched || ok=1
  clear_config

  untouched || ok=1
  return "${ok}"
}

# All identities below are synthetic fixtures, not real devices.
VALID_CONFIG='WORKSTATION_USER=alex
WORKSTATION_HOST=100.101.102.103
MAC_USER=alex
MAC_HOST=mac.example.ts.net'

set_config() {
  local d
  for d in home expected-home; do
    mkdir -p "${T}/${d}/.config/jack"
    printf '%s\n' "$1" > "${T}/${d}/.config/jack/config"
  done
}

clear_config() {
  local d
  for d in home expected-home; do
    rm -f "${T}/${d}/.config/jack/config"
    rmdir "${T}/${d}/.config/jack" "${T}/${d}/.config" 2>/dev/null || true
  done
}

expect_rejection() { # label, config text, expected diagnostic
  local label="$1" text="$2" diagnostic="$3" arg out rc ok=0
  set_config "${text}"
  for arg in connect mac --status; do
    : > "${T}/ssh.log"
    : > "${T}/ts.log"
    rc=0
    if [[ "${arg}" == connect ]]; then
      out="$(run_iso "${T}/bin-route" "${JACK}" 2>&1)" || rc=$?
    else
      out="$(run_iso "${T}/bin-route" "${JACK}" "${arg}" 2>&1)" || rc=$?
    fi
    if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "${diagnostic}"; then
      fail "${label}: ${arg} did not reject configuration (rc=${rc})"; ok=1
    fi
    if [[ -s "${T}/ssh.log" || -s "${T}/ts.log" ]]; then
      fail "${label}: network stub invoked for invalid configuration"; ok=1
    fi
    untouched || ok=1
  done
  clear_config
  return "${ok}"
}

check_config_errors() {
  local out rc arg value ok=0
  clear_config
  : > "${T}/ssh.log"
  : > "${T}/ts.log"
  for arg in connect mac --status; do
    rc=0
    if [[ "${arg}" == connect ]]; then
      out="$(run_iso "${T}/bin-route" "${JACK}" 2>&1)" || rc=$?
    else
      out="$(run_iso "${T}/bin-route" "${JACK}" "${arg}" 2>&1)" || rc=$?
    fi
    if [[ "${rc}" -eq 0 ]] || ! contains "${out}" "${T}/home/.config/jack/config"; then
      fail "missing config not explained for ${arg}"; ok=1
    fi
  done
  if [[ -s "${T}/ssh.log" || -s "${T}/ts.log" ]]; then fail 'missing config invoked network stub'; ok=1; fi
  expect_rejection empty 'MAC_USER=' 'invalid MAC_USER' || ok=1
  expect_rejection empty-host 'MAC_HOST=' 'invalid MAC_HOST' || ok=1
  expect_rejection malformed 'not an assignment' 'malformed line' || ok=1
  expect_rejection duplicate $'MAC_USER=alex\nMAC_USER=alex' 'duplicate MAC_USER' || ok=1
  expect_rejection unsupported 'OTHER=alex' 'unsupported key' || ok=1
  for value in '-oProxyCommand=id' 'a b' 'alex@host' 'a;id' '$(printf hacked > "$HOME/executed")' '`printf hacked > "$HOME/executed"`' '"alex"' $'alex\r' $'al\tex'; do
    expect_rejection username "MAC_USER=${value}" 'invalid MAC_USER' || ok=1
  done
  for value in '' '-host' 'a b' 'host;id' 'a@b' 'host:22' 'a/b' 'a..b' 'a.-b' 'a.b-' 'a.' '999.1.2.3' '1.2.3' '01.2.3.4' '1.2.3.4.5' '$(printf hacked > "$HOME/executed")' $'host\r'; do
    expect_rejection hostname "MAC_HOST=${value}" 'invalid MAC_HOST' || ok=1
  done
  # read -r must preserve backslashes; NUL bytes must not disappear silently.
  expect_rejection backslash 'MAC_USER=al\ex' 'invalid MAC_USER' || ok=1
  set_config ''
  printf 'MAC_USER=al\0ex\n' > "${T}/home/.config/jack/config"
  cp "${T}/home/.config/jack/config" "${T}/expected-home/.config/jack/config"
  rc=0
  out="$(run_iso "${T}/bin-route" "${JACK}" mac 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'NUL byte'; then fail 'NUL accepted'; ok=1; fi
  untouched || ok=1
  clear_config
  return "${ok}"
}

check_config_routing() {
  local out rc ok=0
  TS_STATE=Running
  TS_PING_RC=0
  # IPv4, DNS, and a final line without newline.
  set_config "${VALID_CONFIG}"
  printf '%s' "${VALID_CONFIG}" > "${T}/home/.config/jack/config"
  cp "${T}/home/.config/jack/config" "${T}/expected-home/.config/jack/config"
  : > "${T}/ssh.log"
  run_iso "${T}/bin-route" "${JACK}" || ok=1
  if [[ "$(cat "${T}/ssh.log")" != $'1\nalex@100.101.102.103' ]]; then fail 'workstation routing'; ok=1; fi
  : > "${T}/ssh.log"
  run_iso "${T}/bin-route" "${JACK}" mac || ok=1
  if [[ "$(cat "${T}/ssh.log")" != $'1\nalex@mac.example.ts.net' ]]; then fail 'Mac routing'; ok=1; fi
  untouched || ok=1
  set_config "# comment

${VALID_CONFIG}"
  rc=0
  out="$(run_iso "${T}/bin-route" "${JACK}" --status 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" '— reachable' || ! contains "${out}" 'authentication not tested'; then fail 'reachable status'; ok=1; fi
  TS_PING_RC=1
  : > "${T}/ssh.log"
  rc=0
  out="$(run_iso "${T}/bin-route" "${JACK}" mac 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 || -s "${T}/ssh.log" ]]; then fail 'unreachable Mac connected'; ok=1; fi
  TS_PING_RC=0
  # A missing or incomplete pair must not prevent access to the other device.
  set_config $'MAC_USER=alex\nMAC_HOST=mac.example.ts.net\nWORKSTATION_USER=alex'
  : > "${T}/ssh.log"
  run_iso "${T}/bin-route" "${JACK}" mac || ok=1
  rc=0
  out="$(run_iso "${T}/bin-route" "${JACK}" 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'Workstation unconfigured'; then fail 'missing workstation'; ok=1; fi
  set_config $'WORKSTATION_USER=alex\nWORKSTATION_HOST=workstation'
  run_iso "${T}/bin-route" "${JACK}" || ok=1
  rc=0
  out="$(run_iso "${T}/bin-route" "${JACK}" mac 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'Mac unconfigured'; then fail 'missing Mac'; ok=1; fi
  rc=0
  out="$(run_iso "${T}/bin-route" "${JACK}" --status 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'Mac: unconfigured'; then fail 'partial status'; ok=1; fi
  untouched || ok=1
  clear_config
  TS_STATE=Stopped
  TS_PING_RC=1
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
run_check CONFIG_ERRORS check_config_errors
run_check CONFIG_ROUTING check_config_routing
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
