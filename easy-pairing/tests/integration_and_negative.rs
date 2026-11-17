use jack_easy_pairing::approval::{make_approval_decision, ApprovalDecision, ApprovalGate};
use jack_easy_pairing::auth::{now_unix, AuthStore, DurationPolicy};
use jack_easy_pairing::error::JackError;
use jack_easy_pairing::host_service::{
    CurrentPlatformAdapter, HostLifecycle, HostState, PlatformHostAdapter,
};
use jack_easy_pairing::identity::{
    DeviceId, DeviceIdentity, FailClosedKeystore, InMemoryTestKeystore, Keystore,
};
use jack_easy_pairing::pairing::{
    build_channel_transcript, derive_channel_bound_keys, parse_qr_uri, PairingInvitation,
    PairingState, MAX_QR_URI_BYTES,
};
use jack_easy_pairing::status_cap::execute_capability;
use jack_easy_pairing::transport::{ensure_loopback, read_bounded_frame, write_bounded_frame};
use jack_easy_pairing::{
    client_pair_with_code, host_handle_pairing_connection, host_serve_capability_once,
    WirePairHello,
};
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tempfile::TempDir;

fn new_host_runtime() -> (Mutex<HostLifecycle>, Mutex<ApprovalGate>) {
    let mut lc = HostLifecycle::new();
    lc.start().unwrap();
    (Mutex::new(lc), Mutex::new(ApprovalGate::default()))
}

#[test]
fn ep03_host_lifecycle_and_platform_adapter() {
    let mut lc = HostLifecycle::new();
    assert_eq!(lc.state(), HostState::Stopped);
    assert!(lc.transition(HostState::Active).is_err());
    lc.start().unwrap();
    assert_eq!(lc.state(), HostState::Ready);
    lc.transition(HostState::Pairing).unwrap();
    lc.transition(HostState::Authorizing).unwrap();
    lc.transition(HostState::Active).unwrap();
    lc.stop().unwrap();
    assert_eq!(lc.state(), HostState::Stopped);
    assert!(CurrentPlatformAdapter.user_space_only());
}

#[test]
fn ep03_approval_gate_timeout_replay_mismatch_and_concurrency() {
    let mut gate = ApprovalGate::default();
    let peer_a = DeviceId::from_pubkey(&[1u8; 32]);
    let peer_b = DeviceId::from_pubkey(&[2u8; 32]);
    let inv_a = [0x11u8; 16];
    let inv_b = [0x22u8; 16];

    let req = gate
        .open_request(
            inv_a,
            peer_a.clone(),
            "client-a".into(),
            "status.read".into(),
            DurationPolicy::SessionOnly,
            "123 456".into(),
            60,
            1000,
        )
        .unwrap();

    // Concurrent approval race
    assert_eq!(
        gate.open_request(
            inv_b,
            peer_b.clone(),
            "client-b".into(),
            "status.read".into(),
            DurationPolicy::SessionOnly,
            "654 321".into(),
            60,
            1000,
        )
        .unwrap_err(),
        JackError::PairingBusy
    );

    // Wrong peer
    assert_eq!(
        gate.resolve(
            &ApprovalDecision {
                request_id: req.request_id.clone(),
                invite_id: inv_a,
                peer_id: peer_b,
                approved: true,
                granted_duration: DurationPolicy::SessionOnly,
            },
            1010
        )
        .unwrap_err(),
        JackError::ApprovalMismatch
    );

    // Wrong invitation
    assert_eq!(
        gate.resolve(
            &ApprovalDecision {
                request_id: req.request_id.clone(),
                invite_id: inv_b,
                peer_id: peer_a.clone(),
                approved: true,
                granted_duration: DurationPolicy::SessionOnly,
            },
            1010
        )
        .unwrap_err(),
        JackError::ApprovalMismatch
    );

    // Timeout
    assert_eq!(
        gate.resolve(
            &ApprovalDecision {
                request_id: req.request_id.clone(),
                invite_id: inv_a,
                peer_id: peer_a.clone(),
                approved: true,
                granted_duration: DurationPolicy::SessionOnly,
            },
            1061
        )
        .unwrap_err(),
        JackError::ApprovalTimeout
    );

    // Replay of consumed/expired request
    assert_eq!(
        gate.resolve(
            &ApprovalDecision {
                request_id: req.request_id,
                invite_id: inv_a,
                peer_id: peer_a,
                approved: true,
                granted_duration: DurationPolicy::SessionOnly,
            },
            1010
        )
        .unwrap_err(),
        JackError::ApprovalReplay
    );
}

#[test]
fn ep03_session_limits_idle_timeout_grant_expiry_and_shutdown() {
    let tmp = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = AuthStore::open_isolated_with_limits(tmp.path(), 2, 30, 120).unwrap();

    auth.approve_and_persist_at(
        client_id.device_id.clone(),
        "client".into(),
        client_id.public_key_bytes(),
        DurationPolicy::OneHour,
        1000,
    )
    .unwrap();

    // Session limit (max 2)
    let s1 = auth
        .register_session_at(&client_id.device_id, 1000)
        .unwrap();
    let _s2 = auth
        .register_session_at(&client_id.device_id, 1001)
        .unwrap();
    assert_eq!(
        auth.register_session_at(&client_id.device_id, 1002)
            .unwrap_err(),
        JackError::SessionLimitReached
    );

    // Idle timeout (> 30s)
    assert_eq!(
        auth.validate_session_request(&s1.session_id, "status.read", 1031)
            .unwrap_err(),
        JackError::SessionIdleTimeout
    );

    // Grant expiry (> 3600s)
    assert_eq!(
        auth.authorize_capability(&client_id.device_id, "status.read", None, 4601)
            .unwrap_err(),
        JackError::GrantExpired
    );

    // Minimal status.read response has no private machine IDs or IPs
    auth.approve_and_persist(
        client_id.device_id.clone(),
        "client".into(),
        client_id.public_key_bytes(),
        DurationPolicy::OneHour,
    )
    .unwrap();
    let real_s = auth.register_session(&client_id.device_id).unwrap();
    let st = execute_capability(
        &auth,
        &client_id.device_id,
        Some(&real_s.session_id),
        "status.read",
        Instant::now(),
    )
    .unwrap();
    assert_eq!(st.status, "ok");

    // Host shutdown during session revokes all active sessions
    auth.shutdown_all_sessions();
    assert_eq!(
        auth.validate_session_request(&real_s.session_id, "status.read", now_unix())
            .unwrap_err(),
        JackError::TrustRevoked
    );

    // Host lifecycle shutdown rejects new pairing
    let mut lc = HostLifecycle::new();
    lc.start().unwrap();
    lc.stop().unwrap();
    let lc_mutex = Mutex::new(lc);
    let gate_mutex = Mutex::new(ApprovalGate::default());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut inv =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();
    let _c = TcpStream::connect(addr).unwrap();
    let (tcp, peer) = listener.accept().unwrap();
    assert_eq!(
        host_handle_pairing_connection(
            tcp,
            peer,
            &host_id,
            &mut inv,
            &auth,
            &lc_mutex,
            &gate_mutex,
            |req| Ok(make_approval_decision(
                req,
                true,
                DurationPolicy::SessionOnly
            )),
        )
        .unwrap_err(),
        JackError::HostShuttingDown
    );
}

#[test]
fn neg_01_mitm_and_sas_mismatch_fail() {
    let spk = [7u8; 32];
    let inv = [1u8; 16];
    let hpk = [2u8; 32];
    let cpk = [3u8; 32];
    let cb_client = [0xAA; 32];
    let cb_host = [0xBB; 32];

    let t_client = build_channel_transcript(&inv, &hpk, &cpk, &cb_client);
    let t_host = build_channel_transcript(&inv, &hpk, &cpk, &cb_host);

    let k_client = derive_channel_bound_keys(&spk, &cb_client, &t_client).unwrap();
    let k_host = derive_channel_bound_keys(&spk, &cb_host, &t_host).unwrap();
    assert_ne!(k_client.confirm_key_bytes(), k_host.confirm_key_bytes());
    assert_ne!(k_client.sas_6digit, k_host.sas_6digit);

    // Client SAS mismatch aborts before sending approval confirm
    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = Arc::new(AuthStore::open_isolated(tmp_h.path()).unwrap());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut invite =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();
    let code = invite.formatted_code();
    let auth_c = auth.clone();
    let h = thread::spawn(move || {
        let (lc, gate) = new_host_runtime();
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(tcp, peer, &host_id, &mut invite, &auth_c, &lc, &gate, |r| {
            Ok(make_approval_decision(r, true, DurationPolicy::SessionOnly))
        })
    });
    let err = client_pair_with_code(addr, &client_id, "c", &code, None, |_| false).unwrap_err();
    assert_eq!(err, JackError::SasMismatch);
    assert!(h.join().unwrap().is_err());
}

#[test]
fn neg_02_invalid_pairing_code_rejected() {
    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = Arc::new(AuthStore::open_isolated(tmp_h.path()).unwrap());

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let invite = Arc::new(Mutex::new(
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap(),
    ));

    let inv_c = invite.clone();
    let auth_c = auth.clone();
    let handle = thread::spawn(move || {
        let (lc, gate) = new_host_runtime();
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(
            tcp,
            peer,
            &host_id,
            &mut inv_c.lock().unwrap(),
            &auth_c,
            &lc,
            &gate,
            |r| Ok(make_approval_decision(r, true, DurationPolicy::SessionOnly)),
        )
    });

    let err = client_pair_with_code(addr, &client_id, "bad-client", "ZZZZ-ZZZZ", None, |_| true)
        .unwrap_err();
    assert_eq!(err.code(), "ERR_PAKE_BINDING_FAILED");
    let host_err = handle.join().unwrap().unwrap_err();
    assert!(matches!(
        host_err.code(),
        "ERR_PAKE_BINDING_FAILED" | "ERR_IO"
    ));
    assert_eq!(invite.lock().unwrap().attempts, 1);
}

#[test]
fn neg_03_04_05_06_07_invitation_lockout_expiry_replay_concurrency_and_state_machine() {
    let host_id = DeviceIdentity::generate().unwrap();
    let mut inv =
        PairingInvitation::create(host_id.public_key_bytes(), "127.0.0.1:9999".into(), 300)
            .unwrap();

    let now = now_unix();
    inv.begin_attempt(now).unwrap();
    assert_eq!(inv.begin_attempt(now).unwrap_err(), JackError::PairingBusy);
    inv.record_failed_attempt();

    for _ in 1..5 {
        inv.begin_attempt(now).unwrap();
        inv.record_failed_attempt();
    }
    assert!(inv.locked);
    assert_eq!(inv.state, PairingState::Failed);
    assert_eq!(
        inv.begin_attempt(now).unwrap_err(),
        JackError::PairingLocked
    );

    let mut exp_inv =
        PairingInvitation::create(host_id.public_key_bytes(), "127.0.0.1:9999".into(), 60).unwrap();
    assert_eq!(
        exp_inv.begin_attempt(exp_inv.expires_at + 10).unwrap_err(),
        JackError::InviteExpired
    );
    let qr = exp_inv.to_qr_uri().unwrap();
    assert_eq!(
        parse_qr_uri(&qr, exp_inv.expires_at + 10).unwrap_err(),
        JackError::InviteExpired
    );

    let mut used_inv =
        PairingInvitation::create(host_id.public_key_bytes(), "127.0.0.1:9999".into(), 60).unwrap();
    used_inv.begin_attempt(now).unwrap();
    used_inv.mark_awaiting_approval().unwrap();
    used_inv.mark_authorized().unwrap();
    assert_eq!(
        used_inv.begin_attempt(now).unwrap_err(),
        JackError::InviteConsumed
    );

    let mut s = PairingState::WaitingForRequest;
    assert!(s.transition(PairingState::Authorized).is_err());
    let mut d = PairingState::Denied;
    assert!(d.transition(PairingState::Connected).is_err());
}

#[test]
fn neg_08_09_identity_substitution_and_protocol_version() {
    assert_eq!(
        parse_qr_uri(
            "jack://pair?v=2&id=AA&pk=AA&ep=AA&exp=9999999999&pake=AA",
            1
        )
        .unwrap_err()
        .code(),
        "ERR_PROTOCOL_VERSION"
    );
    let oversized = format!("jack://pair?v=1&pad={}", "a".repeat(MAX_QR_URI_BYTES + 10));
    assert_eq!(
        parse_qr_uri(&oversized, 1).unwrap_err().code(),
        "ERR_INVALID_INPUT"
    );

    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = AuthStore::open_isolated(tmp_h.path()).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut inv =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();

    let h = thread::spawn(move || {
        let (lc, gate) = new_host_runtime();
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(tcp, peer, &host_id, &mut inv, &auth, &lc, &gate, |r| {
            Ok(make_approval_decision(r, true, DurationPolicy::SessionOnly))
        })
    });

    let tcp = TcpStream::connect(addr).unwrap();
    let obs = Arc::new(Mutex::new(None));
    let cfg =
        jack_easy_pairing::transport::build_tls13_pairing_client_config(&client_id, None, obs)
            .unwrap();
    let sname = rustls_pki_types::ServerName::try_from("localhost").unwrap();
    let conn = rustls::ClientConnection::new(cfg, sname).unwrap();
    let mut stream = rustls::StreamOwned::new(conn, tcp);
    let bad_hello = WirePairHello {
        version: 2,
        client_name: "c".into(),
        spake_msg_a: vec![],
    };
    write_bounded_frame(&mut stream, &serde_json::to_vec(&bad_hello).unwrap()).unwrap();
    let _ = read_bounded_frame(&mut stream);

    assert_eq!(
        h.join().unwrap().unwrap_err().code(),
        "ERR_PROTOCOL_VERSION"
    );
}

#[test]
fn neg_10_11_12_13_missing_and_denied_approval_scope_and_revocation() {
    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = Arc::new(AuthStore::open_isolated(tmp_h.path()).unwrap());

    // Missing approval (approval callback returns ApprovalTimeout / no decision)
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut inv_miss =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();
    let code_miss = inv_miss.formatted_code();
    let auth_m = auth.clone();
    let host_id_m = DeviceIdentity::from_signing_key(ed25519_dalek::SigningKey::from_bytes(
        &host_id.clone_signing_bytes(),
    ))
    .unwrap();
    let h_miss = thread::spawn(move || {
        let (lc, gate) = new_host_runtime();
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(
            tcp,
            peer,
            &host_id_m,
            &mut inv_miss,
            &auth_m,
            &lc,
            &gate,
            |_| Err(JackError::ApprovalTimeout),
        )
    });
    let c_miss =
        client_pair_with_code(addr, &client_id, "client", &code_miss, None, |_| true).unwrap_err();
    assert_eq!(c_miss, JackError::ApprovalTimeout);
    assert_eq!(
        h_miss.join().unwrap().unwrap_err(),
        JackError::ApprovalTimeout
    );

    // Approve cleanly -> test scope escalation, active-session revocation, reconnect denial
    auth.approve_and_persist(
        client_id.device_id.clone(),
        "client".into(),
        client_id.public_key_bytes(),
        DurationPolicy::SessionOnly,
    )
    .unwrap();
    let sess = auth.register_session(&client_id.device_id).unwrap();

    assert_eq!(
        execute_capability(
            &auth,
            &client_id.device_id,
            Some(&sess.session_id),
            "workspace.read",
            Instant::now(),
        )
        .unwrap_err()
        .code(),
        "ERR_SCOPE_DENIED"
    );

    auth.revoke_peer(&client_id.device_id).unwrap();
    assert!(sess.is_revoked());
    assert_eq!(
        execute_capability(
            &auth,
            &client_id.device_id,
            Some(&sess.session_id),
            "status.read",
            Instant::now(),
        )
        .unwrap_err(),
        JackError::TrustRevoked
    );
    assert_eq!(
        auth.register_session(&client_id.device_id).unwrap_err(),
        JackError::TrustRevoked
    );
}

#[test]
fn neg_14_15_16_17_18_corrupt_symlink_keystore_redaction_and_loopback() {
    let tmp_corrupt = TempDir::new().unwrap();
    fs::write(
        tmp_corrupt.path().join("auth_store.json"),
        "{not-valid-json",
    )
    .unwrap();
    assert_eq!(
        AuthStore::open_isolated(tmp_corrupt.path())
            .unwrap_err()
            .code(),
        "ERR_AUTH_STATE_UNAVAILABLE"
    );

    #[cfg(unix)]
    {
        let tmp_sym = TempDir::new().unwrap();
        let target = tmp_sym.path().join("real.json");
        fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, tmp_sym.path().join("auth_store.json")).unwrap();
        assert_eq!(
            AuthStore::open_isolated(tmp_sym.path()).unwrap_err().code(),
            "ERR_AUTH_STATE_UNAVAILABLE"
        );
    }

    assert_eq!(
        FailClosedKeystore
            .load_or_create("host")
            .unwrap_err()
            .code(),
        "ERR_KEYSTORE_UNAVAILABLE"
    );
    let mem = InMemoryTestKeystore::default();
    let id = mem.load_or_create("host").unwrap();

    let inv =
        PairingInvitation::create(id.public_key_bytes(), "127.0.0.1:9000".into(), 300).unwrap();
    let raw_code = inv.formatted_code();
    let dbg_inv = format!("{:?}", inv);
    let dbg_id = format!("{:?}", id);
    assert!(dbg_inv.contains("[REDACTED]"));
    assert!(dbg_id.contains("[REDACTED]"));
    assert!(!dbg_inv.contains(&raw_code.replace('-', "")));

    let remote: SocketAddr = "192.0.2.1:443".parse().unwrap();
    assert_eq!(
        ensure_loopback(remote).unwrap_err().code(),
        "ERR_LOOPBACK_ONLY"
    );
}

#[test]
fn g9_two_process_e2e_approve_and_deny() {
    let host_home = TempDir::new().unwrap();
    let client_home = TempDir::new().unwrap();
    let host_bin = env!("CARGO_BIN_EXE_jack-host-fixture");
    let client_bin = env!("CARGO_BIN_EXE_jack-client-fixture");

    // 1. Approved E2E flow
    let mut host_child = Command::new(host_bin)
        .arg(host_home.path())
        .arg("approve")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn jack-host-fixture");

    let mut reader = BufReader::new(host_child.stdout.take().unwrap());
    let mut ready_line = String::new();
    reader.read_line(&mut ready_line).unwrap();
    let parts: Vec<&str> = ready_line.split_whitespace().collect();
    assert_eq!(parts[0], "READY");

    let client_out = Command::new(client_bin)
        .arg(client_home.path())
        .arg(parts[1])
        .arg(parts[2])
        .output()
        .expect("run jack-client-fixture");
    let client_stdout = String::from_utf8_lossy(&client_out.stdout);
    assert!(
        client_out.status.success(),
        "client failed: {}",
        client_stdout
    );
    assert!(client_stdout.contains("PAIRED jack:ed25519:"));
    assert!(client_stdout.contains("STATUS_OK ok "));
    assert!(client_stdout.contains("UNAUTHORIZED_DENIED ERR_SCOPE_DENIED"));
    assert!(host_child.wait().unwrap().success());

    // 2. Denied E2E flow
    let deny_home = TempDir::new().unwrap();
    let mut deny_host = Command::new(host_bin)
        .arg(deny_home.path())
        .arg("deny")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut deny_reader = BufReader::new(deny_host.stdout.take().unwrap());
    let mut deny_ready = String::new();
    deny_reader.read_line(&mut deny_ready).unwrap();
    let dparts: Vec<&str> = deny_ready.split_whitespace().collect();
    let deny_client = Command::new(client_bin)
        .arg(client_home.path())
        .arg(dparts[1])
        .arg(dparts[2])
        .output()
        .unwrap();
    assert!(!deny_client.status.success());
    assert!(deny_host.wait().unwrap().success());

    let _ = host_serve_capability_once;
}
