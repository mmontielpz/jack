mod easy_pairing_ipc;

use easy_pairing_ipc::{
    client_disconnect_impl, client_read_status_impl, confirm_client_sas_impl,
    decide_host_approval_impl, list_bind_options_impl, poll_client_status_impl,
    poll_host_status_impl, revoke_host_peer_impl, start_client_pairing_impl,
    start_host_sharing_impl, stop_host_sharing_impl, ClientPairingStatus, EasyPairingState,
    HostShareStatus,
};
use jack_easy_pairing::status_cap::StatusReadResponse;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const RESERVED_ALIASES: &[&str] = &[
    "workstation",
    "mac",
    "add",
    "connect",
    "devices",
    "default",
    "status",
    "doctor",
    "diagnose",
    "repair",
    "setup",
    "update",
    "install",
    "uninstall",
    "help",
    "device",
];

pub fn validate_device_alias(alias: &str) -> Result<(), String> {
    if alias.is_empty() || alias.len() > 32 {
        return Err("Alias must be between 1 and 32 characters.".into());
    }
    let bytes = alias.as_bytes();
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return Err("Alias must start with a lowercase letter or digit.".into());
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-' || *b == b'_')
    {
        return Err("Alias may only contain lowercase letters, digits, '-' and '_'.".into());
    }
    if RESERVED_ALIASES.contains(&alias) {
        return Err(format!("Alias '{}' is reserved by JACK CLI.", alias));
    }
    Ok(())
}

pub fn validate_default_alias(alias: &str) -> Result<(), String> {
    if alias == "workstation" || alias == "mac" {
        return Ok(());
    }
    validate_device_alias(alias)
}

pub fn validate_user(user: &str) -> Result<(), String> {
    if user.is_empty() || user.len() > 64 {
        return Err("SSH username must be between 1 and 64 characters.".into());
    }
    let bytes = user.as_bytes();
    if !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return Err("SSH username must start with a letter or '_'.".into());
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'.' || *b == b'-')
    {
        return Err("SSH username contains unsupported characters.".into());
    }
    Ok(())
}

pub fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 {
        return Err("Host address must be between 1 and 253 characters.".into());
    }
    if host.starts_with('-') {
        return Err("Host address cannot start with '-'.".into());
    }
    if host.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() != 4 {
            return Err("Invalid IPv4 address.".into());
        }
        for part in parts {
            if part.is_empty() || (part.len() > 1 && part.starts_with('0')) {
                return Err("Invalid IPv4 octet.".into());
            }
            let val: u16 = part
                .parse()
                .map_err(|_| "Invalid IPv4 octet.".to_string())?;
            if val > 255 {
                return Err("IPv4 octet out of range.".into());
            }
        }
        return Ok(());
    }
    for label in host.split('.') {
        if label.is_empty() || label.len() > 63 {
            return Err("Invalid hostname.".into());
        }
        let b = label.as_bytes();
        if !b[0].is_ascii_alphanumeric() || !b[b.len() - 1].is_ascii_alphanumeric() {
            return Err("Invalid hostname.".into());
        }
        if !b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-') {
            return Err("Hostname contains unsupported characters.".into());
        }
    }
    Ok(())
}

fn resolve_jack_bin() -> PathBuf {
    if let Ok(p) = env::var("JACK_BIN") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let repo_bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bin/jack");
    if repo_bin.exists() {
        return repo_bin;
    }
    PathBuf::from("jack")
}

fn resolve_effective_home() -> Result<PathBuf, String> {
    if let Ok(home) = env::var("JACK_HOME") {
        if !home.is_empty() {
            return Ok(PathBuf::from(home));
        }
    }
    if let Ok(home) = env::var("HOME") {
        if !home.is_empty() {
            return Ok(PathBuf::from(home));
        }
    }
    if let Ok(home) = env::var("USERPROFILE") {
        if !home.is_empty() {
            return Ok(PathBuf::from(home));
        }
    }
    Err("Could not determine HOME directory.".into())
}

fn apply_isolated_home(cmd: &mut Command) {
    if let Ok(home) = env::var("JACK_HOME") {
        if !home.is_empty() {
            cmd.env("HOME", home);
        }
    }
}

fn run_jack(args: &[&str]) -> Result<(i32, String, String), String> {
    let bin = resolve_jack_bin();
    let mut cmd = Command::new(&bin);
    cmd.args(args);
    apply_isolated_home(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("Failed to execute JACK CLI ({}): {}", bin.display(), e))?;
    let code = out.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Ok((code, stdout, stderr))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlatformInfo {
    pub os: String,
    pub is_wsl2: bool,
    pub supported_note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceEntry {
    pub alias: String,
    pub user: String,
    pub host: String,
    pub source: String,
    pub complete: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct DevicesResponse {
    devices: Vec<DeviceEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TailscalePeer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub os: String,
    pub online: bool,
    pub is_windows: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscoveryResult {
    pub available: bool,
    pub backend_state: String,
    pub peers: Vec<TailscalePeer>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WizardSaveRequest {
    pub mode: String, // "workstation" | "mac" | "both" | "device"
    pub workstation_user: Option<String>,
    pub workstation_host: Option<String>,
    pub mac_user: Option<String>,
    pub mac_host: Option<String>,
    pub device_alias: Option<String>,
    pub device_user: Option<String>,
    pub device_host: Option<String>,
    pub set_default: bool,
    pub confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreflightCheckItem {
    pub name: String,
    pub status: String, // "PASS" | "WARNING" | "FAIL" | "NOT_TESTED"
    pub detail: String,
    pub remediation: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreflightResult {
    pub overall: String, // "PASS" | "WARNING" | "FAIL"
    pub can_save: bool,
    pub checks: Vec<PreflightCheckItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SaveResult {
    pub saved: bool,
    pub devices: Vec<DeviceEntry>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectResult {
    pub launched: bool,
    pub dry_run: bool,
    pub alias: String,
    pub target_summary: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResetPreview {
    pub config_path: String,
    pub config_exists: bool,
    pub backup_dir: String,
    pub preserved_items: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResetResult {
    pub reset: bool,
    pub backup_path: Option<String>,
    pub affected_files: Vec<String>,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TailscaleState {
    pub cli_installed: bool,
    pub running: bool,
    pub authenticated: bool,
    pub service_running: bool,
    pub signed_in: bool,
    pub connected: bool,
    pub status_category: String, // "CONNECTED" | "NOT_INSTALLED" | "SERVICE_STOPPED" | "SIGNED_OUT" | "DISCONNECTED" | "UNKNOWN"
    pub backend_state: String,
    pub tailnet_name: Option<String>,
    pub self_name: Option<String>,
    pub os_family: String,
    pub install_url: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkReachabilityResult {
    pub status: String, // "REACHABLE" | "UNREACHABLE" | "NOT_TESTED"
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SshAuthTestResult {
    pub status: String, // "VERIFIED" | "FAILED" | "NOT_TESTED"
    pub host_key_checked: bool,
    pub failure_category: Option<String>, // "offline" | "ssh_unavailable" | "auth_rejected" | "host_key_issue" | "timeout" | "unknown"
    pub recovery_hint: Option<String>,
    pub detail: String,
}

pub fn classify_ssh_failure(stderr: &str) -> (&'static str, &'static str) {
    let low = stderr.to_lowercase();
    if low.contains("host key verification failed")
        || low.contains("remote host identification has changed")
        || low.contains("offending")
        || low.contains("known_hosts")
    {
        (
            "host_key_issue",
            "Host key is unknown or changed. Verify the host fingerprint out-of-band and update ~/.ssh/known_hosts before retrying.",
        )
    } else if low.contains("permission denied") || low.contains("publickey") {
        (
            "auth_rejected",
            "SSH key authentication was rejected. Ensure your public key is in ~/.ssh/authorized_keys on the target.",
        )
    } else if low.contains("timed out") {
        (
            "timeout",
            "Connection timed out. Verify the device is online and port 22 is reachable.",
        )
    } else if low.contains("connection refused") {
        (
            "ssh_unavailable",
            "Connection refused on port 22. Ensure OpenSSH Server is running on the remote device.",
        )
    } else if low.contains("could not resolve")
        || low.contains("network is unreachable")
        || low.contains("no route to host")
    {
        (
            "offline",
            "Target appears offline or unreachable. Check Tailscale connectivity or hostname.",
        )
    } else {
        (
            "unknown",
            "Check SSH connectivity, username, and local SSH configuration, then retry.",
        )
    }
}

fn detect_install_url_and_family() -> (String, String) {
    if cfg!(target_os = "macos") {
        ("macos".into(), "https://tailscale.com/download/mac".into())
    } else if cfg!(target_os = "windows") {
        (
            "windows".into(),
            "https://tailscale.com/download/windows".into(),
        )
    } else {
        (
            "linux".into(),
            "https://tailscale.com/download/linux".into(),
        )
    }
}

pub fn parse_tailscale_state_json(raw: &str) -> TailscaleState {
    let (os_family, install_url) = detect_install_url_and_family();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return TailscaleState {
            cli_installed: true,
            running: false,
            authenticated: false,
            service_running: false,
            signed_in: false,
            connected: false,
            status_category: "UNKNOWN".into(),
            backend_state: "Unknown".into(),
            tailnet_name: None,
            self_name: None,
            os_family,
            install_url,
            message: "Unable to read Tailscale status output.".into(),
        };
    };
    let backend_state = v
        .get("BackendState")
        .and_then(|s| s.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let (service_running, signed_in, connected, status_category, message) =
        match backend_state.as_str() {
            "Running" => (
                true,
                true,
                true,
                "CONNECTED",
                "Tailscale is installed, signed in, and connected.".to_string(),
            ),
            "NeedsLogin" | "NeedsMachineAuth" => (
                true,
                false,
                false,
                "SIGNED_OUT",
                "Tailscale is installed and running, but you are not signed in.".to_string(),
            ),
            "Stopped" => (
                true,
                true,
                false,
                "DISCONNECTED",
                "Tailscale is installed but currently disconnected (Stopped).".to_string(),
            ),
            "NoState" | "Starting" => (
                true,
                false,
                false,
                "DISCONNECTED",
                format!("Tailscale is not connected yet (state: {}).", backend_state),
            ),
            _ => (
                false,
                false,
                false,
                "UNKNOWN",
                format!("Tailscale state is unknown ({}).", backend_state),
            ),
        };

    let tailnet_name = v
        .pointer("/CurrentTailnet/Name")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    let self_name = v
        .pointer("/Self/HostName")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    TailscaleState {
        cli_installed: true,
        running: service_running,
        authenticated: signed_in,
        service_running,
        signed_in,
        connected,
        status_category: status_category.into(),
        backend_state,
        tailnet_name,
        self_name,
        os_family,
        install_url,
        message,
    }
}

pub fn parse_tailscale_status_json(raw: &str) -> Result<DiscoveryResult, String> {
    let val: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| "Invalid response from tailscale status.".to_string())?;
    let state = val
        .get("BackendState")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut self_ips: HashSet<String> = HashSet::new();
    if let Some(arr) = val
        .get("Self")
        .and_then(|s| s.get("TailscaleIPs"))
        .and_then(|v| v.as_array())
    {
        for ip in arr {
            if let Some(s) = ip.as_str() {
                self_ips.insert(s.to_string());
            }
        }
    }
    let self_id = val
        .get("Self")
        .and_then(|s| s.get("ID"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut peers = Vec::new();
    if let Some(peer_map) = val.get("Peer").and_then(|p| p.as_object()) {
        for (key, peer) in peer_map {
            let pid = peer
                .get("ID")
                .and_then(|v| v.as_str())
                .unwrap_or(key.as_str());
            if !self_id.is_empty() && pid == self_id {
                continue;
            }
            let ips: Vec<String> = peer
                .get("TailscaleIPs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .filter(|ip| ip.contains('.'))
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default();
            if ips.is_empty() || ips.iter().any(|ip| self_ips.contains(ip)) {
                continue;
            }
            let addr = ips[0].clone();
            if validate_host(&addr).is_err() {
                continue;
            }
            let dns = peer
                .get("DNSName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim_end_matches('.');
            let hostname = peer.get("HostName").and_then(|v| v.as_str()).unwrap_or("");
            let name = if !hostname.is_empty() {
                hostname.to_string()
            } else if !dns.is_empty() {
                dns.split('.').next().unwrap_or(dns).to_string()
            } else {
                addr.clone()
            };
            let os = peer
                .get("OS")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            let online = peer
                .get("Online")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_windows = os.to_ascii_lowercase().contains("windows");
            peers.push(TailscalePeer {
                id: pid.to_string(),
                name,
                address: addr,
                os,
                online,
                is_windows,
            });
        }
    }
    peers.sort_by(|a, b| a.name.cmp(&b.name).then(a.address.cmp(&b.address)));
    Ok(DiscoveryResult {
        available: state == "Running",
        backend_state: state.clone(),
        peers,
        message: if state == "Running" {
            "Tailscale peers discovered (discovery does not verify SSH authentication).".into()
        } else {
            format!(
                "Tailscale state is '{}'. You can enter an address manually.",
                state
            )
        },
    })
}

#[tauri::command]
fn get_cli_version() -> Result<String, String> {
    let (code, stdout, stderr) = run_jack(&["--version"])?;
    if code != 0 {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(stdout)
}

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    let os = env::consts::OS.to_string();
    let is_wsl2 = if os == "linux" {
        env::var("WSL_INTEROP").is_ok()
            || fs::read_to_string("/proc/version")
                .map(|v| {
                    v.to_ascii_lowercase().contains("wsl2")
                        || v.to_ascii_lowercase().contains("microsoft")
                })
                .unwrap_or(false)
    } else {
        false
    };
    let supported_note = match os.as_str() {
        "linux" if is_wsl2 => "Linux (WSL2 Ubuntu): supported via Linux adapter.".into(),
        "linux" => "Linux (Arch/CachyOS and Ubuntu): supported.".into(),
        "windows" => "Windows native: requires validated WSL2 Ubuntu path.".into(),
        _ => format!("Platform '{}': support deferred in V0.1.", os),
    };
    PlatformInfo {
        os,
        is_wsl2,
        supported_note,
    }
}

#[tauri::command]
fn list_devices() -> Result<Vec<DeviceEntry>, String> {
    let (code, stdout, stderr) = run_jack(&["devices", "--json"])?;
    if code != 0 {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    let parsed: DevicesResponse =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse device list: {}", e))?;
    Ok(parsed.devices)
}

#[tauri::command]
fn get_device_status(alias: String) -> Result<serde_json::Value, String> {
    validate_default_alias(&alias)?;
    let (_code, stdout, stderr) = run_jack(&["status", &alias, "--json"])?;
    if stdout.starts_with('{') {
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse device status: {}", e))
    } else {
        Err(if stderr.is_empty() {
            "Could not query device status.".into()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn run_doctor() -> Result<serde_json::Value, String> {
    let (_code, stdout, stderr) = run_jack(&["doctor", "--json"])?;
    if stdout.starts_with('{') {
        serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse jack doctor output: {}", e))
    } else {
        Err(if stderr.is_empty() {
            "Could not run jack doctor.".into()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn run_diagnose() -> Result<serde_json::Value, String> {
    let (_code, stdout, stderr) = run_jack(&["diagnose", "--json"])?;
    if stdout.starts_with('{') {
        serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse jack diagnose output: {}", e))
    } else {
        Err(if stderr.is_empty() {
            "Could not run jack diagnose.".into()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn get_tailscale_state() -> TailscaleState {
    let (os_family, install_url) = detect_install_url_and_family();
    let out = Command::new("tailscale")
        .args(["status", "--json"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            parse_tailscale_state_json(&stdout)
        }
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            if !stdout.trim().is_empty() {
                let parsed = parse_tailscale_state_json(&stdout);
                if parsed.status_category != "UNKNOWN" {
                    return parsed;
                }
            }
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            let low = stderr.to_lowercase();
            let stopped = low.contains("failed to connect")
                || low.contains("tailscaled")
                || low.contains("not running")
                || low.contains("no such file or directory");
            TailscaleState {
                cli_installed: true,
                running: false,
                authenticated: false,
                service_running: !stopped && false,
                signed_in: false,
                connected: false,
                status_category: if stopped {
                    "SERVICE_STOPPED"
                } else {
                    "DISCONNECTED"
                }
                .into(),
                backend_state: if stopped {
                    "ServiceStopped"
                } else {
                    "Disconnected"
                }
                .into(),
                tailnet_name: None,
                self_name: None,
                os_family,
                install_url,
                message: if stopped {
                    "Tailscale CLI is installed, but the tailscaled background service is not running.".into()
                } else if stderr.is_empty() {
                    "Tailscale is not connected.".into()
                } else {
                    format!("Tailscale is not connected ({}).", stderr)
                },
            }
        }
        Err(_) => TailscaleState {
            cli_installed: false,
            running: false,
            authenticated: false,
            service_running: false,
            signed_in: false,
            connected: false,
            status_category: "NOT_INSTALLED".into(),
            backend_state: "NotInstalled".into(),
            tailnet_name: None,
            self_name: None,
            os_family,
            install_url,
            message: "Tailscale is not installed on this machine.".into(),
        },
    }
}

fn check_network_reachability_impl(
    host: String,
    dry_run: bool,
) -> Result<NetworkReachabilityResult, String> {
    validate_host(&host)?;
    if dry_run {
        return Ok(NetworkReachabilityResult {
            status: "NOT_TESTED".into(),
            detail: "Dry-run mode active: network reachability was not tested.".into(),
        });
    }
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let target = format!("{}:22", host);
    let Ok(addrs) = target.to_socket_addrs() else {
        return Ok(NetworkReachabilityResult {
            status: "UNREACHABLE".into(),
            detail: format!("Could not resolve host '{}'.", host),
        });
    };
    let timeout = Duration::from_secs(2);
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return Ok(NetworkReachabilityResult {
                status: "REACHABLE".into(),
                detail: format!("TCP port 22 is reachable on '{}'.", host),
            });
        }
    }
    Ok(NetworkReachabilityResult {
        status: "UNREACHABLE".into(),
        detail: format!("TCP port 22 did not respond on '{}' within 2s.", host),
    })
}

#[tauri::command]
fn check_network_reachability(host: String) -> Result<NetworkReachabilityResult, String> {
    let dry_run = env::var("JACK_CONNECT_DRY_RUN").as_deref() == Ok("1");
    check_network_reachability_impl(host, dry_run)
}

fn test_ssh_authentication_impl(
    user: String,
    host: String,
    consent: bool,
    dry_run: bool,
) -> Result<SshAuthTestResult, String> {
    if !consent {
        return Err("Explicit user consent is required before testing SSH authentication.".into());
    }
    validate_user(&user)?;
    validate_host(&host)?;
    if dry_run {
        return Ok(SshAuthTestResult {
            status: "NOT_TESTED".into(),
            host_key_checked: false,
            failure_category: None,
            recovery_hint: Some(
                "Disable JACK_CONNECT_DRY_RUN to run a live authorized SSH test.".into(),
            ),
            detail: "Dry-run mode active: SSH authentication was not tested.".into(),
        });
    }
    let target = format!("{}@{}", user, host);
    let out = Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=5",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "NumberOfPasswordPrompts=0",
            &target,
            "true",
        ])
        .output()
        .map_err(|e| format!("Failed to invoke ssh client: {}", e))?;

    if out.status.success() {
        Ok(SshAuthTestResult {
            status: "VERIFIED".into(),
            host_key_checked: true,
            failure_category: None,
            recovery_hint: None,
            detail: format!(
                "SSH authentication succeeded for '{}' with verified host key.",
                target
            ),
        })
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let (cat, hint) = classify_ssh_failure(&stderr);
        let detail = if stderr.is_empty() {
            "SSH authentication failed or host key is not trusted in known_hosts.".into()
        } else {
            let first_line = stderr
                .lines()
                .next()
                .unwrap_or("SSH authentication failed.");
            format!("SSH authentication failed: {}", first_line)
        };
        Ok(SshAuthTestResult {
            status: "FAILED".into(),
            host_key_checked: true,
            failure_category: Some(cat.into()),
            recovery_hint: Some(hint.into()),
            detail,
        })
    }
}

#[tauri::command]
fn test_ssh_authentication(
    user: String,
    host: String,
    consent: bool,
) -> Result<SshAuthTestResult, String> {
    let dry_run = env::var("JACK_CONNECT_DRY_RUN").as_deref() == Ok("1");
    test_ssh_authentication_impl(user, host, consent, dry_run)
}

#[tauri::command]
fn discover_tailscale_peers() -> DiscoveryResult {
    let out = Command::new("tailscale")
        .args(["status", "--json"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            parse_tailscale_status_json(&stdout).unwrap_or_else(|msg| DiscoveryResult {
                available: false,
                backend_state: "Error".into(),
                peers: vec![],
                message: msg,
            })
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            DiscoveryResult {
                available: false,
                backend_state: "Disconnected".into(),
                peers: vec![],
                message: if stderr.is_empty() {
                    "Tailscale is not connected. You can enter a host address manually.".into()
                } else {
                    format!(
                        "Tailscale unavailable ({}). Enter a host address manually.",
                        stderr
                    )
                },
            }
        }
        Err(_) => DiscoveryResult {
            available: false,
            backend_state: "NotInstalled".into(),
            peers: vec![],
            message:
                "Tailscale CLI is not installed. You can configure a direct SSH host manually."
                    .into(),
        },
    }
}

#[tauri::command]
fn run_preflight(req: WizardSaveRequest) -> PreflightResult {
    let mut checks = Vec::new();
    let mut has_fail = false;

    // 1. Target alias & host validation + optional SSH username validation
    if req.mode == "device" {
        let alias = req.device_alias.as_deref().unwrap_or("");
        let host = req.device_host.as_deref().unwrap_or("");
        let user = req.device_user.as_deref().unwrap_or("");

        match validate_device_alias(alias).and_then(|_| validate_host(host)) {
            Ok(()) => checks.push(PreflightCheckItem {
                name: "Target device & host".into(),
                status: "PASS".into(),
                detail: format!("Alias '{}' and host '{}' are valid.", alias, host),
                remediation: None,
            }),
            Err(e) => {
                has_fail = true;
                checks.push(PreflightCheckItem {
                    name: "Target device & host".into(),
                    status: "FAIL".into(),
                    detail: e,
                    remediation: Some("Go back to Choose Device and select a peer or enter a valid host and alias.".into()),
                });
            }
        }

        if user.trim().is_empty() {
            checks.push(PreflightCheckItem {
                name: "SSH username".into(),
                status: "NOT_TESTED".into(),
                detail: "SSH username has not been entered yet.".into(),
                remediation: Some("Enter the remote SSH username below.".into()),
            });
        } else {
            match validate_user(user) {
                Ok(()) => checks.push(PreflightCheckItem {
                    name: "SSH username".into(),
                    status: "PASS".into(),
                    detail: format!("Username '{}' syntax is valid.", user),
                    remediation: None,
                }),
                Err(e) => {
                    has_fail = true;
                    checks.push(PreflightCheckItem {
                        name: "SSH username".into(),
                        status: "FAIL".into(),
                        detail: e,
                        remediation: Some(
                            "Use letters, numbers, '.', '-', or '_' starting with a letter or '_'."
                                .into(),
                        ),
                    });
                }
            }
        }

        if let Ok(existing) = list_devices() {
            if existing.iter().any(|d| d.alias == alias) {
                has_fail = true;
                checks.push(PreflightCheckItem {
                    name: "Alias conflict".into(),
                    status: "FAIL".into(),
                    detail: format!("Device alias '{}' already exists in configuration.", alias),
                    remediation: Some(
                        "Choose a unique device alias or remove the existing entry first.".into(),
                    ),
                });
            } else {
                checks.push(PreflightCheckItem {
                    name: "Alias conflict".into(),
                    status: "PASS".into(),
                    detail: format!("Alias '{}' is available.", alias),
                    remediation: None,
                });
            }
        }
    } else {
        let syntax_res: Result<(), String> = match req.mode.as_str() {
            "workstation" => validate_user(req.workstation_user.as_deref().unwrap_or(""))
                .and_then(|_| validate_host(req.workstation_host.as_deref().unwrap_or(""))),
            "mac" => validate_user(req.mac_user.as_deref().unwrap_or(""))
                .and_then(|_| validate_host(req.mac_host.as_deref().unwrap_or(""))),
            "both" => validate_user(req.workstation_user.as_deref().unwrap_or(""))
                .and_then(|_| validate_host(req.workstation_host.as_deref().unwrap_or("")))
                .and_then(|_| validate_user(req.mac_user.as_deref().unwrap_or("")))
                .and_then(|_| validate_host(req.mac_host.as_deref().unwrap_or(""))),
            _ => Err("Unsupported configuration mode.".into()),
        };
        match syntax_res {
            Ok(()) => checks.push(PreflightCheckItem {
                name: "Target validation".into(),
                status: "PASS".into(),
                detail: "Target host and username syntax are valid.".into(),
                remediation: None,
            }),
            Err(e) => {
                has_fail = true;
                checks.push(PreflightCheckItem {
                    name: "Target validation".into(),
                    status: "FAIL".into(),
                    detail: e,
                    remediation: Some("Verify host address and SSH username.".into()),
                });
            }
        }
    }

    // 2. JACK CLI availability
    match get_cli_version() {
        Ok(v) => checks.push(PreflightCheckItem {
            name: "JACK CLI".into(),
            status: "PASS".into(),
            detail: format!("Available ({}).", v),
            remediation: None,
        }),
        Err(e) => {
            has_fail = true;
            checks.push(PreflightCheckItem {
                name: "JACK CLI".into(),
                status: "FAIL".into(),
                detail: e,
                remediation: Some("Install JACK CLI or ensure `jack` is on PATH.".into()),
            });
        }
    }

    // 3. OpenSSH client availability (independent of config existence)
    let ssh_available = Command::new("ssh").arg("-V").output().is_ok();
    if ssh_available {
        checks.push(PreflightCheckItem {
            name: "OpenSSH client".into(),
            status: "PASS".into(),
            detail: "OpenSSH client (`ssh`) is available.".into(),
            remediation: None,
        });
    } else {
        has_fail = true;
        checks.push(PreflightCheckItem {
            name: "OpenSSH client".into(),
            status: "FAIL".into(),
            detail: "OpenSSH client (`ssh`) was not found in PATH.".into(),
            remediation: Some(
                "Install OpenSSH client (`pacman -S openssh` or `apt install openssh-client`)."
                    .into(),
            ),
        });
    }

    // 4. Optional platform advisory from jack doctor (WARNING only, non-blocking)
    if let Ok(doc) = run_doctor() {
        let plat_ok = doc
            .pointer("/checks/platform/supported")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !plat_ok {
            checks.push(PreflightCheckItem {
                name: "Platform support".into(),
                status: "WARNING".into(),
                detail: "Current OS distribution is outside officially tested targets.".into(),
                remediation: Some(
                    "Tested platforms: Arch/CachyOS, Ubuntu Linux, and Windows 11 WSL2.".into(),
                ),
            });
        }
    }

    // 5. Config destination symlink & ownership safety
    if let Ok(home) = resolve_effective_home() {
        let cfg_root = home.join(".config");
        let cfg_dir = cfg_root.join("jack");
        if cfg_dir.is_symlink() || cfg_root.is_symlink() {
            has_fail = true;
            checks.push(PreflightCheckItem {
                name: "Configuration path safety".into(),
                status: "FAIL".into(),
                detail: "Configuration directory cannot be a symlink.".into(),
                remediation: Some(
                    "Replace ~/.config/jack symlink with a regular user-owned directory.".into(),
                ),
            });
        } else {
            #[cfg(unix)]
            let ownership_ok = {
                use std::os::unix::fs::MetadataExt;
                let home_uid = fs::metadata(&home).map(|m| m.uid()).ok();
                let dir_uid = if cfg_dir.exists() {
                    fs::metadata(&cfg_dir).map(|m| m.uid()).ok()
                } else {
                    home_uid
                };
                match (home_uid, dir_uid) {
                    (Some(h), Some(d)) => h == d,
                    _ => true,
                }
            };
            #[cfg(not(unix))]
            let ownership_ok = true;

            if !ownership_ok {
                has_fail = true;
                checks.push(PreflightCheckItem {
                    name: "Configuration path safety".into(),
                    status: "FAIL".into(),
                    detail: "Configuration directory is not owned by the current user.".into(),
                    remediation: Some("Fix ownership of ~/.config/jack before saving.".into()),
                });
            } else {
                checks.push(PreflightCheckItem {
                    name: "Configuration path safety".into(),
                    status: "PASS".into(),
                    detail: format!(
                        "Target configuration directory ({}) is safe.",
                        cfg_dir.display()
                    ),
                    remediation: None,
                });
            }
        }
    }

    let has_warn = checks.iter().any(|c| c.status == "WARNING");
    let overall = if has_fail {
        "FAIL"
    } else if has_warn {
        "WARNING"
    } else {
        "PASS"
    };

    PreflightResult {
        overall: overall.into(),
        can_save: !has_fail,
        checks,
    }
}

#[tauri::command]
fn save_wizard_config(req: WizardSaveRequest) -> Result<SaveResult, String> {
    if !req.confirmed {
        return Err("Explicit confirmation is required before saving.".into());
    }
    match req.mode.as_str() {
        "workstation" => {
            let u = req.workstation_user.as_deref().unwrap_or("");
            let h = req.workstation_host.as_deref().unwrap_or("");
            validate_user(u)?;
            validate_host(h)?;
            let mut args = vec![
                "setup",
                "--non-interactive",
                "--yes",
                "--workstation-user",
                u,
                "--workstation-host",
                h,
            ];
            if req.set_default {
                args.extend(["--default", "workstation"]);
            }
            let (code, stdout, stderr) = run_jack(&args)?;
            if code != 0 {
                return Err(if stderr.is_empty() { stdout } else { stderr });
            }
        }
        "mac" => {
            let u = req.mac_user.as_deref().unwrap_or("");
            let h = req.mac_host.as_deref().unwrap_or("");
            validate_user(u)?;
            validate_host(h)?;
            let mut args = vec![
                "setup",
                "--non-interactive",
                "--yes",
                "--mac-user",
                u,
                "--mac-host",
                h,
            ];
            if req.set_default {
                args.extend(["--default", "mac"]);
            }
            let (code, stdout, stderr) = run_jack(&args)?;
            if code != 0 {
                return Err(if stderr.is_empty() { stdout } else { stderr });
            }
        }
        "both" => {
            let wu = req.workstation_user.as_deref().unwrap_or("");
            let wh = req.workstation_host.as_deref().unwrap_or("");
            let mu = req.mac_user.as_deref().unwrap_or("");
            let mh = req.mac_host.as_deref().unwrap_or("");
            validate_user(wu)?;
            validate_host(wh)?;
            validate_user(mu)?;
            validate_host(mh)?;
            let mut args = vec![
                "setup",
                "--non-interactive",
                "--yes",
                "--workstation-user",
                wu,
                "--workstation-host",
                wh,
                "--mac-user",
                mu,
                "--mac-host",
                mh,
            ];
            if req.set_default {
                args.extend(["--default", "workstation"]);
            }
            let (code, stdout, stderr) = run_jack(&args)?;
            if code != 0 {
                return Err(if stderr.is_empty() { stdout } else { stderr });
            }
        }
        "device" => {
            let alias = req.device_alias.as_deref().unwrap_or("");
            let u = req.device_user.as_deref().unwrap_or("");
            let h = req.device_host.as_deref().unwrap_or("");
            validate_device_alias(alias)?;
            validate_user(u)?;
            validate_host(h)?;
            let mut args = vec![
                "setup",
                "--non-interactive",
                "--yes",
                "--device",
                alias,
                "--user",
                u,
                "--host",
                h,
            ];
            if req.set_default {
                args.extend(["--default", alias]);
            }
            let (code, stdout, stderr) = run_jack(&args)?;
            if code != 0 {
                return Err(if stderr.is_empty() { stdout } else { stderr });
            }
        }
        _ => return Err("Unsupported configuration mode.".into()),
    }

    let devices = list_devices()?;
    Ok(SaveResult {
        saved: true,
        devices,
        message: "Configuration saved successfully.".into(),
    })
}

#[tauri::command]
fn set_default_device(alias: String) -> Result<String, String> {
    validate_default_alias(&alias)?;
    let (code, stdout, stderr) = run_jack(&["default", &alias, "--yes"])?;
    if code != 0 {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(stdout)
}

#[tauri::command]
fn launch_connect(alias: String) -> Result<ConnectResult, String> {
    validate_default_alias(&alias)?;
    let devices = list_devices()?;
    let target = devices
        .into_iter()
        .find(|d| d.alias == alias)
        .ok_or_else(|| format!("Device '{}' is not configured.", alias))?;
    if !target.complete {
        return Err(format!(
            "Device '{}' is incomplete; both username and host are required.",
            alias
        ));
    }

    if env::var("JACK_CONNECT_DRY_RUN").as_deref() == Ok("1") {
        return Ok(ConnectResult {
            launched: false,
            dry_run: true,
            alias: alias.clone(),
            target_summary: format!("{}@{}", target.user, target.host),
            message: format!(
                "Dry-run validated for 'jack connect {}' ({}@{}). No live SSH session started.",
                alias, target.user, target.host
            ),
        });
    }

    let jack_bin = resolve_jack_bin();
    let jack_str = jack_bin.to_string_lossy().to_string();
    let terminals: &[(&str, &[&str])] = &[
        ("xdg-terminal-exec", &[]),
        ("alacritty", &["-e"]),
        ("kitty", &[]),
        ("wezterm", &["start", "--"]),
        ("gnome-terminal", &["--"]),
        ("konsole", &["-e"]),
        ("xterm", &["-e"]),
    ];

    for (term, prefix) in terminals {
        if Command::new("which")
            .arg(term)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let mut cmd = Command::new(term);
            cmd.args(*prefix);
            cmd.arg(&jack_str);
            cmd.arg("connect");
            cmd.arg(&alias);
            apply_isolated_home(&mut cmd);
            cmd.spawn()
                .map_err(|e| format!("Failed to launch terminal '{}': {}", term, e))?;
            return Ok(ConnectResult {
                launched: true,
                dry_run: false,
                alias: alias.clone(),
                target_summary: format!("{}@{}", target.user, target.host),
                message: format!("SSH session launched in terminal ({}).", term),
            });
        }
    }

    Err(format!(
        "No graphical terminal emulator detected. Run in terminal: jack connect {}",
        alias
    ))
}

#[tauri::command]
fn preview_reset_config() -> Result<ResetPreview, String> {
    let home = resolve_effective_home()?;
    let cfg_dir = home.join(".config/jack");
    let cfg_file = cfg_dir.join("config");
    Ok(ResetPreview {
        config_path: cfg_file.to_string_lossy().to_string(),
        config_exists: cfg_file.exists(),
        backup_dir: cfg_dir.to_string_lossy().to_string(),
        preserved_items: vec![
            "~/.ssh keys and config".into(),
            "~/.ssh/known_hosts".into(),
            "Tailscale state and login".into(),
            "Existing JACK backups".into(),
        ],
    })
}

#[tauri::command]
fn reset_jack_config(confirmed: bool) -> Result<ResetResult, String> {
    if !confirmed {
        return Err("Explicit confirmation is required to reset JACK configuration.".into());
    }
    let home = resolve_effective_home()?;
    let cfg_dir = home.join(".config/jack");
    let cfg_file = cfg_dir.join("config");
    let lock_dir = cfg_dir.join(".setup-lock");

    if cfg_dir.is_symlink() || cfg_file.is_symlink() {
        return Err("Refusing to reset symlinked configuration paths.".into());
    }

    let mut affected = Vec::new();
    let mut backup_path = None;

    if cfg_file.exists() {
        if !cfg_file.is_file() {
            return Err("Refusing to remove non-regular configuration file.".into());
        }
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let bak = cfg_dir.join(format!("config.bak.{}", ts));
        fs::copy(&cfg_file, &bak).map_err(|e| format!("Failed to create backup: {}", e))?;
        #[cfg(unix)]
        let _ = fs::set_permissions(&bak, fs::Permissions::from_mode(0o600));
        backup_path = Some(bak.to_string_lossy().to_string());

        fs::remove_file(&cfg_file).map_err(|e| format!("Failed to remove config file: {}", e))?;
        if cfg_file.exists() {
            return Err("Verification failed: config file still exists after reset.".into());
        }
        affected.push(cfg_file.to_string_lossy().to_string());
    }

    if lock_dir.is_dir() && fs::remove_dir(&lock_dir).is_ok() {
        affected.push(lock_dir.to_string_lossy().to_string());
    }

    Ok(ResetResult {
        reset: true,
        backup_path,
        affected_files: affected,
        message:
            "JACK configuration reset cleanly. SSH keys, known_hosts, and Tailscale were preserved."
                .into(),
    })
}

#[tauri::command]
fn ep_host_list_bind_options() -> Vec<String> {
    list_bind_options_impl()
}

#[tauri::command]
fn ep_host_start_sharing(
    state: tauri::State<'_, EasyPairingState>,
    bind_ip: Option<String>,
) -> Result<HostShareStatus, String> {
    start_host_sharing_impl(&state, bind_ip)
}

#[tauri::command]
fn ep_host_poll_status(
    state: tauri::State<'_, EasyPairingState>,
) -> Result<HostShareStatus, String> {
    poll_host_status_impl(&state)
}

#[tauri::command]
fn ep_host_decide_approval(
    state: tauri::State<'_, EasyPairingState>,
    request_id: String,
    approved: bool,
) -> Result<HostShareStatus, String> {
    decide_host_approval_impl(&state, request_id, approved)
}

#[tauri::command]
fn ep_host_revoke_peer(
    state: tauri::State<'_, EasyPairingState>,
    peer_id: String,
) -> Result<(), String> {
    revoke_host_peer_impl(&state, peer_id)
}

#[tauri::command]
fn ep_host_stop_sharing(state: tauri::State<'_, EasyPairingState>) -> Result<(), String> {
    stop_host_sharing_impl(&state)
}

#[tauri::command]
fn ep_client_start_pairing(
    state: tauri::State<'_, EasyPairingState>,
    endpoint: String,
    auth_code: String,
    client_name: String,
) -> Result<ClientPairingStatus, String> {
    start_client_pairing_impl(&state, endpoint, auth_code, client_name)
}

#[tauri::command]
fn ep_client_confirm_sas(
    state: tauri::State<'_, EasyPairingState>,
    confirmed: bool,
) -> Result<ClientPairingStatus, String> {
    confirm_client_sas_impl(&state, confirmed)
}

#[tauri::command]
fn ep_client_poll_status(
    state: tauri::State<'_, EasyPairingState>,
) -> Result<ClientPairingStatus, String> {
    poll_client_status_impl(&state)
}

#[tauri::command]
fn ep_client_read_status(
    state: tauri::State<'_, EasyPairingState>,
) -> Result<StatusReadResponse, String> {
    client_read_status_impl(&state)
}

#[tauri::command]
fn ep_client_disconnect(state: tauri::State<'_, EasyPairingState>) -> Result<(), String> {
    client_disconnect_impl(&state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EasyPairingState::default())
        .invoke_handler(tauri::generate_handler![
            get_cli_version,
            get_platform_info,
            list_devices,
            get_device_status,
            run_doctor,
            run_diagnose,
            get_tailscale_state,
            discover_tailscale_peers,
            run_preflight,
            check_network_reachability,
            test_ssh_authentication,
            save_wizard_config,
            set_default_device,
            launch_connect,
            preview_reset_config,
            reset_jack_config,
            ep_host_list_bind_options,
            ep_host_start_sharing,
            ep_host_poll_status,
            ep_host_decide_approval,
            ep_host_revoke_peer,
            ep_host_stop_sharing,
            ep_client_start_pairing,
            ep_client_confirm_sas,
            ep_client_poll_status,
            ep_client_read_status,
            ep_client_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shell_injection_and_invalid_inputs() {
        assert!(validate_device_alias("win-lab").is_ok());
        assert!(validate_device_alias("workstation").is_err());
        assert!(validate_device_alias("Bad Alias").is_err());
        assert!(validate_device_alias("a;rm -rf /").is_err());

        assert!(validate_user("mike").is_ok());
        assert!(validate_user("-oProxyCommand=id").is_err());
        assert!(validate_user("user;id").is_err());

        assert!(validate_host("100.64.0.10").is_ok());
        assert!(validate_host("lab.example.ts.net").is_ok());
        assert!(validate_host("-oProxyCommand=id").is_err());
        assert!(validate_host("999.0.0.1").is_err());
        assert!(validate_host("host$(id)").is_err());
    }

    #[test]
    fn parses_tailscale_peers_and_excludes_self() {
        let sample = r#"{
            "BackendState": "Running",
            "Self": {"ID": "self1", "TailscaleIPs": ["100.64.0.1"]},
            "Peer": {
                "p_self": {"ID": "self1", "HostName": "local", "OS": "linux", "Online": true, "TailscaleIPs": ["100.64.0.1"]},
                "p_win": {"ID": "w1", "HostName": "win-box", "OS": "windows", "Online": true, "TailscaleIPs": ["100.64.0.22"]}
            }
        }"#;
        let res = parse_tailscale_status_json(sample).unwrap();
        assert!(res.available);
        assert_eq!(res.peers.len(), 1);
        assert_eq!(res.peers[0].name, "win-box");
        assert!(res.peers[0].is_windows);
    }

    #[cfg(unix)]
    #[test]
    fn isolated_cli_preflight_save_connect_and_reset_round_trip() {
        let dir = env::temp_dir().join(format!("jack-rust-test-046-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".ssh")).unwrap();
        fs::write(dir.join(".ssh/known_hosts"), "sentinel\n").unwrap();
        env::set_var("JACK_HOME", &dir);
        env::set_var("JACK_CONNECT_DRY_RUN", "1");

        let req = WizardSaveRequest {
            mode: "device".into(),
            workstation_user: None,
            workstation_host: None,
            mac_user: None,
            mac_host: None,
            device_alias: Some("lab".into()),
            device_user: Some("alex".into()),
            device_host: Some("127.0.0.1".into()),
            set_default: true,
            confirmed: true,
        };

        let pre = run_preflight(req.clone());
        assert!(pre.can_save);
        assert_eq!(pre.overall, "PASS");

        let saved = save_wizard_config(req).unwrap();
        assert!(saved.saved);
        assert_eq!(saved.devices.len(), 1);
        assert_eq!(saved.devices[0].alias, "lab");

        // Duplicate device preflight fails closed
        let dup_pre = run_preflight(WizardSaveRequest {
            mode: "device".into(),
            workstation_user: None,
            workstation_host: None,
            mac_user: None,
            mac_host: None,
            device_alias: Some("lab".into()),
            device_user: Some("bob".into()),
            device_host: Some("127.0.0.2".into()),
            set_default: false,
            confirmed: true,
        });
        assert!(!dup_pre.can_save);
        assert_eq!(dup_pre.overall, "FAIL");

        let conn = launch_connect("lab".into()).unwrap();
        assert!(conn.dry_run);
        assert_eq!(conn.target_summary, "alex@127.0.0.1");

        // Reset requires confirmation, creates backup, removes config, preserves .ssh/known_hosts
        assert!(reset_jack_config(false).is_err());
        let reset = reset_jack_config(true).unwrap();
        assert!(reset.reset);
        assert!(reset.backup_path.is_some());
        assert!(Path::new(&reset.backup_path.unwrap()).exists());
        assert!(!dir.join(".config/jack/config").exists());
        assert_eq!(
            fs::read_to_string(dir.join(".ssh/known_hosts")).unwrap(),
            "sentinel\n"
        );

        let _ = fs::remove_dir_all(&dir);
        env::remove_var("JACK_HOME");
        env::remove_var("JACK_CONNECT_DRY_RUN");
    }

    #[test]
    fn tailscale_state_and_ssh_auth_guardrails() {
        let running = parse_tailscale_state_json(
            r#"{"BackendState":"Running","CurrentTailnet":{"Name":"tailnet.ts.net"},"Self":{"HostName":"cachy"}}"#,
        );
        assert_eq!(running.status_category, "CONNECTED");
        assert!(
            running.cli_installed
                && running.service_running
                && running.signed_in
                && running.connected
        );
        assert_eq!(running.tailnet_name.as_deref(), Some("tailnet.ts.net"));

        let needs_login = parse_tailscale_state_json(r#"{"BackendState":"NeedsLogin"}"#);
        assert_eq!(needs_login.status_category, "SIGNED_OUT");
        assert!(needs_login.cli_installed && needs_login.service_running && !needs_login.signed_in);

        let stopped = parse_tailscale_state_json(r#"{"BackendState":"Stopped"}"#);
        assert_eq!(stopped.status_category, "DISCONNECTED");

        let unknown = parse_tailscale_state_json("not json");
        assert_eq!(unknown.status_category, "UNKNOWN");
        assert!(!unknown.connected);

        // Consent refusal & injection rejection
        assert!(
            test_ssh_authentication_impl("alice".into(), "127.0.0.1".into(), false, false).is_err()
        );
        assert!(test_ssh_authentication_impl(
            "-oProxyCommand=id".into(),
            "127.0.0.1".into(),
            true,
            false
        )
        .is_err());
        assert!(check_network_reachability_impl("-oProxyCommand=id".into(), false).is_err());

        // Dry-run honesty (thread-safe, no env mutation)
        let dry_net = check_network_reachability_impl("127.0.0.1".into(), true).unwrap();
        assert_eq!(dry_net.status, "NOT_TESTED");
        let dry_ssh =
            test_ssh_authentication_impl("alice".into(), "127.0.0.1".into(), true, true).unwrap();
        assert_eq!(dry_ssh.status, "NOT_TESTED");

        // Failure classification
        assert_eq!(
            classify_ssh_failure("Host key verification failed.").0,
            "host_key_issue"
        );
        assert_eq!(
            classify_ssh_failure("Permission denied (publickey).").0,
            "auth_rejected"
        );
        assert_eq!(
            classify_ssh_failure("ssh: connect to host x port 22: Connection timed out").0,
            "timeout"
        );
        assert_eq!(
            classify_ssh_failure("ssh: connect to host x port 22: Connection refused").0,
            "ssh_unavailable"
        );
        assert_eq!(
            classify_ssh_failure("Could not resolve hostname x").0,
            "offline"
        );
    }
}
