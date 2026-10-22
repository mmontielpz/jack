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
    if [[ "${rc}" -ne 0 || "${out}" != 'jack 0.1.0-rc.1' ]]; then
      fail "--version ${scenario}: unexpected result (rc=${rc})"; ok=1
    fi
    untouched || ok=1
  done
  # Even an absent HOME and empty PATH need no fallback, files or commands.
  rc=0
  out="$(env -i PATH= "${BASH}" "${JACK}" --version 2>&1)" || rc=$?
  [[ "${rc}" -eq 0 && "${out}" == 'jack 0.1.0-rc.1' ]] || { fail '--version requires environment/tools'; ok=1; }
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
    contains "${out}" 'JACK CLI: running (0.1.0-rc.1; source checkout identity).' || { fail 'doctor version identity mismatch'; ok=1; }
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
