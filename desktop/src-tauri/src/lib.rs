use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const RESERVED_ALIASES: &[&str] = &[
    "workstation", "mac", "add", "connect", "devices", "default", "status", "doctor",
    "diagnose", "repair", "setup", "update", "install", "uninstall", "help", "device",
];

pub fn validate_device_alias(alias: &str) -> Result<(), String> {
    if alias.is_empty() || alias.len() > 32 {
        return Err("El alias debe tener entre 1 y 32 caracteres.".into());
    }
    let bytes = alias.as_bytes();
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return Err("El alias debe iniciar con minúscula o dígito.".into());
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-' || *b == b'_')
    {
        return Err("El alias solo permite minúsculas, dígitos, '-' y '_'.".into());
    }
    if RESERVED_ALIASES.contains(&alias) {
        return Err(format!("El alias '{}' está reservado por JACK CLI.", alias));
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
        return Err("El usuario SSH debe tener entre 1 y 64 caracteres.".into());
    }
    let bytes = user.as_bytes();
    if !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return Err("El usuario SSH debe iniciar con una letra o '_'.".into());
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'.' || *b == b'-')
    {
        return Err("El usuario SSH contiene caracteres no permitidos.".into());
    }
    Ok(())
}

pub fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 {
        return Err("La dirección o hostname debe tener entre 1 y 253 caracteres.".into());
    }
    if host.starts_with('-') {
        return Err("La dirección no puede iniciar con '-'.".into());
    }
    if host.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() != 4 {
            return Err("Dirección IPv4 inválida.".into());
        }
        for part in parts {
            if part.is_empty() || (part.len() > 1 && part.starts_with('0')) {
                return Err("Octeto IPv4 inválido.".into());
            }
            let val: u16 = part.parse().map_err(|_| "Octeto IPv4 inválido.".to_string())?;
            if val > 255 {
                return Err("Octeto IPv4 fuera de rango.".into());
            }
        }
        return Ok(());
    }
    for label in host.split('.') {
        if label.is_empty() || label.len() > 63 {
            return Err("Hostname inválido.".into());
        }
        let b = label.as_bytes();
        if !b[0].is_ascii_alphanumeric() || !b[b.len() - 1].is_ascii_alphanumeric() {
            return Err("Hostname inválido.".into());
        }
        if !b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-') {
            return Err("Hostname contiene caracteres no permitidos.".into());
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
        .map_err(|e| format!("No se pudo ejecutar JACK CLI ({}): {}", bin.display(), e))?;
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

pub fn parse_tailscale_status_json(raw: &str) -> Result<DiscoveryResult, String> {
    let val: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "Respuesta inválida de tailscale status.".to_string())?;
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
            let pid = peer.get("ID").and_then(|v| v.as_str()).unwrap_or(key.as_str());
            if !self_id.is_empty() && pid == self_id {
                continue;
            }
            let ips: Vec<String> = peer
                .get("TailscaleIPs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str())
                        .filter(|ip| ip.contains('.')) // IPv4 preferred for JACK config
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
                .unwrap_or("Desconocido")
                .to_string();
            let online = peer.get("Online").and_then(|v| v.as_bool()).unwrap_or(false);
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
            "Dispositivos de Tailscale obtenidos (solo descubrimiento; no prueba acceso SSH).".into()
        } else {
            format!("Tailscale está en estado '{}'. Puedes ingresar la dirección manualmente.", state)
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
            || std::fs::read_to_string("/proc/version")
                .map(|v| v.to_ascii_lowercase().contains("wsl2") || v.to_ascii_lowercase().contains("microsoft"))
                .unwrap_or(false)
    } else {
        false
    };
    let supported_note = match os.as_str() {
        "linux" if is_wsl2 => "Linux (WSL2 Ubuntu): compatible mediante adaptador Linux.".into(),
        "linux" => "Linux (Arch/CachyOS y Ubuntu): compatible.".into(),
        "windows" => "Windows nativo: requiere ruta WSL2 Ubuntu validada.".into(),
        _ => format!("Plataforma '{}': soporte diferido en V0.1.", os),
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
    let parsed: DevicesResponse = serde_json::from_str(&stdout)
        .map_err(|e| format!("Error al leer la lista de dispositivos: {}", e))?;
    Ok(parsed.devices)
}

#[tauri::command]
fn get_device_status(alias: String) -> Result<serde_json::Value, String> {
    validate_default_alias(&alias)?;
    let (_code, stdout, stderr) = run_jack(&["status", &alias, "--json"])?;
    if stdout.starts_with('{') {
        serde_json::from_str(&stdout)
            .map_err(|e| format!("Error al interpretar el estado: {}", e))
    } else {
        Err(if stderr.is_empty() {
            "No se pudo consultar el estado del dispositivo.".into()
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
            .map_err(|e| format!("Error al interpretar jack doctor: {}", e))
    } else {
        Err(if stderr.is_empty() {
            "No se pudo ejecutar jack doctor.".into()
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
            .map_err(|e| format!("Error al interpretar jack diagnose: {}", e))
    } else {
        Err(if stderr.is_empty() {
            "No se pudo ejecutar jack diagnose.".into()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn discover_tailscale_peers() -> DiscoveryResult {
    let out = Command::new("tailscale").args(["status", "--json"]).output();
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
                    "Tailscale no está conectado. Puedes ingresar la dirección manualmente.".into()
                } else {
                    format!("Tailscale no disponible ({}). Ingresa la dirección manualmente.", stderr)
                },
            }
        }
        Err(_) => DiscoveryResult {
            available: false,
            backend_state: "NotInstalled".into(),
            peers: vec![],
            message: "Tailscale CLI no está instalado. Puedes configurar un destino SSH directo manualmente.".into(),
        },
    }
}

#[tauri::command]
fn save_wizard_config(req: WizardSaveRequest) -> Result<SaveResult, String> {
    if !req.confirmed {
        return Err("Se requiere confirmación explícita antes de guardar.".into());
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
        _ => return Err("Modo de configuración no soportado.".into()),
    }

    let devices = list_devices()?;
    Ok(SaveResult {
        saved: true,
        devices,
        message: "Configuración guardada y verificada correctamente.".into(),
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
        .ok_or_else(|| format!("El dispositivo '{}' no está configurado.", alias))?;
    if !target.complete {
        return Err(format!(
            "El dispositivo '{}' está incompleto; faltan usuario o dirección.",
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
                "Validación segura lista para 'jack connect {}' ({}@{}). Sin conexión real en modo aislado.",
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
        if Command::new("which").arg(term).output().map(|o| o.status.success()).unwrap_or(false) {
            let mut cmd = Command::new(term);
            cmd.args(*prefix);
            cmd.arg(&jack_str);
            cmd.arg("connect");
            cmd.arg(&alias);
            apply_isolated_home(&mut cmd);
            cmd.spawn()
                .map_err(|e| format!("No se pudo abrir la terminal '{}': {}", term, e))?;
            return Ok(ConnectResult {
                launched: true,
                dry_run: false,
                alias: alias.clone(),
                target_summary: format!("{}@{}", target.user, target.host),
                message: format!("Sesión SSH iniciada en terminal ({}).", term),
            });
        }
    }

    Err(format!(
        "No se detectó un emulador de terminal gráfico. Ejecuta en tu terminal: jack connect {}",
        alias
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_cli_version,
            get_platform_info,
            list_devices,
            get_device_status,
            run_doctor,
            run_diagnose,
            discover_tailscale_peers,
            save_wizard_config,
            set_default_device,
            launch_connect,
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

    #[test]
    fn isolated_cli_adapter_round_trip() {
        let dir = env::temp_dir().join(format!("jack-rust-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        env::set_var("JACK_HOME", &dir);
        env::set_var("JACK_CONNECT_DRY_RUN", "1");

        let ver = get_cli_version().unwrap();
        assert!(ver.starts_with("jack "));

        let empty = list_devices().unwrap();
        assert!(empty.is_empty());

        let saved = save_wizard_config(WizardSaveRequest {
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
        })
        .unwrap();
        assert!(saved.saved);
        assert_eq!(saved.devices.len(), 1);
        assert_eq!(saved.devices[0].alias, "lab");

        let conn = launch_connect("lab".into()).unwrap();
        assert!(conn.dry_run);
        assert_eq!(conn.target_summary, "alex@127.0.0.1");

        let _ = std::fs::remove_dir_all(&dir);
        env::remove_var("JACK_HOME");
        env::remove_var("JACK_CONNECT_DRY_RUN");
    }
}
