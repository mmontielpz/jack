#!/usr/bin/env bash
# ShellCheck 0.9 cannot follow run_check dispatch or EXIT traps (SC2317).
# shellcheck disable=SC2016,SC2317,SC2329
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
  mkdir "${T}/home" "${T}/expected-home" "${T}/bin-setup" "${T}/bin-discovery" "${T}/bin-doctor" "${T}/bin-install" "${T}/bin-route" "${T}/bin-notail" "${T}/bin-tail" "${T}/bin-linux" "${T}/bin-darwin" "${T}/bin-nopacman"
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

  for n in cat grep mkdir chmod find mktemp mv rm rmdir; do
    link_tool "${T}/bin-setup" "${n}" || return 1
  done
  for n in ssh sudo brew pacman systemctl launchctl; do
    write_stub "${T}/bin-setup/${n}" "${TRIPWIRE}"
  done
  write_stub "${T}/bin-setup/tailscale" 'printf "%s\n" "$*" >> "${TS_LOG}"
if [ "$1" != status ]; then exit 99; fi
if [ -s "${DISCOVERY_OUTPUT}" ]; then cat "${DISCOVERY_OUTPUT}"; exit 0; fi
exit 1'

  for n in "${T}/bin-setup/"*; do
    ln -s "${n}" "${T}/bin-discovery/${n##*/}"
  done

  for d in bin-doctor bin-install; do
    for n in cat grep dirname find mkdir ln readlink rm; do link_tool "${T}/${d}" "${n}" || return 1; done
    for n in ssh sudo brew pacman systemctl launchctl; do write_stub "${T}/${d}/${n}" "${TRIPWIRE}"; done
    write_stub "${T}/${d}/uname" 'printf "%s\n" "${FAKE_OS}"'
  done
  ln -s "$(command -v cat)" "${T}/bin-doctor/cat-real"
  rm -f "${T}/bin-doctor/cat"
  write_stub "${T}/bin-doctor/cat" 'if [ "$1" = /etc/os-release ]; then printf "ID=%s\n" "${DOCTOR_DISTRO}"; else exec "${0%/*}/cat-real" "$@"; fi'
  rm -f "${T}/bin-install/cat"
  ln -s "$(command -v cat)" "${T}/bin-install/cat-real"
  write_stub "${T}/bin-install/cat" 'if [ "$1" = /etc/os-release ]; then printf "ID=%s\n" "${DOCTOR_DISTRO}"; else exec "${0%/*}/cat-real" "$@"; fi'
  write_stub "${T}/bin-doctor/tailscale" 'printf "%s\n" "$*" >> "${TS_LOG}"
if [ "$1" != status ]; then exit 99; fi
if [ "${DOCTOR_STATE}" = invalid ]; then printf "invalid status"; exit 0; fi
printf "{\"BackendState\":\"%s\"}\n" "${DOCTOR_STATE}"
[ "${DOCTOR_STATE}" = Running ] || [ "$2" = --json ]'
  if command -v python3 >/dev/null 2>&1; then
    link_tool "${T}/bin-doctor" python3 || return 1
  else
    echo 'DOCTOR_PARSER=STUB (optional Python absent; state parsing simulated)'
    # Deterministic state-parser contract when the optional real parser is absent.
    write_stub "${T}/bin-doctor/python3" 'case "$*" in *"import json, ipaddress"*) exit 0 ;; esac
case "${DOCTOR_STATE}" in invalid) exit 1 ;; *) printf "%s\n" "${DOCTOR_STATE}" ;; esac'
  fi

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
    DOCTOR_DISTRO="${DOCTOR_DISTRO:-arch}" DOCTOR_STATE="${DOCTOR_STATE:-Running}" DISCOVERY_OUTPUT="${T}/discovery-output" LC_ALL=C SSH_LOG="${T}/ssh.log" TS_PING_RC="${TS_PING_RC}" \
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

check_version() {
  local scenario out rc ok=0
  mkdir "${T}/bin-version"
  link_tool "${T}/bin-version" cat || return 1
  local tool
  for tool in git ssh tailscale sudo python3; do
    write_stub "${T}/bin-version/${tool}" "${TRIPWIRE}"
  done
  # Run a standalone copy as well as the checkout: no adjacent version file/Git.
  cp "${JACK}" "${T}/standalone-jack"
  for scenario in missing valid malformed; do
    case "${scenario}" in
      missing) clear_config ;;
      valid) set_config "${VALID_CONFIG}" ;;
      malformed) set_config 'MAC_USER=$(printf injected > "$HOME/version-executed")' ;;
    esac
    rc=0
    out="$(run_iso "${T}/bin-version" "${T}/standalone-jack" --version 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 || "${out}" != 'jack 0.1.0' ]]; then
      fail "--version ${scenario}: unexpected result (rc=${rc})"; ok=1
    fi
    untouched || ok=1
  done
  # Even an absent HOME and empty PATH need no fallback, files or commands.
  rc=0
  out="$(env -i PATH= "${BASH}" "${JACK}" --version 2>&1)" || rc=$?
  [[ "${rc}" -eq 0 && "${out}" == 'jack 0.1.0' ]] || { fail '--version requires environment/tools'; ok=1; }
  rc=0
  out="$(run_iso "${T}/bin-version" "${JACK}" --version extra 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'too many arguments'; then
    fail '--version accepted extra arguments'; ok=1
  fi
  rc=0
  out="$(run_iso "${T}/bin-version" "${JACK}" --help 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'jack --version'; then
    fail 'help lacks version guidance'; ok=1
  fi
  untouched || ok=1
  rm -f "${T}/standalone-jack"
  setup_reset
  return "${ok}"
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

# Setup tests use the same isolated HOME and real native file operations only.
setup_run() {
  run_iso "${T}/bin-setup" "${JACK}" setup "$@"
}

setup_reset() {
  # Only fixtures inside the mktemp directory are removed.
  rm -rf "${T}/home/.config" "${T}/expected-home/.config"
  : > "${T}/calls.log"
  : > "${T}/ts.log"
  : > "${T}/ssh.log"
  : > "${T}/discovery-output"
}

setup_expect_fail() {
  local out rc=0
  out="$(setup_run "$@" < /dev/null 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]]; then fail "setup unexpectedly accepted: $*"; return 1; fi
  untouched
}

check_setup_interactive() {
  local out rc choice set_expected ok=0
  for choice in workstation mac both; do
    setup_reset
    case "${choice}" in
      workstation) printf 'workstation\nworkstation.example.ts.net\nalex\nyes\n' > "${T}/answers" ;;
      mac) printf 'mac\n100.104.105.106\nalex\nyes\n' > "${T}/answers" ;;
      both) printf 'both\nworkstation.example.ts.net\nalex\n100.104.105.106\nalex\nyes\n' > "${T}/answers" ;;
    esac
    rc=0
    out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'Configuration saved'; then fail "interactive ${choice}: ${out}"; ok=1; fi
    case "${choice}" in
      workstation) set_expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=workstation.example.ts.net' ;;
      mac) set_expected=$'MAC_USER=alex\nMAC_HOST=100.104.105.106' ;;
      both) set_expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=workstation.example.ts.net\nMAC_USER=alex\nMAC_HOST=100.104.105.106' ;;
    esac
    mkdir -p "${T}/expected-home/.config/jack"
    printf '%s\n' "${set_expected}" > "${T}/expected-home/.config/jack/config"
    untouched || ok=1
    [[ ! -s "${T}/ts.log" ]] || { fail 'parser-absent setup invoked discovery'; ok=1; }
    # Portable find permission predicates: exact private modes.
    [[ -n "$(find "${T}/home/.config/jack/config" -perm 600 -print)" ]] || { fail 'config permissions'; ok=1; }
    [[ -n "$(find "${T}/home/.config/jack" -prune -perm 700 -print)" ]] || { fail 'directory permissions'; ok=1; }
  done
  setup_reset
  return "${ok}"
}

check_setup_automation() {
  local out ok=0
  setup_reset
  out="$(setup_run --help 2>&1)" || ok=1
  contains "${out}" '--non-interactive' || ok=1
  setup_expect_fail --non-interactive || ok=1
  setup_expect_fail --non-interactive --yes || ok=1
  setup_expect_fail --non-interactive --yes --mac-user alex || ok=1
  setup_expect_fail --non-interactive --yes --mac-user alex --mac-host || ok=1
  setup_expect_fail --non-interactive --yes --mac-user alex --mac-host mac --mac-host other || ok=1
  setup_expect_fail --yes || ok=1
  setup_expect_fail --mac-user alex --mac-host mac || ok=1
  setup_expect_fail --help --yes || ok=1
  setup_expect_fail --non-interactive --yes --mac-user '-oProxyCommand=id' --mac-host mac || ok=1
  setup_expect_fail --non-interactive --yes --mac-user alex --mac-host '$(printf hacked > "$HOME/executed")' || ok=1
  setup_expect_fail --non-interactive --yes --mac-user '' --mac-host '' --workstation-user alex --workstation-host workstation || ok=1
  set_config "${VALID_CONFIG}"
  out="$(setup_run --non-interactive --yes --mac-user sam --mac-host new-mac.example.ts.net 2>&1)" || { fail "automation: ${out}"; ok=1; }
  printf '%s\n' $'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=new-mac.example.ts.net' > "${T}/expected-home/.config/jack/config"
  untouched || ok=1
  [[ ! -s "${T}/ts.log" && ! -s "${T}/ssh.log" ]] || { fail 'automation contacted device/network'; ok=1; }
  # Replacing just workstation preserves the newly configured Mac.
  setup_run --non-interactive --yes --workstation-user sam --workstation-host new-workstation > /dev/null || ok=1
  printf '%s\n' $'WORKSTATION_USER=sam\nWORKSTATION_HOST=new-workstation\nMAC_USER=sam\nMAC_HOST=new-mac.example.ts.net' > "${T}/expected-home/.config/jack/config"
  untouched || ok=1
  setup_reset
  return "${ok}"
}

check_setup_cancel_and_write_failure() {
  local out rc response ok=0
  setup_reset
  set_config "${VALID_CONFIG}"
  for response in no ''; do
    printf 'mac\nnew-mac\nsam\n%s\n' "${response}" > "${T}/answers"
    rc=0
    out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'cancellation accepted'; ok=1; }
    untouched || ok=1
  done
  printf 'mac\nnew-mac\nsam\n' > "${T}/answers" # EOF at confirmation.
  rc=0
  out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
  [[ "${rc}" -ne 0 ]] || { fail 'EOF accepted'; ok=1; }
  untouched || ok=1
  # Inject native-operation failure without depending on privilege/host permissions.
  mv "${T}/bin-setup/mv" "${T}/mv-tool"
  write_stub "${T}/bin-setup/mv" 'exit 1'
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  rm -f "${T}/bin-setup/mv"
  mv "${T}/mv-tool" "${T}/bin-setup/mv"
  mv "${T}/bin-setup/mktemp" "${T}/mktemp-tool"
  write_stub "${T}/bin-setup/mktemp" 'exit 1'
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  rm -f "${T}/bin-setup/mktemp"
  mv "${T}/mktemp-tool" "${T}/bin-setup/mktemp"
  # A pre-existing lock must be retained and must not permit overwrite.
  mkdir "${T}/home/.config/jack/.setup-lock" "${T}/expected-home/.config/jack/.setup-lock"
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  rmdir "${T}/home/.config/jack/.setup-lock" "${T}/expected-home/.config/jack/.setup-lock"
  # Simulate an independent edit after load but before save.
  write_stub "${T}/bin-setup/python3" 'exit 1'
  mv "${T}/bin-setup/tailscale" "${T}/tailscale-tool"
  write_stub "${T}/bin-setup/tailscale" 'printf "# independent edit\n" >> "$HOME/.config/jack/config"; exit 1'
  printf 'mac\nnew-mac\nsam\nyes\n' > "${T}/answers"
  rc=0
  out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'changed during setup'; then fail 'concurrent edit overwritten'; ok=1; fi
  printf '# independent edit\n' >> "${T}/expected-home/.config/jack/config"
  untouched || ok=1
  rm -f "${T}/bin-setup/tailscale"
  mv "${T}/tailscale-tool" "${T}/bin-setup/tailscale"
  rm -f "${T}/bin-setup/python3"
  chmod 777 "${T}/home/.config"
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  chmod 700 "${T}/home/.config"
  # Invalid existing config must not be discarded.
  set_config 'UNSUPPORTED=value'
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  setup_reset
  # Refuse symlinks to files and parent directories without modifying their targets.
  mkdir -p "${T}/home/.config/jack" "${T}/expected-home/.config/jack"
  printf 'unrelated\n' > "${T}/unrelated"
  ln -s "${T}/unrelated" "${T}/home/.config/jack/config"
  ln -s "${T}/unrelated" "${T}/expected-home/.config/jack/config"
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  [[ "$(cat "${T}/unrelated")" == unrelated ]] || { fail 'symlink target changed'; ok=1; }
  setup_reset
  mkdir "${T}/unrelated-dir"
  ln -s "${T}/unrelated-dir" "${T}/home/.config"
  ln -s "${T}/unrelated-dir" "${T}/expected-home/.config"
  setup_expect_fail --non-interactive --yes --mac-user sam --mac-host new-mac || ok=1
  [[ -z "$(ls -A "${T}/unrelated-dir")" ]] || { fail 'symlink parent followed'; ok=1; }
  setup_reset
  return "${ok}"
}

check_setup_discovery_fallback() {
  local fixture out rc ok=0
  # JSON is deliberately neither parsed nor displayed in dependency-free mode.
  # Test valid, empty, malformed, and malicious responses as untrusted bytes.
  for fixture in '{"BackendState":"Running","Peer":{"p":{"DNSName":"peer.example.ts.net","TailscaleIPs":["100.101.102.103"]}}}' \
    '{"BackendState":"Running","Peer":{}}' 'not-json' \
    '{"Peer":{"p":{"DNSName":"$(printf hacked > \"$HOME/executed\")"}}}'; do
    setup_reset
    printf '%s\n' "${fixture}" > "${T}/discovery-output"
    printf 'mac\nmanual-mac\nalex\nyes\n' > "${T}/answers"
    rc=0
    out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'enter destinations manually'; then fail 'discovery fallback'; ok=1; fi
    mkdir -p "${T}/expected-home/.config/jack"
    printf '%s\n' $'MAC_USER=alex\nMAC_HOST=manual-mac' > "${T}/expected-home/.config/jack/config"
    untouched || ok=1
    if contains "${out}" 'hacked' || contains "${out}" 'not-json'; then fail 'untrusted output displayed'; ok=1; fi
    [[ ! -e "${T}/home/executed" ]] || { fail 'discovery executed'; ok=1; }
  done
  for fixture in disconnected unavailable; do
    setup_reset
    if [[ "${fixture}" == unavailable ]]; then mv "${T}/bin-setup/tailscale" "${T}/tailscale-tool"; fi
    printf 'mac\nmanual-mac\nalex\nyes\n' > "${T}/answers"
    rc=0
    out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
    if [[ "${fixture}" == unavailable ]]; then
      mv "${T}/tailscale-tool" "${T}/bin-setup/tailscale"
      contains "${out}" 'CLI unavailable' || ok=1
    else
      contains "${out}" 'parser unavailable' || ok=1
    fi
    [[ "${rc}" -eq 0 ]] || { fail 'offline manual setup'; ok=1; }
    mkdir -p "${T}/expected-home/.config/jack"
    printf '%s\n' $'MAC_USER=alex\nMAC_HOST=manual-mac' > "${T}/expected-home/.config/jack/config"
    untouched || ok=1
  done
  setup_reset
  write_stub "${T}/bin-setup/python3" 'exit 1'
  printf '%s\n' '{"BackendState":"Running"}' > "${T}/discovery-output"
  printf 'mac\nmanual-mac\nalex\nyes\n' > "${T}/answers"
  rc=0
  out="$(setup_run < "${T}/answers" 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'Discovery unavailable'; then fail 'broken parser blocked manual setup'; ok=1; fi
  discovery_expected $'MAC_USER=alex\nMAC_HOST=manual-mac'
  untouched || ok=1
  rm -f "${T}/bin-setup/python3"
  setup_reset
  return "${ok}"
}

# Python is optional in production. When available, exercise the real isolated
# standard-library parser against only stubbed Tailscale output.
DISCOVERY_VALID='{
  "BackendState":"Running",
  "Self":{"ID":"local-id","PublicKey":"local-key","TailscaleIPs":["100.64.1.1"]},
  "Peer":{
    "z":{"ID":"remote-z","DNSName":"shared.example.ts.net.","TailscaleIPs":["fd7a::3","100.64.1.20"]},
    "a":{"ID":"remote-a","DNSName":"shared.example.ts.net.","TailscaleIPs":["100.64.1.3"]},
    "self-id":{"ID":"local-id","DNSName":"LOCAL-BY-ID","TailscaleIPs":["100.64.1.90"]},
    "local-key":{"DNSName":"LOCAL-BY-KEY","TailscaleIPs":["100.64.1.91"]},
    "self-ip":{"ID":"other-id","DNSName":"LOCAL-BY-IP","TailscaleIPs":["100.64.1.1"]}
  },
  "Unexpected":{"data":"ignored"}
}'

discovery_run() {
  run_iso "${T}/bin-discovery" "${JACK}" setup "$@"
}

discovery_expected() {
  mkdir -p "${T}/expected-home/.config/jack"
  printf '%s\n' "$1" > "${T}/expected-home/.config/jack/config"
}

check_discovery_selection() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo 'DISCOVERY_PARSER=SKIP (optional Python 3 unavailable; fallback only)'
    return 0
  fi
  link_tool "${T}/bin-discovery" python3 || return 1
  local out rc role ok=0
  for role in workstation mac both; do
    setup_reset
    printf '%s\n' "${DISCOVERY_VALID}" > "${T}/discovery-output"
    case "${role}" in
      workstation) printf 'workstation\na\n1\nalex\nyes\n' > "${T}/answers" ;;
      mac) printf 'mac\na\n2\nalex\nyes\n' > "${T}/answers" ;;
      both) printf 'both\na\n1\nalex\na\n2\nsam\nyes\n' > "${T}/answers" ;;
    esac
    rc=0
    out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 ]] || ! contains "${out}" '1) shared | Unknown | 100.64.1.3' || ! contains "${out}" '2) shared | Unknown | 100.64.1.20'; then
      fail "discovery selection ${role}: ${out}"; ok=1
    fi
    if contains "${out}" LOCAL-BY; then fail 'local device offered'; ok=1; fi
    case "${role}" in
      workstation) discovery_expected $'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.3' ;;
      mac) discovery_expected $'MAC_USER=alex\nMAC_HOST=100.64.1.20' ;;
      both) discovery_expected $'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.3\nMAC_USER=sam\nMAC_HOST=100.64.1.20' ;;
    esac
    untouched || ok=1
    [[ "$(cat "${T}/ts.log")" == 'status --json' ]] || { fail 'unexpected discovery command'; ok=1; }
    [[ -n "$(find "${T}/home/.config/jack/config" -perm 600 -print)" ]] || { fail 'discovery config permissions'; ok=1; }
    [[ -n "$(find "${T}/home/.config/jack" -prune -perm 700 -print)" ]] || { fail 'discovery directory permissions'; ok=1; }
  done
  # Manual entry remains explicit even with valid peers.
  setup_reset
  printf '%s\n' "${DISCOVERY_VALID}" > "${T}/discovery-output"
  printf 'mac\n0\nmanual-mac\nalex\nyes\n' > "${T}/answers"
  discovery_run < "${T}/answers" >/dev/null 2>&1 || { fail 'explicit manual entry'; ok=1; }
  discovery_expected $'MAC_USER=alex\nMAC_HOST=manual-mac'
  untouched || ok=1
  # Updating one role preserves the other and cancellation keeps exact bytes.
  set_config "${VALID_CONFIG}"
  printf 'mac\na\n2\nsam\nno\n' > "${T}/answers"
  rc=0
  out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
  [[ "${rc}" -ne 0 ]] || { fail 'discovery cancellation saved'; ok=1; }
  untouched || ok=1
  printf 'mac\na\n2\nsam\nyes\n' > "${T}/answers"
  discovery_run < "${T}/answers" >/dev/null 2>&1 || { fail 'preserved destination setup'; ok=1; }
  discovery_expected $'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.20'
  untouched || ok=1
  # Same peer for both roles requires its own consent before final confirmation.
  setup_reset
  printf '%s\n' "${DISCOVERY_VALID}" > "${T}/discovery-output"
  printf 'both\na\n1\nalex\na\n1\nsam\nno\n' > "${T}/answers"
  rc=0
  out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'duplicate destination not confirmed'; then fail 'duplicate destination accepted'; ok=1; fi
  untouched || ok=1
  printf 'both\na\n1\nalex\na\n1\nsam\nyes\nyes\n' > "${T}/answers"
  discovery_run < "${T}/answers" >/dev/null 2>&1 || { fail 'confirmed duplicate rejected'; ok=1; }
  discovery_expected $'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.3\nMAC_USER=sam\nMAC_HOST=100.64.1.3'
  untouched || ok=1
  # Automation ignores available discovery/parser and remains prompt-free.
  setup_reset
  printf '%s\n' "${DISCOVERY_VALID}" > "${T}/discovery-output"
  discovery_run --non-interactive --yes --workstation-user alex --workstation-host 100.64.1.3 --mac-user sam --mac-host 100.64.1.3 < /dev/null > /dev/null || { fail 'discovery affected automation'; ok=1; }
  discovery_expected $'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.3\nMAC_USER=sam\nMAC_HOST=100.64.1.3'
  untouched || ok=1
  [[ ! -s "${T}/ts.log" ]] || { fail 'automation called Tailscale'; ok=1; }
  setup_reset
  rm -f "${T}/bin-discovery/python3"
  return "${ok}"
}

check_discovery_untrusted() {
  if ! command -v python3 >/dev/null 2>&1; then return 0; fi
  link_tool "${T}/bin-discovery" python3 || return 1
  local out rc fixture choice ok=0
  for fixture in 'not-json' '{}' 'null' '[]' \
    '{"BackendState":"Stopped"}' \
    '{"BackendState":"Running","Self":{"TailscaleIPs":["100.64.1.1"]}}' \
    '{"BackendState":"Running","Self":null,"Peer":null}' \
    '{"BackendState":"Running","TailscaleIPs":["100.64.1.1"],"Peer":null}' \
    '{"BackendState":"Running","Self":{"TailscaleIPs":["100.64.1.1"]},"Peer":{"bad":null,"missing":{}}}' \
    '{"BackendState":"Running","TailscaleIPs":["100.64.1.1"],"Peer":[]}' \
    '{"BackendState":"Running","BackendState":"Stopped"}' \
    '{"BackendState":"Running","TailscaleIPs":["100.64.1.1"],"Peer":{"x":{"TailscaleIPs":["192.168.1.1","100.128.1.1","100.64.999.1","0100.64.1.2","-host","host;id","100.64.1.2:22"]}}}'; do
    setup_reset
    printf '%s\n' "${fixture}" > "${T}/discovery-output"
    printf 'mac\nmanual-mac\nalex\nyes\n' > "${T}/answers"
    rc=0
    out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'enter destinations manually'; then fail 'invalid/no peers blocked manual setup'; ok=1; fi
    discovery_expected $'MAC_USER=alex\nMAC_HOST=manual-mac'
    untouched || ok=1
  done
  setup_reset
  printf '%s\n' '{"BackendState":"Running","TailscaleIPs":["100.64.1.1"],"Self":null,"Peer":{
    "a":{"DNSName":"$(printf hacked > \"$HOME/executed\")\u001b[31m\n\t\u0007\u202e","TailscaleIPs":["100.64.1.2"]},
    "b":{"DNSName":null,"HostName":null,"TailscaleIPs":["100.64.1.4"]},
    "c":{"DNSName":"same-name","TailscaleIPs":["100.64.1.5","100.64.1.5"]},
    "d":{"DNSName":"other-name","TailscaleIPs":["100.64.1.5"]},
    "e":{"DNSName":{"unexpected":"object"},"TailscaleIPs":["100.64.1.6"]},
    "f":{"DNSName":"IPv6-only","TailscaleIPs":["fd7a::3"]}
  }}' > "${T}/discovery-output"
  printf 'mac\na\n1\nalex\nyes\n' > "${T}/answers"
  rc=0
  out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
  [[ "${rc}" -eq 0 ]] || { fail 'unusual names rejected usable peers'; ok=1; }
  if contains "${out}" $'\033' || contains "${out}" $'\a' || contains "${out}" '$(' || contains "${out}" 'IPv6-only'; then fail 'unsafe display or IPv6 destination'; ok=1; fi
  contains "${out}" '2) Unnamed peer | Unknown | 100.64.1.4' || { fail 'null name handling'; ok=1; }
  contains "${out}" '3) Multiple peers sharing address | Unknown | 100.64.1.5' || { fail 'duplicate address handling'; ok=1; }
  contains "${out}" '4) Unnamed peer | Unknown | 100.64.1.6' || { fail 'unexpected name handling'; ok=1; }
  discovery_expected $'MAC_USER=alex\nMAC_HOST=100.64.1.2'
  untouched || ok=1
  # Invalid/out-of-range choices never default to the first peer.
  for choice in '' 9999 '-1' '01' '$(id)'; do
    setup_reset
    printf '%s\n' "${DISCOVERY_VALID}" > "${T}/discovery-output"
    printf 'mac\n%s\n' "${choice}" > "${T}/answers"
    rc=0
    out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'invalid choice selected a peer'; ok=1; }
    untouched || ok=1
  done
  # Bounded input and failures of the Tailscale producer must fall back too.
  setup_reset
  printf '%1048577s' '' > "${T}/discovery-output"
  printf 'mac\nmanual-mac\nalex\nyes\n' > "${T}/answers"
  rc=0
  out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'enter destinations manually'; then fail 'oversized status fallback'; ok=1; fi
  discovery_expected $'MAC_USER=alex\nMAC_HOST=manual-mac'
  untouched || ok=1
  setup_reset
  printf '%s\n' "${DISCOVERY_VALID}" > "${T}/discovery-output"
  mv "${T}/bin-setup/tailscale" "${T}/tailscale-tool"
  write_stub "${T}/bin-setup/tailscale" 'cat "${DISCOVERY_OUTPUT}"; exit 1'
  printf 'mac\nmanual-mac\nalex\nyes\n' > "${T}/answers"
  rc=0
  out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'enter destinations manually'; then fail 'failed producer fallback'; ok=1; fi
  discovery_expected $'MAC_USER=alex\nMAC_HOST=manual-mac'
  untouched || ok=1
  rm -f "${T}/bin-setup/tailscale"
  mv "${T}/tailscale-tool" "${T}/bin-setup/tailscale"
  setup_reset
  rm -f "${T}/bin-discovery/python3"
  return "${ok}"
}

DEVICE_AWARE_FIXTURE='{
  "BackendState":"Running","Self":{"ID":"self","TailscaleIPs":["100.64.1.1"]},"Peer":{
    "win":{"HostName":"office-win","OS":"windows","TailscaleIPs":["100.64.1.4"],"Online":true},
    "legacy":{"DNSName":"legacy-mac.example.ts.net.","OS":"darwin","TailscaleIPs":["100.64.1.6"]},
    "linux":{"HostName":"vpn-gateway","DNSName":"long-tailnet-name.example.ts.net.","OS":"linux","TailscaleIPs":["100.64.1.2"],"Online":false},
    "unknown":{"HostName":"unknown-device","TailscaleIPs":["100.64.1.5"]},
    "mac":{"HostName":"macbook","OS":"macOS","TailscaleIPs":["100.64.1.3"]},
    "phone":{"HostName":"phone","OS":"android","TailscaleIPs":["100.64.1.7"]},
    "bad":{"HostName":"bad\u001b[31m\u0007\n$(id)","OS":"linux\u001b[31m$(id)","TailscaleIPs":["100.64.1.8"]},
    "duplicate-name":{"HostName":"vpn-gateway","OS":"linux","TailscaleIPs":["100.64.1.20"]},
    "duplicate-ip-linux":{"HostName":"ambiguous-linux","OS":"linux","TailscaleIPs":["100.64.1.9"]},
    "duplicate-ip-mac":{"HostName":"ambiguous-mac","OS":"macOS","TailscaleIPs":["100.64.1.9"]},
    "self":{"ID":"self","HostName":"LOCAL-DEVICE","OS":"macOS","TailscaleIPs":["100.64.1.1"]}
  }}'

check_device_aware() {
  link_tool "${T}/bin-discovery" python3 || return 1
  local scenario out rc expected ok=0
  for scenario in workstation mac legacy show-all decline windows unknown manual manual-mismatch both malicious ambiguous automation; do
    setup_reset
    set_config "${VALID_CONFIG}"
    printf '%s\n' "${DEVICE_AWARE_FIXTURE}" > "${T}/discovery-output"
    expected="${VALID_CONFIG}"
    case "${scenario}" in
      workstation) printf 'workstation\n1\nalex\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.2\nMAC_USER=alex\nMAC_HOST=mac.example.ts.net' ;;
      mac) printf 'mac\n1\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.3' ;;
      legacy) printf 'mac\n2\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.6' ;;
      show-all) printf 'mac\na\n1\nyes\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.2' ;;
      decline) printf 'mac\na\n1\nno\n' > "${T}/answers" ;;
      windows) printf 'workstation\na\n3\nyes\nalex\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.4\nMAC_USER=alex\nMAC_HOST=mac.example.ts.net' ;;
      unknown) printf 'mac\na\n4\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.5' ;;
      manual) printf 'mac\n0\nmanual-mac\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=manual-mac' ;;
      manual-mismatch) printf 'mac\n0\n100.64.1.2\nno\n' > "${T}/answers" ;;
      both) printf 'both\n1\nalex\n1\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.64.1.2\nMAC_USER=sam\nMAC_HOST=100.64.1.3' ;;
      malicious) printf 'mac\na\n7\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.8' ;;
      ambiguous) printf 'mac\na\n8\nsam\nyes\n' > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.9' ;;
      automation) : > "${T}/answers"; expected=$'WORKSTATION_USER=alex\nWORKSTATION_HOST=100.101.102.103\nMAC_USER=sam\nMAC_HOST=100.64.1.2' ;;
    esac
    rc=0
    if [[ "${scenario}" == automation ]]; then
      out="$(discovery_run --non-interactive --yes --mac-user sam --mac-host 100.64.1.2 < /dev/null 2>&1)" || rc=$?
    else
      out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
    fi
    case "${scenario}" in
      decline|manual-mismatch)
        if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'OS mismatch not confirmed'; then fail "${scenario} did not cancel"; ok=1; fi ;;
      *) [[ "${rc}" -eq 0 ]] || { fail "${scenario}: ${out}"; ok=1; } ;;
    esac
    discovery_expected "${expected}"
    untouched || ok=1
    if contains "${out}" $'\033' || contains "${out}" $'\a' || contains "${out}" '$(' || contains "${out}" LOCAL-DEVICE; then fail 'unsafe or local metadata display'; ok=1; fi
    case "${scenario}" in
      workstation)
        if ! contains "${out}" '1) vpn-gateway | Linux | 100.64.1.2' || ! contains "${out}" '2) vpn-gateway | Linux | 100.64.1.20' || contains "${out}" '1) macbook' || contains "${out}" 'office-win |'; then fail 'Linux recommendation/short-name order'; ok=1; fi ;;
      mac|legacy)
        if ! contains "${out}" '1) macbook | macOS | 100.64.1.3' || ! contains "${out}" '2) legacy-mac | macOS | 100.64.1.6' || contains "${out}" 'vpn-gateway |'; then fail 'macOS recommendation'; ok=1; fi ;;
      show-all|decline|manual-mismatch)
        contains "${out}" 'Warning: this device reports Linux; macOS is recommended for Mac.' || { fail 'Mac/Linux mismatch warning'; ok=1; } ;;
      windows)
        if ! contains "${out}" '3) office-win | Windows | 100.64.1.4' || ! contains "${out}" 'Warning: this device reports Windows; Linux is recommended for Workstation.'; then fail 'Windows advisory'; ok=1; fi ;;
      unknown|manual|malicious|ambiguous)
        if ! contains "${out}" 'OS: Unknown; compatibility is unverified.' || contains "${out}" Warning:; then fail 'unknown OS warning behavior'; ok=1; fi ;;
    esac
    if [[ "${scenario}" == automation ]]; then
      [[ ! -s "${T}/ts.log" ]] || { fail 'automation discovered devices'; ok=1; }
      contains "${out}" Warning: && { fail 'automation prompted for OS'; ok=1; }
    else
      [[ "$(cat "${T}/ts.log")" == 'status --json' ]] || { fail 'unexpected discovery/probe'; ok=1; }
    fi
  done
  # No matching peers still offers show-all and manual entry in the same prompt.
  setup_reset
  printf '%s\n' '{"BackendState":"Running","TailscaleIPs":["100.64.1.1"],"Peer":{"w":{"HostName":"win-only","OS":"windows","TailscaleIPs":["100.64.1.4"]}}}' > "${T}/discovery-output"
  printf 'mac\na\n1\nyes\nsam\nyes\n' > "${T}/answers"
  rc=0
  out="$(discovery_run < "${T}/answers" 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'No devices reporting macOS found' || ! contains "${out}" 'a) Show all devices' || ! contains "${out}" '0) Enter an address manually'; then fail 'no-match recovery'; ok=1; fi
  discovery_expected $'MAC_USER=sam\nMAC_HOST=100.64.1.4'
  untouched || ok=1
  setup_reset
  rm -f "${T}/bin-discovery/python3"
  return "${ok}"
}

doctor_run() {
  run_iso "${T}/bin-doctor" "${JACK}" doctor "$@"
}

check_doctor() {
  local scenario out rc expected ok=0
  for scenario in mac arch cachyos mixed-failure unsupported missing-tailscale stopped malformed-status no-ssh no-python broken-python missing-config malformed-config valid-config partial-config; do
    setup_reset
    set_config "${VALID_CONFIG}"
    FAKE_OS=Linux
    DOCTOR_DISTRO=arch
    DOCTOR_STATE=Running
    expected=0
    case "${scenario}" in
      mac) FAKE_OS=Darwin ;;
      cachyos) DOCTOR_DISTRO=cachyos ;;
      mixed-failure) DOCTOR_STATE=Stopped; mv "${T}/bin-doctor/python3" "${T}/doctor-python"; expected=1 ;;
      unsupported) DOCTOR_DISTRO=ubuntu; expected=1 ;;
      missing-tailscale) mv "${T}/bin-doctor/tailscale" "${T}/doctor-tail"; expected=1 ;;
      stopped) DOCTOR_STATE=Stopped; expected=1 ;;
      malformed-status) DOCTOR_STATE=invalid; expected=1 ;;
      no-ssh) mv "${T}/bin-doctor/ssh" "${T}/doctor-ssh"; expected=1 ;;
      no-python) mv "${T}/bin-doctor/python3" "${T}/doctor-python"; expected=2 ;;
      broken-python) mv "${T}/bin-doctor/python3" "${T}/doctor-python"; write_stub "${T}/bin-doctor/python3" 'exit 1'; expected=2 ;;
      missing-config) clear_config; expected=1 ;;
      malformed-config) set_config 'MAC_USER=$(printf secret > "$HOME/leak")'; expected=1 ;;
      partial-config) set_config $'MAC_USER=alex\nMAC_HOST=mac.example.ts.net'; expected=2 ;;
    esac
    rc=0
    out="$(doctor_run 2>&1)" || rc=$?
    if [[ "${rc}" -ne "${expected}" ]]; then fail "doctor ${scenario}: rc=${rc}, ${out}"; ok=1; fi
    contains "${out}" 'JACK CLI: running (0.1.0; source checkout identity).' || { fail 'doctor version identity mismatch'; ok=1; }
    contains "${out}" 'Doctor is read-only' || { fail 'doctor did not finish checks'; ok=1; }
    if contains "${out}" 'secret' || contains "${out}" '100.101.102.103' || contains "${out}" 'mac.example.ts.net'; then fail 'doctor disclosed config values'; ok=1; fi
    [[ ! -e "${T}/home/leak" ]] || { fail 'doctor executed config'; ok=1; }
    untouched || ok=1
    case "${scenario}" in
      missing-tailscale) mv "${T}/doctor-tail" "${T}/bin-doctor/tailscale" ;;
      no-ssh) mv "${T}/doctor-ssh" "${T}/bin-doctor/ssh" ;;
      no-python|mixed-failure) mv "${T}/doctor-python" "${T}/bin-doctor/python3" ;;
      broken-python) rm -f "${T}/bin-doctor/python3"; mv "${T}/doctor-python" "${T}/bin-doctor/python3" ;;
    esac
  done
  setup_reset
  FAKE_OS=Linux
  DOCTOR_DISTRO=arch
  DOCTOR_STATE=Running
  rc=0
  out="$(doctor_run extra 2>&1)" || rc=$?
  [[ "${rc}" -eq 1 ]] || { fail 'doctor accepted extra arguments'; ok=1; }
  untouched || ok=1
  return "${ok}"
}

check_installer_safety() {
  local script out rc ok=0
  for script in setup-macos.sh setup-workstation.sh; do
    setup_reset
    if [[ "${script}" == setup-macos.sh ]]; then FAKE_OS=Darwin; else FAKE_OS=Linux; fi
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" <<< no 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'installer ignored declined consent'; ok=1; }
    untouched || ok=1
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" < /dev/null 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'installer accepted EOF consent'; ok=1; }
    untouched || ok=1
    # Preserve existing profile/config/key data through install, repeat, uninstall.
    set_config "${VALID_CONFIG}"
    mkdir -p "${T}/home/.ssh" "${T}/expected-home/.ssh"
    printf 'user-managed key sentinel\n' > "${T}/home/.ssh/key"
    cp "${T}/home/.ssh/key" "${T}/expected-home/.ssh/key"
    printf 'user-managed profile\nexport PATH="$HOME/.local/bin:$PATH"\n' > "${T}/home/.profile"
    cp "${T}/home/.profile" "${T}/expected-home/.profile"
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" <<< yes 2>&1)" || rc=$?
    [[ "${rc}" -eq 0 ]] || { fail "installer ${script}: ${out}"; ok=1; }
    mkdir -p "${T}/expected-home/.local/bin"
    ln -s "${JACK}" "${T}/expected-home/.local/bin/jack"
    untouched || ok=1
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" < /dev/null 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'already linked'; then fail 'repeat installer not idempotent'; ok=1; fi
    untouched || ok=1
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" --uninstall <<< no 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'uninstall ignored declined consent'; ok=1; }
    untouched || ok=1
    run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" --uninstall <<< yes > /dev/null 2>&1 || ok=1
    rm -f "${T}/expected-home/.local/bin/jack"
    untouched || ok=1
    # An unrelated regular file and unrelated symlink must never be replaced.
    printf 'user managed command\n' > "${T}/home/.local/bin/jack"
    cp "${T}/home/.local/bin/jack" "${T}/expected-home/.local/bin/jack"
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" <<< yes 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'installer overwrote unrelated command'; ok=1; }
    untouched || ok=1
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" --uninstall <<< yes 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'uninstaller deleted unrelated command'; ok=1; }
    untouched || ok=1
    rm -f "${T}/home/.local/bin/jack" "${T}/expected-home/.local/bin/jack"
    ln -s "${T}/unrelated-command" "${T}/home/.local/bin/jack"
    ln -s "${T}/unrelated-command" "${T}/expected-home/.local/bin/jack"
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" <<< yes 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 ]] || { fail 'installer overwrote unrelated link'; ok=1; }
    # diff follows symlinks; give the unrelated target a harmless fixture value.
    printf 'unrelated\n' > "${T}/unrelated-command"
    untouched || ok=1
    rm -rf "${T}/home/.local" "${T}/expected-home/.local" "${T}/home/.ssh" "${T}/expected-home/.ssh"
    rm -f "${T}/home/.profile" "${T}/expected-home/.profile"
    mkdir -p "${T}/installer-other"
    ln -s "${T}/installer-other" "${T}/home/.local"
    ln -s "${T}/installer-other" "${T}/expected-home/.local"
    rc=0
    out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/${script}" <<< yes 2>&1)" || rc=$?
    [[ "${rc}" -ne 0 && ! -e "${T}/installer-other/bin" ]] || { fail 'installer followed symlink directory'; ok=1; }
    untouched || ok=1
    rm -f "${T}/home/.local" "${T}/expected-home/.local"
  done
  setup_reset
  FAKE_OS=Linux
  DOCTOR_DISTRO=ubuntu
  rc=0
  out="$(run_iso "${T}/bin-install" "${ROOT}/scripts/setup-workstation.sh" <<< yes 2>&1)" || rc=$?
  [[ "${rc}" -ne 0 ]] || { fail 'installer accepted unsupported Linux'; ok=1; }
  untouched || ok=1
  DOCTOR_DISTRO=arch
  return "${ok}"
}

# Lifecycle routes run only in the same isolated HOME/PATH as legacy installers.
check_lifecycle_cli() {
  local src="${T}/source with spaces" link="${T}/home/.local/bin/jack"
  local os action kind out rc ok=0 tool
  mkdir -p "${src}/bin" "${src}/scripts"
  cp "${JACK}" "${src}/bin/jack"
  cp "${ROOT}/scripts/"setup-*.sh "${ROOT}/scripts/install-common.sh" "${src}/scripts/"
  for os in Darwin Linux; do
    setup_reset
    FAKE_OS="${os}"
    set_config "${VALID_CONFIG}"
    chmod 600 "${T}/home/.config/jack/config" "${T}/expected-home/.config/jack/config"
    mkdir -p "${T}/home/.ssh" "${T}/expected-home/.ssh"
    printf 'synthetic key\n' > "${T}/home/.ssh/key"
    printf 'synthetic profile\n' > "${T}/home/.profile"
    chmod 600 "${T}/home/.ssh/key" "${T}/home/.profile"
    cp -p "${T}/home/.ssh/key" "${T}/expected-home/.ssh/key"
    cp -p "${T}/home/.profile" "${T}/expected-home/.profile"
    for action in install uninstall; do
      run_iso "${T}/bin-install" "${src}/bin/jack" "${action}" --help > /dev/null || ok=1
      rc=0
      run_iso "${T}/bin-install" "${src}/bin/jack" "${action}" extra < /dev/null > /dev/null 2>&1 || rc=$?
      [[ "${rc}" -ne 0 ]] || { fail 'lifecycle accepted extra argument'; ok=1; }
    done
    for kind in no eof; do
      rc=0
      if [[ "${kind}" == no ]]; then
        out="$(run_iso "${T}/bin-install" "${src}/bin/jack" install <<< no 2>&1)" || rc=$?
      else
        out="$(run_iso "${T}/bin-install" "${src}/bin/jack" install < /dev/null 2>&1)" || rc=$?
      fi
      [[ "${rc}" -ne 0 ]] || { fail 'lifecycle accepted cancellation/EOF'; ok=1; }
      untouched || ok=1
    done
    out="$(run_iso "${T}/bin-install" "${src}/bin/jack" install <<< yes 2>&1)" || { fail "CLI install: ${out}"; ok=1; }
    if ! contains "${out}" "Source CLI: ${src}/bin/jack" || ! contains "${out}" "Installation link: ${link}"; then fail 'missing path preview'; ok=1; fi
    mkdir -p "${T}/expected-home/.local/bin"
    ln -s "${src}/bin/jack" "${T}/expected-home/.local/bin/jack"
    [[ "$(readlink "${link}")" == "${src}/bin/jack" ]] || { fail 'wrong CLI link'; ok=1; }
    # Exercise PATH/shebang invocation, not just bash with a symlink argument.
    link_tool "${T}/bin-install" bash || return 1
    env -i HOME="${T}/home" PATH="${T}/bin-install" FAKE_OS="${os}" DOCTOR_DISTRO=arch \
      STUB_LOG="${T}/calls.log" "${link}" install < /dev/null > /dev/null 2>&1 || { fail 'installed invocation/repeat'; ok=1; }
    rm "${T}/bin-install/bash"
    # Relative symlink chains resolve to the same trusted checkout.
    ln -s 'source with spaces/bin/jack' "${T}/relative-jack"
    run_iso "${T}/bin-install" "${T}/relative-jack" install < /dev/null > /dev/null 2>&1 || { fail 'relative symlink invocation'; ok=1; }
    rm "${T}/relative-jack"
    rc=0
    out="$(doctor_run 2>&1)" || rc=$?
    if [[ "${rc}" -ne 2 ]] || ! contains "${out}" 'belongs to another checkout'; then fail 'other-checkout doctor'; ok=1; fi
    : > "${T}/ts.log"
    rc=0
    out="$(run_iso "${T}/bin-doctor" "${src}/bin/jack" doctor 2>&1)" || rc=$?
    if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'command linked to this checkout'; then fail 'matching-checkout doctor'; ok=1; fi
    : > "${T}/ts.log"

    for kind in no eof; do
      rc=0
      if [[ "${kind}" == no ]]; then
        run_iso "${T}/bin-install" "${link}" uninstall <<< no > /dev/null 2>&1 || rc=$?
      else
        run_iso "${T}/bin-install" "${link}" uninstall < /dev/null > /dev/null 2>&1 || rc=$?
      fi
      [[ "${rc}" -ne 0 ]] || { fail 'uninstall accepted cancellation/EOF'; ok=1; }
      untouched || ok=1
    done
    run_iso "${T}/bin-install" "${link}" uninstall <<< yes > /dev/null 2>&1 || { fail 'installed uninstall'; ok=1; }
    rm "${T}/expected-home/.local/bin/jack"
    run_iso "${T}/bin-install" "${src}/bin/jack" uninstall < /dev/null > /dev/null 2>&1 || { fail 'absent uninstall'; ok=1; }
    run_iso "${T}/bin-install" "${src}/bin/jack" install <<< yes > /dev/null 2>&1 || { fail 'CLI reinstall'; ok=1; }
    ln -s "${src}/bin/jack" "${T}/expected-home/.local/bin/jack"
    untouched || ok=1
    [[ -n "$(find "${T}/home/.config/jack/config" -perm 0600 -print)" && -n "$(find "${T}/home/.ssh/key" -perm 0600 -print)" && -n "$(find "${T}/home/.profile" -perm 0600 -print)" ]] || { fail 'fixture permissions changed'; ok=1; }
    rm "${link}" "${T}/expected-home/.local/bin/jack"
    for kind in file directory dangling unrelated; do
      case "${kind}" in
        file) printf 'unknown command\n' > "${link}" ;;
        directory) mkdir "${link}" ;;
        dangling) ln -s "${T}/does-not-exist" "${link}" ;;
        unrelated) ln -s "${T}/home/.profile" "${link}" ;;
      esac
      for action in install uninstall; do
        rc=0
        out="$(run_iso "${T}/bin-install" "${src}/bin/jack" "${action}" <<< yes 2>&1)" || rc=$?
        if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'refusing'; then fail "occupied ${kind} ${action}"; ok=1; fi
      done
      case "${kind}" in
        directory) [[ -d "${link}" && ! -L "${link}" ]] || ok=1; rmdir "${link}" ;;
        file) [[ "$(cat "${link}")" == 'unknown command' ]] || ok=1; rm "${link}" ;;
        dangling) [[ "$(readlink "${link}")" == "${T}/does-not-exist" ]] || ok=1; rm "${link}" ;;
        unrelated) [[ "$(readlink "${link}")" == "${T}/home/.profile" ]] || ok=1; rm "${link}" ;;
      esac
    done
    untouched || ok=1
  done
  # Missing/unsafe helpers are refused before any mutation.
  mv "${src}/scripts/install-common.sh" "${src}/scripts/helper-saved"
  rc=0
  out="$(run_iso "${T}/bin-install" "${src}/bin/jack" install <<< yes 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'cannot verify source'; then fail 'missing source helper accepted'; ok=1; fi
  rc=0
  out="$(run_iso "${T}/bin-doctor" "${src}/bin/jack" doctor 2>&1)" || rc=$?
  if [[ "${rc}" -ne 1 ]] || ! contains "${out}" 'source checkout/helpers missing or unsafe'; then fail 'missing-source doctor'; ok=1; fi
  : > "${T}/ts.log"
  mv "${src}/scripts/helper-saved" "${src}/scripts/install-common.sh"
  chmod o+w "${src}/scripts/install-common.sh"
  rc=0
  run_iso "${T}/bin-install" "${src}/bin/jack" install <<< yes > /dev/null 2>&1 || rc=$?
  [[ "${rc}" -ne 0 ]] || { fail 'unsafe helper accepted'; ok=1; }
  chmod o-w "${src}/scripts/install-common.sh"
  [[ ! -s "${T}/ts.log" && ! -s "${T}/ssh.log" ]] || { fail 'lifecycle network side effect'; ok=1; }
  # A broken installed link can only be diagnosed from an intact checkout.
  ln -s "${T}/missing-source/bin/jack" "${link}"
  rc=0
  out="$(doctor_run 2>&1)" || rc=$?
  if [[ "${rc}" -ne 1 ]] || ! contains "${out}" 'command link is broken'; then fail 'broken-link doctor'; ok=1; fi
  : > "${T}/ts.log" # Doctor intentionally queries only the stubbed daemon status.
  rm "${link}"
  # Simulate another actor replacing the link between preview and confirmation.
  ln -s "${src}/bin/jack" "${link}"
  mv "${T}/bin-install/readlink" "${T}/readlink-real"
  write_stub "${T}/bin-install/readlink" 'if [ -e "$HOME/readlink-seen" ]; then
rm "$1"; ln -s "$HOME/.profile" "$1"
else : > "$HOME/readlink-seen"; fi
exec "${0%/*}/../readlink-real" "$@"'
  rc=0
  out="$(run_iso "${T}/bin-install" "${src}/bin/jack" uninstall <<< yes 2>&1)" || rc=$?
  if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'link changed' || [[ "$(readlink "${link}")" != "${T}/home/.profile" ]]; then
    fail 'changed-link removal not refused'; ok=1
  fi
  rm "${T}/bin-install/readlink" "${link}" "${T}/home/readlink-seen"
  mv "${T}/readlink-real" "${T}/bin-install/readlink"
  # Fail each mutable operation without invoking real installation paths.
  for tool in mkdir ln rm; do
    [[ "${tool}" != rm ]] || ln -s "${src}/bin/jack" "${link}"
    mv "${T}/bin-install/${tool}" "${T}/tool-real"
    write_stub "${T}/bin-install/${tool}" 'exit 1'
    rc=0
    action=install
    [[ "${tool}" != rm ]] || action=uninstall
    out="$(run_iso "${T}/bin-install" "${src}/bin/jack" "${action}" <<< yes 2>&1)" || rc=$?
    if [[ "${rc}" -eq 0 ]] || ! contains "${out}" 'failed'; then fail "failure diagnostic: ${tool}"; ok=1; fi
    rm "${T}/bin-install/${tool}"
    mv "${T}/tool-real" "${T}/bin-install/${tool}"
    if [[ "${tool}" == rm ]]; then
      [[ "$(readlink "${link}")" == "${src}/bin/jack" ]] || { fail 'failed removal changed link'; ok=1; }
      rm "${link}"
    else
      [[ ! -e "${link}" && ! -L "${link}" ]] || { fail 'failed installation left link'; ok=1; }
    fi
  done
  untouched || ok=1
  [[ ! -s "${T}/ts.log" && ! -s "${T}/ssh.log" ]] || { fail 'lifecycle network side effect'; ok=1; }
  setup_reset
  FAKE_OS=Linux
  return "${ok}"
}

# Actual local Git fixtures; command execution is allowlisted through a wrapper.
check_update_plan() {
  local src="${T}/update source with spaces" bin="${T}/bin-update" before="${T}/update-before"
  local real_git scenario out rc expected sha matched index_identity ok=0 n link="${T}/home/.local/bin/jack"
  real_git="$(command -v git)" || { fail 'Git required for update fixture checks'; return 1; }
  setup_reset
  mkdir -p "${src}/bin" "${src}/scripts" "${bin}"
  cp "${JACK}" "${src}/bin/jack"
  cp "${ROOT}/scripts/"setup-*.sh "${ROOT}/scripts/install-common.sh" "${src}/scripts/"
  for n in dirname find readlink cat; do link_tool "${bin}" "${n}" || return 1; done
  for n in ssh sudo pacman brew tailscale curl wget git-remote-http git-remote-https; do
    write_stub "${bin}/${n}" "${TRIPWIRE}"
  done
  mkdir "${bin}/real"
  ln -s "${real_git}" "${bin}/real/git"
  write_stub "${bin}/git" '
validate() {
  [ "${GIT_OPTIONAL_LOCKS:-}" = 0 ] && [ "${GIT_NO_LAZY_FETCH:-}" = 1 ] &&
  [ "${GIT_ALLOW_PROTOCOL+x}" = x ] && [ -z "$GIT_ALLOW_PROTOCOL" ] &&
  [ -z "${GIT_TRACE:-}" ] && [ -z "${GIT_DIR:-}" ] || return 1
  while [ "$#" -gt 0 ]; do
    case "$1" in --no-pager|--no-optional-locks) shift ;; -c|-C) shift 2 ;; *) break ;; esac
  done
  case "${1:-}" in
    config) [ "${2:-}" = --get-regexp ] && [ "$#" = 3 ]; return ;;
    symbolic-ref) [ "$#" = 4 ] && [ "$2" = --quiet ] && [ "$3" = --short ] && [ "$4" = HEAD ]; return ;;
    rev-parse|for-each-ref|status) return 0 ;;
  esac
  return 1
}
validate "$@" || { printf "prohibited git call\n" >> "$STUB_LOG"; exit 99; }
# Keep host-wide Git/LFS settings out of deterministic fixtures. Local fixture
# filter/fsmonitor settings still apply and exercise the production safeguards.
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
exec "${0%/*}/real/git" "$@"'
  # Setup commands use real Git with isolated HOME/global config and no hooks.
  update_fixture_git() {
    env -i HOME="${T}/home" PATH="${PATH}" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      "${real_git}" -c user.name='JACK fixture' -c user.email=fixture@example.invalid \
      -c core.hooksPath=/dev/null -C "${src}" "$@"
  }
  update_fixture_git init -q || return 1
  update_fixture_git symbolic-ref HEAD refs/heads/fixture || return 1
  update_fixture_git add . || return 1
  update_fixture_git commit -qm fixture || return 1
  sha="$(update_fixture_git rev-parse HEAD)" || return 1
  update_fixture_git tag -a v0.0.1 -m fixture || return 1
  update_fixture_git update-ref refs/remotes/fixture/main "${sha}" || return 1
  update_fixture_git config remote.fixture.url https://example.invalid/no-network || return 1
  update_fixture_git config remote.fixture.fetch '+refs/heads/*:refs/remotes/fixture/*' || return 1
  update_fixture_git config branch.fixture.remote fixture || return 1
  update_fixture_git config branch.fixture.merge refs/heads/main || return 1
  mkdir -p "${T}/home/.local/bin" "${T}/home/.ssh"
  set_config "${VALID_CONFIG}"
  printf 'synthetic key\n' > "${T}/home/.ssh/key"
  chmod 600 "${T}/home/.ssh/key" "${T}/home/.config/jack/config"
  ln -s "${src}/bin/jack" "${link}"
  for scenario in clean dirty detached-tag detached-untagged missing-git malformed-metadata non-git installed broken-link unsafe-source help extra filter fsmonitor trace; do
    expected=0
    case "${scenario}" in
      dirty) printf 'untracked fixture\n' > "${src}/local-work"; printf '\n# tracked fixture change\n' >> "${src}/scripts/install-common.sh" ;;
      detached-tag) update_fixture_git checkout -q --detach "${sha}" || return 1 ;;
      detached-untagged)
        update_fixture_git -c commit.gpgsign=false commit -q --allow-empty -m untagged || return 1 ;;
      missing-git) mv "${bin}/git" "${T}/update-git-saved"; expected=1 ;;
      malformed-metadata) mv "${src}/.git" "${T}/update-git-metadata"; printf 'not git metadata\n' > "${src}/.git"; expected=1 ;;
      non-git) mv "${src}/.git" "${T}/update-git-metadata"; expected=1 ;;
      broken-link) rm "${link}"; ln -s "${T}/missing-checkout/bin/jack" "${link}" ;;
      unsafe-source) chmod o+w "${src}/scripts/install-common.sh"; expected=1 ;;
      extra) expected=1 ;;
      filter) update_fixture_git config filter.evil.clean "${bin}/ssh"; expected=1 ;;
      fsmonitor) update_fixture_git config core.fsmonitor "${bin}/ssh" ;;
    esac
    # Compare complete fixture trees, including Git metadata, before/after every
    # invocation. Logs/snapshots are outside both roots. cp preserves file modes.
    mkdir "${before}"
    cp -pR "${src}" "${before}/source"
    cp -pR "${T}/home" "${before}/home"
    index_identity="$(ls -ldin "${src}/.git/index" 2>/dev/null)" || index_identity=absent
    rc=0
    if [[ "${scenario}" == installed ]]; then
      out="$(run_iso "${bin}" "${link}" update < /dev/null 2>&1)" || rc=$?
    elif [[ "${scenario}" == trace ]]; then
      out="$(env -i HOME="${T}/home" PATH="${bin}" STUB_LOG="${T}/calls.log" \
        GIT_TRACE="${T}/home/trace-leak" GIT_TRACE2_EVENT="${T}/home/trace2-leak" GIT_DIR="${T}/wrong-repository" \
        "${BASH}" "${src}/bin/jack" update < /dev/null 2>&1)" || rc=$?
    elif [[ "${scenario}" == help ]]; then
      out="$(run_iso "${bin}" "${src}/bin/jack" update --help < /dev/null 2>&1)" || rc=$?
    elif [[ "${scenario}" == extra ]]; then
      out="$(run_iso "${bin}" "${src}/bin/jack" update extra < /dev/null 2>&1)" || rc=$?
    else
      out="$(run_iso "${bin}" "${src}/bin/jack" update < /dev/null 2>&1)" || rc=$?
    fi
    [[ "${rc}" -eq "${expected}" ]] || { fail "update ${scenario}: rc=${rc}, ${out}"; ok=1; }
    matched=1
    case "${scenario}" in
      clean) contains "${out}" 'Working tree: clean' && contains "${out}" 'Local tracking ref: fixture/main' && contains "${out}" 'Branch workflow:' || matched=0 ;;
      dirty) contains "${out}" 'Working tree: dirty' && contains "${out}" 'Preserve all local changes' || matched=0 ;;
      detached-tag) contains "${out}" 'HEAD: detached.' && contains "${out}" 'v0.0.1' || matched=0 ;;
      detached-untagged) contains "${out}" 'Exact local version tag: none.' || matched=0 ;;
      missing-git) contains "${out}" 'Git: unavailable' || matched=0 ;;
      malformed-metadata) contains "${out}" 'Git metadata: invalid' || matched=0 ;;
      non-git) contains "${out}" 'non-Git source' || matched=0 ;;
      broken-link) contains "${out}" 'command link is broken' || matched=0 ;;
      unsafe-source) contains "${out}" 'Source checkout: unknown/unsafe' || matched=0 ;;
      filter) contains "${out}" 'Working tree: unknown' || matched=0 ;;
    esac
    [[ "${matched}" -eq 1 ]] || { fail "update ${scenario} diagnostics: ${out}"; ok=1; }
    if [[ "${scenario}" != extra ]]; then
      contains "${out}" 'Read-only update plan; no update performed.' || { fail 'missing read-only notice'; ok=1; }
    fi
    diff -r "${before}/source" "${src}" > /dev/null || { fail "update ${scenario} changed source/metadata"; ok=1; }
    [[ "$(readlink "${link}")" == "$(readlink "${before}/home/.local/bin/jack")" ]] || { fail 'update changed installation link'; ok=1; }
    # Temporarily set aside only these test-owned links so portable diff need
    # not follow a dangling target. Restore them after comparing all HOME data.
    mv "${link}" "${T}/update-link-after"
    mv "${before}/home/.local/bin/jack" "${T}/update-link-before"
    diff -r "${before}/home" "${T}/home" > /dev/null || { fail "update ${scenario} changed HOME"; ok=1; }
    mv "${T}/update-link-after" "${link}"
    rm "${T}/update-link-before"
    if [[ "${index_identity}" != absent ]]; then
      [[ "$(ls -ldin "${src}/.git/index")" == "${index_identity}" && ! "${src}/.git/index" -nt "${before}/source/.git/index" ]] || { fail 'update refreshed/replaced Git index'; ok=1; }
    fi
    [[ -n "$(find "${T}/home/.ssh/key" -perm 0600 -print)" && -n "$(find "${T}/home/.config/jack/config" -perm 0600 -print)" ]] || { fail 'update changed private permissions'; ok=1; }
    [[ ! -s "${T}/calls.log" ]] || { fail 'update tripwire invoked'; ok=1; }
    rm -rf "${before}"
    case "${scenario}" in
      dirty) rm "${src}/local-work"; cp -p "${ROOT}/scripts/install-common.sh" "${src}/scripts/install-common.sh" ;;
      detached-untagged) update_fixture_git checkout -q fixture || return 1 ;;
      missing-git) mv "${T}/update-git-saved" "${bin}/git" ;;
      malformed-metadata) rm "${src}/.git"; mv "${T}/update-git-metadata" "${src}/.git" ;;
      non-git) mv "${T}/update-git-metadata" "${src}/.git" ;;
      broken-link) rm "${link}"; ln -s "${src}/bin/jack" "${link}" ;;
      unsafe-source) chmod o-w "${src}/scripts/install-common.sh" ;;
      filter) update_fixture_git config --remove-section filter.evil || return 1 ;;
      fsmonitor) update_fixture_git config --unset core.fsmonitor || return 1 ;;
    esac
  done
  # Linked worktree metadata is a gitfile pointing to a shared local Git dir.
  update_fixture_git worktree add -q --detach "${T}/update-linked" "${sha}" || return 1
  mkdir "${before}"
  cp -pR "${src}/.git" "${before}/common"
  cp -pR "${T}/update-linked" "${before}/linked"
  cp -pR "${T}/home" "${before}/home"
  rc=0
  out="$(run_iso "${bin}" "${T}/update-linked/bin/jack" update < /dev/null 2>&1)" || rc=$?
  if [[ "${rc}" -ne 0 ]] || ! contains "${out}" 'Working tree: clean' || ! contains "${out}" 'HEAD: detached.'; then
    fail "linked worktree update: ${out}"; ok=1
  fi
  diff -r "${before}/common" "${src}/.git" > /dev/null || { fail 'update changed shared Git metadata'; ok=1; }
  diff -r "${before}/linked" "${T}/update-linked" > /dev/null || { fail 'update changed linked worktree'; ok=1; }
  diff -r "${before}/home" "${T}/home" > /dev/null || { fail 'linked update changed HOME'; ok=1; }
  [[ ! -s "${T}/calls.log" ]] || { fail 'linked update tripwire invoked'; ok=1; }
  update_fixture_git worktree remove "${T}/update-linked" || return 1
  rm -rf "${before}"
  setup_reset
  rm -rf "${T}/home/.local" "${T}/home/.ssh"
  return "${ok}"
}

# Inject an occupied leaf after consent, and again immediately before native ln.
# The latter cases ensure a pre-check alone cannot hide directory-operand bugs.
check_install_consent_race() (
  local race="${T}/consent-race" tools home dest os route stage kind out rc ok=0 script label
  mkdir "${race}"
  cp -R "${T}/bin-install" "${race}/bin"
  tools="${race}/bin"
  link_tool "${tools}" ls || return 1
  mv "${tools}/mkdir" "${tools}/mkdir-real"
  mv "${tools}/ln" "${tools}/ln-real"
  for kind in tailscale curl wget; do write_stub "${tools}/${kind}" "${TRIPWIRE}"; done
  # Both wrappers use the same injector. Only the selected stage changes the
  # test-owned destination; injection primitives bypass the wrappers themselves.
  local injector='
base="${0%/*}"
tool="${0##*/}"
if [ "$tool" = mkdir ]; then "$base/mkdir-real" "$@" || exit 1; fi
if [ "$(cat "$base/../stage")" = "$tool" ] && [ ! -e "$base/../injected" ]; then
  dest="$HOME/.local/bin/jack"
  case "$(cat "$base/../kind")" in
    directory) "$base/mkdir-real" "$dest"; printf "sentinel\n" > "$dest/owner-data" ;;
    directory-link) "$base/ln-real" -s "$base/../target-directory" "$dest" ;;
    file) printf "occupied fixture\n" > "$dest" ;;
    unrelated-link) "$base/ln-real" -s "$base/../unrelated-file" "$dest" ;;
    dangling-link) "$base/ln-real" -s "$base/../missing-file" "$dest" ;;
  esac
  TZ=UTC0 LC_ALL=C "$base/ls" -ldin "$dest" > "$base/../occupied-metadata"
  : > "$base/../injected"
fi
if [ "$tool" = ln ]; then exec "$base/ln-real" "$@"; fi
'
  write_stub "${tools}/mkdir" "${injector}"
  write_stub "${tools}/ln" "${injector}"
  mkdir "${race}/target-directory"
  printf 'sentinel\n' > "${race}/target-directory/owner-data"
  printf 'unrelated fixture\n' > "${race}/unrelated-file"
  cp -pR "${race}/target-directory" "${race}/expected-target"
  for os in Darwin Linux; do
    if [[ "${os}" == Darwin ]]; then script=setup-macos.sh; else script=setup-workstation.sh; fi
    for route in cli legacy; do
      for stage in mkdir ln; do
        printf '%s\n' "${stage}" > "${race}/stage"
        for kind in directory directory-link file unrelated-link dangling-link; do
          label="${os}/${route}/${stage}/${kind}"
          home="${race}/home-${os}-${route}-${stage}-${kind}"
          mkdir -p "${home}/.local/bin" "${home}/.config/jack" "${home}/.ssh"
          printf '%s\n' "${VALID_CONFIG}" > "${home}/.config/jack/config"
          printf 'synthetic key\n' > "${home}/.ssh/key"
          printf 'synthetic profile\n' > "${home}/.profile"
          chmod 600 "${home}/.config/jack/config" "${home}/.ssh/key" "${home}/.profile"
          cp -pR "${home}" "${race}/expected-home"
          printf '%s\n' "${kind}" > "${race}/kind"
          rm -f "${race}/injected"
          dest="${home}/.local/bin/jack"
          rc=0
          if [[ "${route}" == cli ]]; then
            out="$(env -i HOME="${home}" PATH="${tools}" FAKE_OS="${os}" DOCTOR_DISTRO=arch STUB_LOG="${race}/tripwire.log" "${BASH}" "${JACK}" install <<< yes 2>&1)" || rc=$?
          else
            out="$(env -i HOME="${home}" PATH="${tools}" FAKE_OS="${os}" DOCTOR_DISTRO=arch STUB_LOG="${race}/tripwire.log" "${BASH}" "${ROOT}/scripts/${script}" <<< yes 2>&1)" || rc=$?
          fi
          if [[ "${rc}" -eq 0 ]] || contains "${out}" 'JACK linked to this checkout.'; then
            fail "consent race ${label}: false success (rc=${rc})"; ok=1
          fi
          [[ -f "${race}/injected" ]] || { fail "injection not reached: ${label}"; ok=1; }
          case "${kind}" in
            directory)
              if [[ ! -d "${dest}" || -L "${dest}" || "$(cat "${dest}/owner-data")" != sentinel || -e "${dest}/jack" || -L "${dest}/jack" ]]; then fail "directory modified/nested link: ${label}"; ok=1; fi ;;
            directory-link)
              if [[ ! -L "${dest}" || "$(readlink "${dest}")" != "${tools}/../target-directory" ]]; then fail "directory link changed: ${label}"; ok=1; fi ;;
            file)
              if [[ ! -f "${dest}" || -L "${dest}" || "$(cat "${dest}")" != 'occupied fixture' ]]; then fail "occupied file changed: ${label}"; ok=1; fi ;;
            unrelated-link)
              [[ -L "${dest}" && "$(readlink "${dest}")" == "${tools}/../unrelated-file" ]] || { fail "unrelated link changed: ${label}"; ok=1; } ;;
            dangling-link)
              [[ -L "${dest}" && ! -e "${dest}" && "$(readlink "${dest}")" == "${tools}/../missing-file" ]] || { fail "dangling link changed: ${label}"; ok=1; } ;;
          esac
          [[ "$(cat "${race}/occupied-metadata")" == "$(TZ=UTC0 LC_ALL=C command ls -ldin "${dest}")" ]] || { fail "occupied entry metadata changed: ${label}"; ok=1; }
          diff -r "${race}/expected-target" "${race}/target-directory" > /dev/null || { fail "unrelated directory modified: ${label}"; ok=1; }
          [[ "$(cat "${race}/unrelated-file")" == 'unrelated fixture' ]] || { fail 'unrelated data changed'; ok=1; }
          # Set aside only the injected fixture, then compare every other HOME
          # entry. Never perform cleanup through a symlink target.
          mv "${dest}" "${race}/occupied-fixture"
          diff -r "${race}/expected-home" "${home}" > /dev/null || { fail "user fixtures modified: ${label}"; ok=1; }
          [[ -n "$(find "${home}/.ssh/key" -perm 0600 -print)" && -n "$(find "${home}/.config/jack/config" -perm 0600 -print)" && -n "$(find "${home}/.profile" -perm 0600 -print)" ]] || { fail 'private modes changed'; ok=1; }
          rm -rf "${race}/occupied-fixture" "${race}/expected-home"
          # Remove only the known bad nested link produced before the fix so
          # subsequent pre-fix reproductions remain independent.
          if [[ -L "${race}/target-directory/jack" ]]; then rm "${race}/target-directory/jack"; fi
        done
      done
    done
  done
  [[ ! -s "${race}/tripwire.log" ]] || { fail 'consent race tripwire invoked'; ok=1; }
  return "${ok}"
)

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
run_check VERSION check_version
run_check UNKNOWN_ARGUMENT check_unknown_argument
run_check OFFLINE_STATUS check_offline_status
run_check CONFIG_ERRORS check_config_errors
run_check CONFIG_ROUTING check_config_routing
run_check SETUP_INTERACTIVE check_setup_interactive
run_check SETUP_AUTOMATION check_setup_automation
run_check SETUP_CANCEL_WRITE_FAILURE check_setup_cancel_and_write_failure
run_check SETUP_DISCOVERY_FALLBACK check_setup_discovery_fallback
if command -v python3 >/dev/null 2>&1; then
  run_check DISCOVERY_SELECTION check_discovery_selection
  run_check DISCOVERY_UNTRUSTED check_discovery_untrusted
  run_check DEVICE_AWARE check_device_aware
else
  echo 'DISCOVERY_SELECTION=SKIP (optional Python 3 unavailable)'
  echo 'DISCOVERY_UNTRUSTED=SKIP (fallback tested; full discovery not verified)'
  echo 'DEVICE_AWARE=SKIP (optional Python 3 unavailable)'
fi
run_check DOCTOR check_doctor
run_check INSTALLER_SAFETY check_installer_safety
run_check INSTALLER_REFUSAL check_installer_refusal
run_check LIFECYCLE_CLI check_lifecycle_cli
run_check UPDATE_PLAN check_update_plan
run_check INSTALL_CONSENT_RACE check_install_consent_race

if command -v shellcheck >/dev/null 2>&1; then
  # shellcheck disable=SC2046
  sc_output="$(shellcheck -x $(source_files) 2>/dev/null || true)"
  sc_count="$(printf '%s\n' "${sc_output}" | grep -c '^In ' || true)"
  echo "SHELLCHECK=INFO (${sc_count} finding(s), non-blocking)"
  [[ -z "${sc_output}" ]] || printf '%s\n' "${sc_output}"
else
  echo "SHELLCHECK=SKIP (shellcheck not installed)"
fi

if [[ "${OVERALL}" -eq 0 ]]; then
  echo "RESULT=PASS"
else
  echo "RESULT=FAIL"
fi
exit "${OVERALL}"
