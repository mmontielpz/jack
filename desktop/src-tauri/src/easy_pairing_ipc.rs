use jack_easy_pairing::approval::{ApprovalDecision, ApprovalGate};
use jack_easy_pairing::auth::{now_unix, AuthStore, DurationPolicy};
use jack_easy_pairing::error::JackError;
use jack_easy_pairing::host_service::HostLifecycle;
use jack_easy_pairing::identity::{platform_keystore, DeviceId, DeviceIdentity};
use jack_easy_pairing::pairing::{normalize_crockford_code, PairingInvitation};
use jack_easy_pairing::status_cap::StatusReadResponse;
use jack_easy_pairing::transport::{
    detect_local_lan_ips, ensure_lan_or_loopback, is_lan_or_loopback_ip,
};
use jack_easy_pairing::{
    client_invoke_capability, client_pair_with_code, host_handle_pairing_connection,
    host_serve_capability_once,
};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingApprovalView {
    pub request_id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub requested_scope: String,
    pub sas_6digit: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostShareStatus {
    pub active: bool,
    pub state: String,
    pub endpoint: Option<String>,
    pub auth_code: Option<String>,
    pub expires_at: Option<u64>,
    pub pending_request: Option<PendingApprovalView>,
    pub paired_peer_id: Option<String>,
    pub paired_peer_name: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientPairingStatus {
    pub stage: String, // "Idle" | "VerifySas" | "WaitingApproval" | "Connected" | "Error"
    pub sas_6digit: Option<String>,
    pub host_id: Option<String>,
    pub status_read: Option<StatusReadResponse>,
    pub error: Option<String>,
}

struct HostRuntime {
    auth: Arc<AuthStore>,
    lifecycle: Arc<Mutex<HostLifecycle>>,
    approval_gate: Arc<Mutex<ApprovalGate>>,
    endpoint: String,
    auth_code: String,
    expires_at: u64,
    pending_view: Arc<Mutex<Option<PendingApprovalView>>>,
    decision_tx: Mutex<Option<mpsc::Sender<Result<ApprovalDecision, JackError>>>>,
    paired_peer_id: Arc<Mutex<Option<String>>>,
    paired_peer_name: Arc<Mutex<Option<String>>>,
    last_error: Arc<Mutex<Option<String>>>,
    host_id: Arc<DeviceIdentity>,
    started_at: Instant,
}

struct ClientRuntime {
    stage: Arc<Mutex<String>>,
    sas_6digit: Arc<Mutex<Option<String>>>,
    sas_tx: Mutex<Option<mpsc::Sender<bool>>>,
    host_id: Arc<Mutex<Option<String>>>,
    host_pk: Arc<Mutex<Option<[u8; 32]>>>,
    endpoint: Option<SocketAddr>,
    client_id: Arc<DeviceIdentity>,
    last_status: Arc<Mutex<Option<StatusReadResponse>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

pub struct EasyPairingState {
    host: Mutex<Option<HostRuntime>>,
    client: Mutex<Option<ClientRuntime>>,
    ep_home_override: Option<PathBuf>,
}

impl Default for EasyPairingState {
    fn default() -> Self {
        Self {
            host: Mutex::new(None),
            client: Mutex::new(None),
            ep_home_override: None,
        }
    }
}

#[cfg(test)]
impl EasyPairingState {
    fn with_ep_home(ep_home: PathBuf) -> Self {
        Self {
            host: Mutex::new(None),
            client: Mutex::new(None),
            ep_home_override: Some(ep_home),
        }
    }
}

fn resolve_ep_home() -> Result<PathBuf, String> {
    let base = if let Ok(jh) = std::env::var("JACK_HOME") {
        if !jh.trim().is_empty() {
            PathBuf::from(jh)
        } else {
            return Err("JACK_HOME is empty".into());
        }
    } else if let Ok(h) = std::env::var("HOME") {
        PathBuf::from(h).join(".config/jack")
    } else if let Ok(up) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(up).join("jack")
    } else if let Ok(up) = std::env::var("USERPROFILE") {
        PathBuf::from(up).join(".config/jack")
    } else {
        return Err("Unable to resolve HOME, USERPROFILE, or JACK_HOME".into());
    };
    Ok(base.join("easy-pairing"))
}

pub fn list_bind_options_impl() -> Vec<String> {
    let mut out = vec!["127.0.0.1".to_string()];
    for ip in detect_local_lan_ips() {
        let s = ip.to_string();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

pub fn start_host_sharing_impl(
    state: &EasyPairingState,
    bind_ip: Option<String>,
) -> Result<HostShareStatus, String> {
    stop_host_sharing_impl(state)?;

    let selected_ip: IpAddr = match bind_ip.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => {
            let ip: IpAddr = raw
                .parse()
                .map_err(|_| "ERR_INVALID_INPUT: invalid bind IP address".to_string())?;
            if !is_lan_or_loopback_ip(ip) {
                return Err(format!(
                    "ERR_LOOPBACK_ONLY: refusing public or wildcard bind address {}",
                    ip
                ));
            }
            ip
        }
        None => IpAddr::from([127, 0, 0, 1]),
    };

    let ep_home = match &state.ep_home_override {
        Some(path) => path.clone(),
        None => resolve_ep_home()?,
    };
    let auth =
        Arc::new(AuthStore::open_isolated(&ep_home.join("host")).map_err(|e| e.to_string())?);
    let ks = platform_keystore(&ep_home.join("keystore"));
    let host_id = Arc::new(ks.load_or_create("host").map_err(|e| e.to_string())?);

    let mut lc = HostLifecycle::new();
    lc.start().map_err(|e| e.to_string())?;
    let lifecycle = Arc::new(Mutex::new(lc));
    let approval_gate = Arc::new(Mutex::new(ApprovalGate::default()));

    let listener = TcpListener::bind(SocketAddr::new(selected_ip, 0)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let endpoint = addr.to_string();

    let invite = PairingInvitation::create(host_id.public_key_bytes(), endpoint.clone(), 300)
        .map_err(|e| e.to_string())?;
    let auth_code = invite.formatted_code();
    let expires_at = invite.expires_at;

    let (dec_tx, dec_rx) = mpsc::channel::<Result<ApprovalDecision, JackError>>();
    let pending_view: Arc<Mutex<Option<PendingApprovalView>>> = Arc::new(Mutex::new(None));
    let paired_peer_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let paired_peer_name: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let last_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let started_at = Instant::now();

    let rt_auth = auth.clone();
    let rt_lc = lifecycle.clone();
    let rt_gate = approval_gate.clone();
    let rt_pending = pending_view.clone();
    let rt_paired = paired_peer_id.clone();
    let rt_err = last_error.clone();
    let rt_host_id = host_id.clone();

    thread::spawn(move || {
        let mut invite = invite;
        let dec_rx = Mutex::new(dec_rx);
        loop {
            {
                if let Ok(lc_guard) = rt_lc.lock() {
                    if lc_guard.is_shutting_down() {
                        break;
                    }
                }
            }
            match listener.accept() {
                Ok((tcp, peer_addr)) => {
                    let _ = tcp.set_nonblocking(false);
                    let paired_opt = rt_paired.lock().ok().and_then(|g| g.clone());
                    if let Some(ref pid_str) = paired_opt {
                        if let Ok(pid) = DeviceId::parse(pid_str) {
                            if let Ok(pk) = rt_auth.trusted_pubkey_for_peer(&pid) {
                                let _ = host_serve_capability_once(
                                    tcp,
                                    peer_addr,
                                    &rt_host_id,
                                    pk,
                                    &rt_auth,
                                    &rt_lc,
                                    started_at,
                                );
                            }
                        }
                        continue;
                    }

                    if let Ok(mut err) = rt_err.lock() {
                        *err = None;
                    }
                    if let Ok(rx) = dec_rx.lock() {
                        while rx.try_recv().is_ok() {}
                    }
                    let res = host_handle_pairing_connection(
                        tcp,
                        peer_addr,
                        &rt_host_id,
                        &mut invite,
                        &rt_auth,
                        &rt_lc,
                        &rt_gate,
                        |req| {
                            if let Ok(mut pv) = rt_pending.lock() {
                                *pv = Some(PendingApprovalView {
                                    request_id: req.request_id.clone(),
                                    peer_id: req.peer_id.0.clone(),
                                    peer_name: req.peer_display_name.clone(),
                                    requested_scope: req.requested_scope.clone(),
                                    sas_6digit: req.sas_6digit.clone(),
                                    expires_at: req.expires_at,
                                });
                            }
                            let rx = dec_rx.lock().map_err(|_| JackError::ApprovalTimeout)?;
                            let decision = rx
                                .recv_timeout(Duration::from_secs(60))
                                .unwrap_or(Err(JackError::ApprovalTimeout));
                            if let Ok(mut pv) = rt_pending.lock() {
                                *pv = None;
                            }
                            decision
                        },
                    );

                    match res {
                        Ok((cid, _sas)) => {
                            if let Ok(mut p) = rt_paired.lock() {
                                *p = Some(cid.0);
                            }
                        }
                        Err(e) => {
                            if let Ok(mut err) = rt_err.lock() {
                                *err = Some(e.to_string());
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
    });

    let status = HostShareStatus {
        active: true,
        state: "WaitingForRequest".into(),
        endpoint: Some(endpoint.clone()),
        auth_code: Some(auth_code.clone()),
        expires_at: Some(expires_at),
        pending_request: None,
        paired_peer_id: None,
        paired_peer_name: None,
        error: None,
    };

    let mut guard = state.host.lock().map_err(|_| "host mutex poisoned")?;
    *guard = Some(HostRuntime {
        auth,
        lifecycle,
        approval_gate,
        endpoint,
        auth_code,
        expires_at,
        pending_view,
        decision_tx: Mutex::new(Some(dec_tx)),
        paired_peer_id,
        paired_peer_name,
        last_error,
        host_id,
        started_at,
    });
    Ok(status)
}

pub fn poll_host_status_impl(state: &EasyPairingState) -> Result<HostShareStatus, String> {
    let guard = state.host.lock().map_err(|_| "host mutex poisoned")?;
    let Some(ref rt) = *guard else {
        return Ok(HostShareStatus {
            active: false,
            state: "Stopped".into(),
            endpoint: None,
            auth_code: None,
            expires_at: None,
            pending_request: None,
            paired_peer_id: None,
            paired_peer_name: None,
            error: None,
        });
    };
    let lc_state = rt
        .lifecycle
        .lock()
        .map(|g| format!("{:?}", g.state()))
        .unwrap_or_else(|_| "Unknown".into());
    let pending = rt.pending_view.lock().ok().and_then(|g| g.clone());
    let paired = rt.paired_peer_id.lock().ok().and_then(|g| g.clone());
    let paired_name = rt.paired_peer_name.lock().ok().and_then(|g| g.clone());
    let mut err = rt.last_error.lock().ok().and_then(|g| g.clone());
    if now_unix() > rt.expires_at && paired.is_none() && err.is_none() {
        err = Some("ERR_INVITE_EXPIRED".into());
    }
    Ok(HostShareStatus {
        active: true,
        state: lc_state,
        endpoint: Some(rt.endpoint.clone()),
        auth_code: Some(rt.auth_code.clone()),
        expires_at: Some(rt.expires_at),
        pending_request: pending,
        paired_peer_id: paired,
        paired_peer_name: paired_name,
        error: err,
    })
}

pub fn decide_host_approval_impl(
    state: &EasyPairingState,
    request_id: String,
    approved: bool,
) -> Result<HostShareStatus, String> {
    {
        let guard = state.host.lock().map_err(|_| "host mutex poisoned")?;
        let rt = guard.as_ref().ok_or("Host sharing is not active")?;
        let pending = rt
            .pending_view
            .lock()
            .map_err(|_| "pending mutex poisoned")?
            .clone()
            .ok_or("No pending approval request")?;
        if pending.request_id != request_id {
            return Err("ERR_APPROVAL_MISMATCH: request_id mismatch".into());
        }
        let tx = rt
            .decision_tx
            .lock()
            .map_err(|_| "tx mutex poisoned")?
            .as_ref()
            .cloned()
            .ok_or("ERR_APPROVAL_REPLAY: decision channel closed")?;
        if let Ok(mut pv) = rt.pending_view.lock() {
            *pv = None;
        }
        // Build decision using the real pending ApprovalRequest stored in ApprovalGate!
        let gate_guard = rt.approval_gate.lock().map_err(|_| "gate mutex poisoned")?;
        let decision = if approved {
            ApprovalDecision {
                request_id: request_id.clone(),
                invite_id: gate_guard
                    .pending_invite_id()
                    .ok_or("No pending approval in gate")?,
                peer_id: DeviceId::parse(&pending.peer_id).map_err(|e| e.to_string())?,
                approved: true,
                granted_duration: DurationPolicy::SessionOnly,
            }
        } else {
            ApprovalDecision {
                request_id,
                invite_id: gate_guard
                    .pending_invite_id()
                    .ok_or("No pending approval in gate")?,
                peer_id: DeviceId::parse(&pending.peer_id).map_err(|e| e.to_string())?,
                approved: false,
                granted_duration: DurationPolicy::SessionOnly,
            }
        };
        if approved {
            if let Ok(mut pn) = rt.paired_peer_name.lock() {
                *pn = Some(pending.peer_name.clone());
            }
        }
        let _ = tx.send(Ok(decision));
    }
    thread::sleep(Duration::from_millis(30));
    poll_host_status_impl(state)
}

pub fn revoke_host_peer_impl(state: &EasyPairingState, peer_id: String) -> Result<(), String> {
    let guard = state.host.lock().map_err(|_| "host mutex poisoned")?;
    let rt = guard.as_ref().ok_or("Host sharing is not active")?;
    let pid = DeviceId::parse(&peer_id).map_err(|e| e.to_string())?;
    rt.auth.revoke_peer(&pid).map_err(|e| e.to_string())?;
    let _ = (&rt.host_id, rt.started_at);
    Ok(())
}

pub fn stop_host_sharing_impl(state: &EasyPairingState) -> Result<(), String> {
    let mut guard = state.host.lock().map_err(|_| "host mutex poisoned")?;
    if let Some(rt) = guard.take() {
        if let Ok(mut tx_opt) = rt.decision_tx.lock() {
            if let Some(tx) = tx_opt.take() {
                let _ = tx.send(Err(JackError::ApprovalDenied));
            }
        }
        rt.auth.shutdown_all_sessions();
        if let Ok(mut lc) = rt.lifecycle.lock() {
            let _ = lc.stop();
        }
    }
    Ok(())
}

pub fn start_client_pairing_impl(
    state: &EasyPairingState,
    endpoint_raw: String,
    auth_code_raw: String,
    client_name: String,
) -> Result<ClientPairingStatus, String> {
    let _ = client_disconnect_impl(state);
    let addr: SocketAddr = endpoint_raw
        .trim()
        .parse()
        .map_err(|_| "ERR_INVALID_INPUT: invalid host address".to_string())?;
    ensure_lan_or_loopback(addr).map_err(|e| e.to_string())?;
    let _ = normalize_crockford_code(&auth_code_raw).map_err(|e| e.to_string())?;

    let ep_home = match &state.ep_home_override {
        Some(path) => path.clone(),
        None => resolve_ep_home()?,
    };
    let ks = platform_keystore(&ep_home.join("keystore"));
    let client_id = Arc::new(ks.load_or_create("client").map_err(|e| e.to_string())?);

    let (sas_tx, sas_rx) = mpsc::channel::<bool>();
    let stage = Arc::new(Mutex::new("Connecting".to_string()));
    let sas_6digit = Arc::new(Mutex::new(None));
    let host_id_arc = Arc::new(Mutex::new(None));
    let host_pk_arc = Arc::new(Mutex::new(None));
    let last_status = Arc::new(Mutex::new(None));
    let last_error = Arc::new(Mutex::new(None));

    let t_stage = stage.clone();
    let t_sas = sas_6digit.clone();
    let t_hid = host_id_arc.clone();
    let t_hpk = host_pk_arc.clone();
    let t_st = last_status.clone();
    let t_err = last_error.clone();
    let t_cid = client_id.clone();

    thread::spawn(move || {
        let sas_rx = Mutex::new(sas_rx);
        let pair_res =
            client_pair_with_code(addr, &t_cid, &client_name, &auth_code_raw, None, |sas| {
                if let Ok(mut s) = t_sas.lock() {
                    *s = Some(sas.to_string());
                }
                if let Ok(mut st) = t_stage.lock() {
                    *st = "VerifySas".into();
                }
                sas_rx
                    .lock()
                    .ok()
                    .and_then(|rx| rx.recv_timeout(Duration::from_secs(60)).ok())
                    .unwrap_or(false)
            });

        match pair_res {
            Ok((hid, hpk, _sas)) => {
                if let Ok(mut h) = t_hid.lock() {
                    *h = Some(hid.0);
                }
                if let Ok(mut p) = t_hpk.lock() {
                    *p = Some(hpk);
                }
                match client_invoke_capability(addr, &t_cid, hpk, "status.read") {
                    Ok(status_resp) => {
                        if let Ok(mut s) = t_st.lock() {
                            *s = Some(status_resp);
                        }
                        if let Ok(mut st) = t_stage.lock() {
                            *st = "Connected".into();
                        }
                    }
                    Err(e) => {
                        if let Ok(mut err) = t_err.lock() {
                            *err = Some(e.to_string());
                        }
                        if let Ok(mut st) = t_stage.lock() {
                            *st = "Error".into();
                        }
                    }
                }
            }
            Err(e) => {
                if let Ok(mut err) = t_err.lock() {
                    *err = Some(e.to_string());
                }
                if let Ok(mut st) = t_stage.lock() {
                    *st = "Error".into();
                }
            }
        }
    });

    {
        let mut guard = state.client.lock().map_err(|_| "client mutex poisoned")?;
        *guard = Some(ClientRuntime {
            stage,
            sas_6digit,
            sas_tx: Mutex::new(Some(sas_tx)),
            host_id: host_id_arc,
            host_pk: host_pk_arc,
            endpoint: Some(addr),
            client_id,
            last_status,
            last_error,
        });
    }

    // Wait briefly (up to 500ms) for TLS + SPAKE2 to compute SAS
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(25));
        let st = poll_client_status_impl(state)?;
        if st.stage == "VerifySas" || st.stage == "Error" {
            return Ok(st);
        }
    }
    poll_client_status_impl(state)
}

pub fn confirm_client_sas_impl(
    state: &EasyPairingState,
    confirmed: bool,
) -> Result<ClientPairingStatus, String> {
    {
        let guard = state.client.lock().map_err(|_| "client mutex poisoned")?;
        let rt = guard.as_ref().ok_or("No active client pairing")?;
        if let Ok(mut st) = rt.stage.lock() {
            if confirmed {
                *st = "WaitingApproval".into();
            }
        }
        let tx = rt
            .sas_tx
            .lock()
            .map_err(|_| "sas_tx mutex poisoned")?
            .take()
            .ok_or("SAS decision already submitted")?;
        let _ = tx.send(confirmed);
    }
    thread::sleep(Duration::from_millis(50));
    poll_client_status_impl(state)
}

pub fn poll_client_status_impl(state: &EasyPairingState) -> Result<ClientPairingStatus, String> {
    let guard = state.client.lock().map_err(|_| "client mutex poisoned")?;
    let Some(ref rt) = *guard else {
        return Ok(ClientPairingStatus {
            stage: "Idle".into(),
            sas_6digit: None,
            host_id: None,
            status_read: None,
            error: None,
        });
    };
    Ok(ClientPairingStatus {
        stage: rt
            .stage
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "Idle".into()),
        sas_6digit: rt.sas_6digit.lock().ok().and_then(|g| g.clone()),
        host_id: rt.host_id.lock().ok().and_then(|g| g.clone()),
        status_read: rt.last_status.lock().ok().and_then(|g| g.clone()),
        error: rt.last_error.lock().ok().and_then(|g| g.clone()),
    })
}

pub fn client_read_status_impl(state: &EasyPairingState) -> Result<StatusReadResponse, String> {
    let guard = state.client.lock().map_err(|_| "client mutex poisoned")?;
    let rt = guard.as_ref().ok_or("Not connected")?;
    let addr = rt.endpoint.ok_or("No host endpoint")?;
    let hpk = rt
        .host_pk
        .lock()
        .map_err(|_| "pk mutex poisoned")?
        .ok_or("Host not paired")?;
    match client_invoke_capability(addr, &rt.client_id, hpk, "status.read") {
        Ok(resp) => {
            if let Ok(mut st) = rt.last_status.lock() {
                *st = Some(resp.clone());
            }
            Ok(resp)
        }
        Err(e) => {
            let msg = e.to_string();
            // Fail closed so a revoked or dropped session never remains "Connected".
            if let Ok(mut st) = rt.stage.lock() {
                *st = "Error".into();
            }
            if let Ok(mut err) = rt.last_error.lock() {
                *err = Some(msg.clone());
            }
            Err(msg)
        }
    }
}

pub fn client_disconnect_impl(state: &EasyPairingState) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|_| "client mutex poisoned")?;
    if let Some(rt) = guard.take() {
        if let Ok(mut tx_opt) = rt.sas_tx.lock() {
            if let Some(tx) = tx_opt.take() {
                let _ = tx.send(false);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tauri_ipc_host_client_pair_sas_approve_status_revoke_and_non_loopback() {
        let tmp_dir = std::env::temp_dir().join(format!("jack-ep004-ipc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let state = EasyPairingState::with_ep_home(tmp_dir.clone());

        // Public / wildcard addresses rejected immediately; private LAN allowed
        assert!(start_client_pairing_impl(
            &state,
            "8.8.8.8:9999".into(),
            "ABCD-EFGH".into(),
            "client".into()
        )
        .is_err());
        assert!(start_host_sharing_impl(&state, Some("0.0.0.0".into())).is_err());
        assert!(start_host_sharing_impl(&state, Some("8.8.8.8".into())).is_err());

        // Host starts sharing
        let h_status = start_host_sharing_impl(&state, None).unwrap();
        assert!(h_status.active);
        let endpoint = h_status.endpoint.unwrap();
        let code = h_status.auth_code.unwrap();

        // Wrong code fails closed
        let wrong = start_client_pairing_impl(
            &state,
            endpoint.clone(),
            "ZZZZ-ZZZZ".into(),
            "client".into(),
        )
        .unwrap();
        assert_eq!(wrong.stage, "Error");
        client_disconnect_impl(&state).unwrap();

        // Valid code reaches VerifySas with real 6-digit SAS
        let c_sas =
            start_client_pairing_impl(&state, endpoint, code, "linux-client".into()).unwrap();
        assert_eq!(c_sas.stage, "VerifySas");
        let sas_val = c_sas.sas_6digit.clone().unwrap();
        assert_eq!(sas_val.len(), 7);

        // Client confirms SAS -> Host sees pending_request with matching SAS
        let _ = confirm_client_sas_impl(&state, true).unwrap();
        let mut pending = None;
        for _ in 0..80 {
            let poll = poll_host_status_impl(&state).unwrap();
            if poll.pending_request.is_some() {
                pending = poll.pending_request;
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let req = pending.expect("host must see pending approval request");
        assert_eq!(req.sas_6digit, sas_val);
        assert_eq!(req.requested_scope, "status.read");

        // Host approves -> Client reaches Connected + status.read works
        let mut after_approve = decide_host_approval_impl(&state, req.request_id, true).unwrap();
        for _ in 0..80 {
            if after_approve.paired_peer_id.is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(25));
            after_approve = poll_host_status_impl(&state).unwrap();
        }
        let paired_id = after_approve
            .paired_peer_id
            .clone()
            .unwrap_or_else(|| panic!("paired_peer_id not set; after_approve={after_approve:?}"));

        let mut c_poll = poll_client_status_impl(&state).unwrap();
        for _ in 0..80 {
            if c_poll.stage == "Connected" {
                break;
            }
            thread::sleep(Duration::from_millis(25));
            c_poll = poll_client_status_impl(&state).unwrap();
        }
        assert_eq!(c_poll.stage, "Connected");
        assert_eq!(c_poll.status_read.unwrap().status, "ok");

        // Subsequent status.read succeeds
        assert_eq!(client_read_status_impl(&state).unwrap().status, "ok");

        // Host revokes peer -> subsequent status.read fails and client fails closed
        revoke_host_peer_impl(&state, paired_id).unwrap();
        assert!(client_read_status_impl(&state).is_err());
        let c_after_revoke = poll_client_status_impl(&state).unwrap();
        assert_eq!(c_after_revoke.stage, "Error");
        assert!(c_after_revoke.error.is_some());

        client_disconnect_impl(&state).unwrap();
        stop_host_sharing_impl(&state).unwrap();
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn tauri_ipc_slow_human_sas_beyond_5s_io_timeout_succeeds() {
        let tmp_dir =
            std::env::temp_dir().join(format!("jack-ep004-slow-sas-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let state = EasyPairingState::with_ep_home(tmp_dir.clone());
        let h_status = start_host_sharing_impl(&state, None).unwrap();
        let endpoint = h_status.endpoint.unwrap();
        let code = h_status.auth_code.unwrap();

        let c_sas =
            start_client_pairing_impl(&state, endpoint, code, "slow-human-client".into()).unwrap();
        assert_eq!(c_sas.stage, "VerifySas");
        let client_sas = c_sas.sas_6digit.clone().unwrap();

        // Simulate human reading SAS for 5.5 seconds (> 5s IO_TIMEOUT) before confirming
        thread::sleep(Duration::from_millis(5500));

        // Host must NOT have failed with ERR_IO (os error 11 / WouldBlock)
        let host_mid = poll_host_status_impl(&state).unwrap();
        assert!(
            host_mid.error.is_none(),
            "host failed during human SAS wait: {:?}",
            host_mid.error
        );

        let _ = confirm_client_sas_impl(&state, true).unwrap();
        let mut pending = None;
        for _ in 0..80 {
            let poll = poll_host_status_impl(&state).unwrap();
            if poll.pending_request.is_some() {
                pending = poll.pending_request;
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let req = pending.expect("host must see pending approval after >5s SAS wait");
        assert_eq!(req.sas_6digit, client_sas);

        let _ = decide_host_approval_impl(&state, req.request_id, true).unwrap();
        let mut c_poll = poll_client_status_impl(&state).unwrap();
        for _ in 0..80 {
            if c_poll.stage == "Connected" {
                break;
            }
            thread::sleep(Duration::from_millis(25));
            c_poll = poll_client_status_impl(&state).unwrap();
        }
        assert_eq!(c_poll.stage, "Connected");
        assert_eq!(c_poll.status_read.unwrap().status, "ok");

        client_disconnect_impl(&state).unwrap();
        stop_host_sharing_impl(&state).unwrap();
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn tauri_ipc_sas_mismatch_and_host_denial_paths() {
        let tmp_dir =
            std::env::temp_dir().join(format!("jack-ep004-mismatch-deny-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let state = EasyPairingState::with_ep_home(tmp_dir.clone());
        let h_status = start_host_sharing_impl(&state, None).unwrap();
        let endpoint = h_status.endpoint.unwrap();
        let code = h_status.auth_code.unwrap();

        // 1) Client rejects SAS ("Codes Don't Match") -> Client enters Error, never Connected
        let c_sas =
            start_client_pairing_impl(&state, endpoint.clone(), code.clone(), "client-1".into())
                .unwrap();
        assert_eq!(c_sas.stage, "VerifySas");
        let _ = confirm_client_sas_impl(&state, false).unwrap();
        let mut c_poll = poll_client_status_impl(&state).unwrap();
        for _ in 0..40 {
            if c_poll.stage == "Error" {
                break;
            }
            thread::sleep(Duration::from_millis(20));
            c_poll = poll_client_status_impl(&state).unwrap();
        }
        assert_eq!(c_poll.stage, "Error");
        client_disconnect_impl(&state).unwrap();

        // 2) Second attempt on same Host -> Client confirms SAS -> Host Denies -> Client Error
        let c_sas2 = start_client_pairing_impl(&state, endpoint, code, "client-2".into()).unwrap();
        assert_eq!(c_sas2.stage, "VerifySas");
        let _ = confirm_client_sas_impl(&state, true).unwrap();

        let mut pending = None;
        for _ in 0..80 {
            let poll = poll_host_status_impl(&state).unwrap();
            if poll.pending_request.is_some() {
                pending = poll.pending_request;
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let req = pending.expect("host must see pending approval on second attempt");
        let _ = decide_host_approval_impl(&state, req.request_id, false).unwrap();

        let mut c_poll2 = poll_client_status_impl(&state).unwrap();
        for _ in 0..80 {
            if c_poll2.stage == "Error" {
                break;
            }
            thread::sleep(Duration::from_millis(25));
            c_poll2 = poll_client_status_impl(&state).unwrap();
        }
        assert_eq!(c_poll2.stage, "Error");
        assert!(c_poll2
            .error
            .unwrap_or_default()
            .contains("ERR_APPROVAL_DENIED"));

        client_disconnect_impl(&state).unwrap();
        stop_host_sharing_impl(&state).unwrap();
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
