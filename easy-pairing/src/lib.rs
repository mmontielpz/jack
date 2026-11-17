//! Experimental JACK Easy Pairing (EP-003) — isolated Host authorization & session prototype.
//! Not externally cryptographically audited.

pub mod approval;
pub mod auth;
pub mod error;
pub mod host_service;
pub mod identity;
pub mod pairing;
pub mod status_cap;
pub mod transport;

use crate::approval::{ApprovalDecision, ApprovalGate, ApprovalRequest};
use crate::auth::{now_unix, AuthStore, DurationPolicy};
use crate::error::JackError;
use crate::host_service::{HostLifecycle, HostState};
use crate::identity::{DeviceId, DeviceIdentity};
use crate::pairing::{
    build_channel_transcript, compute_confirm_mac, derive_channel_bound_keys,
    normalize_crockford_code, start_spake2_client, start_spake2_host, verify_confirm_mac,
    PairingInvitation, PROTOCOL_VERSION,
};
use crate::status_cap::{execute_capability, StatusReadResponse};
use crate::transport::{
    build_tls13_pairing_client_config, build_tls13_pairing_server_config,
    build_tls13_pinned_client_config, build_tls13_pinned_server_config, configure_stream_timeouts,
    ensure_loopback, export_tls_channel_binding, read_bounded_frame, write_bounded_frame,
    ALPN_PAIR_V1,
};
use rustls::{ClientConnection, ServerConnection, StreamOwned};
use rustls_pki_types::ServerName;
use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use subtle::ConstantTimeEq;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirePairHello {
    pub version: u8,
    pub client_name: String,
    pub spake_msg_a: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirePairChallenge {
    pub version: u8,
    pub invite_id: [u8; 16],
    pub spake_msg_b: Vec<u8>,
    pub host_confirm_mac: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirePairConfirm {
    pub client_confirm_mac: [u8; 32],
    pub requested_scope: String,
    pub requested_duration: DurationPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirePairResult {
    pub approved: bool,
    pub error_code: Option<String>,
    pub sas_6digit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireCapRequest {
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireCapResponse {
    pub ok: bool,
    pub status: Option<StatusReadResponse>,
    pub error_code: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn host_handle_pairing_connection(
    tcp: TcpStream,
    peer_addr: SocketAddr,
    host_id: &DeviceIdentity,
    invite: &mut PairingInvitation,
    auth: &AuthStore,
    lifecycle: &Mutex<HostLifecycle>,
    approval_gate: &Mutex<ApprovalGate>,
    decision_fn: impl FnOnce(&ApprovalRequest) -> Result<ApprovalDecision, JackError>,
) -> Result<(DeviceId, String), JackError> {
    ensure_loopback(peer_addr)?;
    configure_stream_timeouts(&tcp)?;

    {
        let mut lc = lifecycle
            .lock()
            .map_err(|_| JackError::InvalidHostState("lifecycle mutex poisoned".into()))?;
        if lc.is_shutting_down() {
            return Err(JackError::HostShuttingDown);
        }
        lc.transition(HostState::Pairing)?;
    }

    let outer_res = (|| -> Result<(DeviceId, String), JackError> {
        let observed_client_pk = Arc::new(Mutex::new(None));
        let server_cfg = build_tls13_pairing_server_config(host_id, observed_client_pk.clone())?;
        let tls_conn =
            ServerConnection::new(server_cfg).map_err(|e| JackError::Io(e.to_string()))?;
        let mut stream = StreamOwned::new(tls_conn, tcp);

        let hello_bytes = read_bounded_frame(&mut stream)?;
        if stream.conn.alpn_protocol() != Some(ALPN_PAIR_V1) {
            return Err(JackError::ProtocolVersion("ALPN mismatch".into()));
        }
        let tls_cb = export_tls_channel_binding(&stream.conn)?;
        let client_pk = observed_client_pk
            .lock()
            .map_err(|_| JackError::Io("pk mutex poisoned".into()))?
            .ok_or(JackError::PakeBindingFailed)?;

        let hello: WirePairHello = serde_json::from_slice(&hello_bytes)
            .map_err(|e| JackError::InvalidInput(e.to_string()))?;
        if hello.version != PROTOCOL_VERSION {
            return Err(JackError::ProtocolVersion(format!(
                "unsupported hello version {}",
                hello.version
            )));
        }

        invite.begin_attempt(now_unix())?;

        let attempt_res = (|| -> Result<(DeviceId, String), JackError> {
            let secret = invite.code_secret_bytes();
            let (spake_b, msg_b) = start_spake2_host(&secret);
            let shared = spake_b
                .finish(&hello.spake_msg_a)
                .map_err(|_| JackError::PakeBindingFailed)?;

            let transcript = build_channel_transcript(
                &invite.invite_id,
                &host_id.public_key_bytes(),
                &client_pk,
                &tls_cb,
            );
            let keys = derive_channel_bound_keys(&shared, &tls_cb, &transcript)?;
            let host_mac =
                compute_confirm_mac(keys.confirm_key_bytes(), b"host-confirm", &transcript);

            let challenge = WirePairChallenge {
                version: PROTOCOL_VERSION,
                invite_id: invite.invite_id,
                spake_msg_b: msg_b,
                host_confirm_mac: host_mac,
            };
            let challenge_bytes =
                serde_json::to_vec(&challenge).map_err(|e| JackError::Io(e.to_string()))?;
            write_bounded_frame(&mut stream, &challenge_bytes)?;

            let confirm_bytes = read_bounded_frame(&mut stream)?;
            let confirm: WirePairConfirm = serde_json::from_slice(&confirm_bytes)
                .map_err(|e| JackError::InvalidInput(e.to_string()))?;

            if verify_confirm_mac(
                keys.confirm_key_bytes(),
                b"client-confirm",
                &transcript,
                &confirm.client_confirm_mac,
            )
            .is_err()
            {
                let deny = WirePairResult {
                    approved: false,
                    error_code: Some("ERR_PAKE_BINDING_FAILED".into()),
                    sas_6digit: None,
                };
                let _ = write_bounded_frame(
                    &mut stream,
                    &serde_json::to_vec(&deny).unwrap_or_default(),
                );
                return Err(JackError::PakeBindingFailed);
            }

            // Enforce least-privilege scope before asking human
            crate::auth::CapabilityScope::parse(&confirm.requested_scope)?;

            invite.mark_awaiting_approval()?;
            {
                let mut lc = lifecycle
                    .lock()
                    .map_err(|_| JackError::InvalidHostState("lifecycle mutex poisoned".into()))?;
                if lc.is_shutting_down() {
                    return Err(JackError::HostShuttingDown);
                }
                lc.transition(HostState::Authorizing)?;
            }

            let client_device_id = DeviceId::from_pubkey(&client_pk);
            let approval_req = {
                let mut gate = approval_gate
                    .lock()
                    .map_err(|_| JackError::InvalidHostState("approval mutex poisoned".into()))?;
                gate.open_request(
                    invite.invite_id,
                    client_device_id.clone(),
                    hello.client_name.clone(),
                    confirm.requested_scope.clone(),
                    confirm.requested_duration,
                    keys.sas_6digit.clone(),
                    60,
                    now_unix(),
                )?
            };

            let decision = match decision_fn(&approval_req) {
                Ok(d) => d,
                Err(e) => {
                    if let Ok(mut gate) = approval_gate.lock() {
                        gate.cancel_pending();
                    }
                    let err_res = WirePairResult {
                        approved: false,
                        error_code: Some(e.code().to_string()),
                        sas_6digit: None,
                    };
                    let _ = write_bounded_frame(
                        &mut stream,
                        &serde_json::to_vec(&err_res).unwrap_or_default(),
                    );
                    return Err(e);
                }
            };

            let granted_duration = {
                let mut gate = approval_gate
                    .lock()
                    .map_err(|_| JackError::InvalidHostState("approval mutex poisoned".into()))?;
                match gate.resolve(&decision, now_unix()) {
                    Ok(dur) => dur,
                    Err(e) => {
                        if e == JackError::ApprovalDenied {
                            let _ = invite.mark_denied();
                        }
                        let err_res = WirePairResult {
                            approved: false,
                            error_code: Some(e.code().to_string()),
                            sas_6digit: None,
                        };
                        let _ = write_bounded_frame(
                            &mut stream,
                            &serde_json::to_vec(&err_res).unwrap_or_default(),
                        );
                        return Err(e);
                    }
                }
            };

            auth.approve_and_persist(
                client_device_id.clone(),
                hello.client_name,
                client_pk,
                granted_duration,
            )?;
            invite.mark_authorized()?;
            {
                let mut lc = lifecycle
                    .lock()
                    .map_err(|_| JackError::InvalidHostState("lifecycle mutex poisoned".into()))?;
                if !lc.is_shutting_down() {
                    let _ = lc.transition(HostState::Active);
                }
            }

            let ok_res = WirePairResult {
                approved: true,
                error_code: None,
                sas_6digit: Some(keys.sas_6digit.clone()),
            };
            write_bounded_frame(
                &mut stream,
                &serde_json::to_vec(&ok_res).map_err(|e| JackError::Io(e.to_string()))?,
            )?;

            Ok((client_device_id, keys.sas_6digit))
        })();

        if attempt_res.is_err()
            && !invite.consumed
            && !matches!(invite.state, crate::pairing::PairingState::Denied)
        {
            invite.record_failed_attempt();
        }
        attempt_res
    })();

    if outer_res.is_err() {
        if let Ok(mut lc) = lifecycle.lock() {
            if !lc.is_shutting_down() {
                let _ = lc.transition(HostState::Ready);
            }
        }
    }
    outer_res
}

pub fn client_pair_with_code(
    addr: SocketAddr,
    client_id: &DeviceIdentity,
    client_name: &str,
    raw_code: &str,
    expected_host_pk: Option<[u8; 32]>,
    sas_verify_fn: impl FnOnce(&str) -> bool,
) -> Result<(DeviceId, [u8; 32], String), JackError> {
    ensure_loopback(addr)?;
    let norm_code = normalize_crockford_code(raw_code)?;
    let tcp = TcpStream::connect_timeout(&addr, crate::transport::IO_TIMEOUT)
        .map_err(|e| JackError::HostUnreachable(e.to_string()))?;
    configure_stream_timeouts(&tcp)?;

    let observed_host_pk = Arc::new(Mutex::new(None));
    let client_cfg =
        build_tls13_pairing_client_config(client_id, expected_host_pk, observed_host_pk.clone())?;
    let server_name = ServerName::try_from("localhost")
        .map_err(|_| JackError::InvalidInput("invalid server name".into()))?;
    let tls_conn =
        ClientConnection::new(client_cfg, server_name).map_err(|e| JackError::Io(e.to_string()))?;
    let mut stream = StreamOwned::new(tls_conn, tcp);

    let (spake_a, msg_a) = start_spake2_client(norm_code.as_bytes());
    let hello = WirePairHello {
        version: PROTOCOL_VERSION,
        client_name: client_name.to_string(),
        spake_msg_a: msg_a,
    };
    write_bounded_frame(
        &mut stream,
        &serde_json::to_vec(&hello).map_err(|e| JackError::Io(e.to_string()))?,
    )?;

    let challenge_bytes = read_bounded_frame(&mut stream)?;
    if stream.conn.alpn_protocol() != Some(ALPN_PAIR_V1) {
        return Err(JackError::ProtocolVersion("ALPN mismatch".into()));
    }
    let tls_cb = export_tls_channel_binding(&stream.conn)?;
    let host_pk = observed_host_pk
        .lock()
        .map_err(|_| JackError::Io("pk mutex poisoned".into()))?
        .ok_or(JackError::PakeBindingFailed)?;

    let challenge: WirePairChallenge = serde_json::from_slice(&challenge_bytes)
        .map_err(|e| JackError::InvalidInput(e.to_string()))?;
    if challenge.version != PROTOCOL_VERSION {
        return Err(JackError::ProtocolVersion(format!(
            "unsupported challenge version {}",
            challenge.version
        )));
    }

    let shared = spake_a
        .finish(&challenge.spake_msg_b)
        .map_err(|_| JackError::PakeBindingFailed)?;
    let transcript = build_channel_transcript(
        &challenge.invite_id,
        &host_pk,
        &client_id.public_key_bytes(),
        &tls_cb,
    );
    let keys = derive_channel_bound_keys(&shared, &tls_cb, &transcript)?;
    verify_confirm_mac(
        keys.confirm_key_bytes(),
        b"host-confirm",
        &transcript,
        &challenge.host_confirm_mac,
    )?;

    if !sas_verify_fn(&keys.sas_6digit) {
        return Err(JackError::SasMismatch);
    }

    let client_mac = compute_confirm_mac(keys.confirm_key_bytes(), b"client-confirm", &transcript);
    let confirm = WirePairConfirm {
        client_confirm_mac: client_mac,
        requested_scope: "status.read".into(),
        requested_duration: DurationPolicy::SessionOnly,
    };
    write_bounded_frame(
        &mut stream,
        &serde_json::to_vec(&confirm).map_err(|e| JackError::Io(e.to_string()))?,
    )?;

    let res_bytes = read_bounded_frame(&mut stream)?;
    let res: WirePairResult =
        serde_json::from_slice(&res_bytes).map_err(|e| JackError::InvalidInput(e.to_string()))?;
    if !res.approved {
        return Err(match res.error_code.as_deref() {
            Some("ERR_APPROVAL_DENIED") => JackError::ApprovalDenied,
            Some("ERR_APPROVAL_TIMEOUT") => JackError::ApprovalTimeout,
            Some("ERR_APPROVAL_MISMATCH") => JackError::ApprovalMismatch,
            Some("ERR_APPROVAL_REPLAY") => JackError::ApprovalReplay,
            Some("ERR_PAKE_BINDING_FAILED") => JackError::PakeBindingFailed,
            _ => JackError::ApprovalDenied,
        });
    }

    // Verify Host's returned SAS matches in constant time
    if let Some(ref host_sas) = res.sas_6digit {
        if !bool::from(host_sas.as_bytes().ct_eq(keys.sas_6digit.as_bytes())) {
            return Err(JackError::SasMismatch);
        }
    }

    Ok((DeviceId::from_pubkey(&host_pk), host_pk, keys.sas_6digit))
}

pub fn host_serve_capability_once(
    tcp: TcpStream,
    peer_addr: SocketAddr,
    host_id: &DeviceIdentity,
    expected_client_pk: [u8; 32],
    auth: &AuthStore,
    lifecycle: &Mutex<HostLifecycle>,
    started_at: Instant,
) -> Result<(), JackError> {
    ensure_loopback(peer_addr)?;
    configure_stream_timeouts(&tcp)?;
    {
        let lc = lifecycle
            .lock()
            .map_err(|_| JackError::InvalidHostState("lifecycle mutex poisoned".into()))?;
        if lc.is_shutting_down() {
            return Err(JackError::HostShuttingDown);
        }
    }

    let client_device_id = DeviceId::from_pubkey(&expected_client_pk);
    let session = auth.register_session(&client_device_id)?;

    let serve_res = (|| -> Result<(), JackError> {
        let server_cfg = build_tls13_pinned_server_config(host_id, expected_client_pk)?;
        let tls_conn =
            ServerConnection::new(server_cfg).map_err(|e| JackError::Io(e.to_string()))?;
        let mut stream = StreamOwned::new(tls_conn, tcp);

        let req_bytes = read_bounded_frame(&mut stream)?;
        let req: WireCapRequest = serde_json::from_slice(&req_bytes)
            .map_err(|e| JackError::InvalidInput(e.to_string()))?;

        let resp = match execute_capability(
            auth,
            &client_device_id,
            Some(&session.session_id),
            &req.scope,
            started_at,
        ) {
            Ok(st) => WireCapResponse {
                ok: true,
                status: Some(st),
                error_code: None,
            },
            Err(e) => WireCapResponse {
                ok: false,
                status: None,
                error_code: Some(e.code().to_string()),
            },
        };
        write_bounded_frame(
            &mut stream,
            &serde_json::to_vec(&resp).map_err(|e| JackError::Io(e.to_string()))?,
        )?;
        Ok(())
    })();

    auth.close_session(&session.session_id);
    serve_res
}

pub fn client_invoke_capability(
    addr: SocketAddr,
    client_id: &DeviceIdentity,
    expected_host_pk: [u8; 32],
    scope: &str,
) -> Result<StatusReadResponse, JackError> {
    ensure_loopback(addr)?;
    let tcp = TcpStream::connect_timeout(&addr, crate::transport::IO_TIMEOUT)
        .map_err(|e| JackError::HostUnreachable(e.to_string()))?;
    configure_stream_timeouts(&tcp)?;

    let client_cfg = build_tls13_pinned_client_config(client_id, expected_host_pk)?;
    let server_name = ServerName::try_from("localhost")
        .map_err(|_| JackError::InvalidInput("invalid server name".into()))?;
    let tls_conn =
        ClientConnection::new(client_cfg, server_name).map_err(|e| JackError::Io(e.to_string()))?;
    let mut stream = StreamOwned::new(tls_conn, tcp);

    let req = WireCapRequest {
        scope: scope.to_string(),
    };
    write_bounded_frame(
        &mut stream,
        &serde_json::to_vec(&req).map_err(|e| JackError::Io(e.to_string()))?,
    )?;

    let resp_bytes = read_bounded_frame(&mut stream)?;
    let resp: WireCapResponse =
        serde_json::from_slice(&resp_bytes).map_err(|e| JackError::InvalidInput(e.to_string()))?;
    if let Some(st) = resp.status {
        if resp.ok {
            return Ok(st);
        }
    }
    Err(match resp.error_code.as_deref() {
        Some("ERR_SCOPE_DENIED") => JackError::ScopeDenied(scope.to_string()),
        Some("ERR_TRUST_REVOKED") => JackError::TrustRevoked,
        Some("ERR_GRANT_EXPIRED") => JackError::GrantExpired,
        Some("ERR_SESSION_IDLE_TIMEOUT") => JackError::SessionIdleTimeout,
        Some("ERR_SESSION_LIMIT_REACHED") => JackError::SessionLimitReached,
        other => JackError::ScopeDenied(other.unwrap_or("ERR_UNKNOWN").to_string()),
    })
}
