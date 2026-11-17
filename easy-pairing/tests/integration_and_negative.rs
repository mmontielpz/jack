use jack_easy_pairing::auth::{now_unix, AuthStore};
use jack_easy_pairing::error::JackError;
use jack_easy_pairing::identity::{
    DeviceIdentity, FailClosedKeystore, InMemoryTestKeystore, Keystore,
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

#[test]
fn neg_01_mitm_channel_binding_mismatch_fails() {
    // Two different TLS channel-binding tokens produce different confirm keys & SAS
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
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(
            tcp,
            peer,
            &host_id,
            &mut inv_c.lock().unwrap(),
            &auth_c,
            Instant::now(),
            |_, _, _| true,
        )
    });

    let err = client_pair_with_code(addr, &client_id, "bad-client", "ZZZZ-ZZZZ", None).unwrap_err();
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

    // 6. Concurrent pairing race
    let now = now_unix();
    inv.begin_attempt(now).unwrap();
    assert_eq!(inv.begin_attempt(now).unwrap_err(), JackError::PairingBusy);
    inv.record_failed_attempt(); // attempt 1

    // 3. Five-attempt lockout
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

    // 4. Expired invitation
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

    // 5. Replayed / consumed invitation
    let mut used_inv =
        PairingInvitation::create(host_id.public_key_bytes(), "127.0.0.1:9999".into(), 60).unwrap();
    used_inv.begin_attempt(now).unwrap();
    used_inv.mark_awaiting_approval().unwrap();
    used_inv.mark_authorized().unwrap();
    assert_eq!(
        used_inv.begin_attempt(now).unwrap_err(),
        JackError::InviteConsumed
    );

    // 7. Invalid state transitions
    let mut s = PairingState::WaitingForRequest;
    assert!(s.transition(PairingState::Authorized).is_err());
    let mut d = PairingState::Denied;
    assert!(d.transition(PairingState::Connected).is_err());
}

#[test]
fn neg_08_device_identity_substitution_rejected() {
    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let other_host_pk = DeviceIdentity::generate().unwrap().public_key_bytes();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = Arc::new(AuthStore::open_isolated(tmp_h.path()).unwrap());

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let invite =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();
    let code = invite.formatted_code();

    let h = thread::spawn(move || {
        let _ = listener.accept();
        let _ = auth;
    });

    // Pin wrong host public key -> TLS verifier rejects handshake
    let res = client_pair_with_code(addr, &client_id, "client", &code, Some(other_host_pk));
    assert!(res.is_err());
    let _ = h.join();
}

#[test]
fn neg_09_unsupported_protocol_version_and_qr_size() {
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

    // Wire hello version=2 rejected
    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = AuthStore::open_isolated(tmp_h.path()).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut inv =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();

    let h = thread::spawn(move || {
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(
            tcp,
            peer,
            &host_id,
            &mut inv,
            &auth,
            Instant::now(),
            |_, _, _| true,
        )
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
fn neg_10_11_12_13_approval_denied_scope_escalation_and_revocation() {
    let tmp_h = TempDir::new().unwrap();
    let host_id = DeviceIdentity::generate().unwrap();
    let client_id = DeviceIdentity::generate().unwrap();
    let auth = Arc::new(AuthStore::open_isolated(tmp_h.path()).unwrap());

    // 11. Approval denied
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let mut inv_deny =
        PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300).unwrap();
    let code_deny = inv_deny.formatted_code();
    let auth_c = auth.clone();
    let host_pk = host_id.public_key_bytes();
    let host_id_clone = DeviceIdentity::from_signing_key(ed25519_dalek::SigningKey::from_bytes(
        &host_id.clone_signing_bytes(),
    ))
    .unwrap();
    let h_deny = thread::spawn(move || {
        let (tcp, peer) = listener.accept().unwrap();
        host_handle_pairing_connection(
            tcp,
            peer,
            &host_id_clone,
            &mut inv_deny,
            &auth_c,
            Instant::now(),
            |_, _, _| false,
        )
    });
    let c_err =
        client_pair_with_code(addr, &client_id, "client", &code_deny, Some(host_pk)).unwrap_err();
    assert_eq!(c_err, JackError::ApprovalDenied);
    assert_eq!(
        h_deny.join().unwrap().unwrap_err(),
        JackError::ApprovalDenied
    );

    // Approve cleanly, then test 10. Unauthorized capability, 12. Active-session revocation, 13. Reconnect after revocation
    auth.approve_and_persist(
        client_id.device_id.clone(),
        "client".into(),
        client_id.public_key_bytes(),
        Some(3600),
    )
    .unwrap();
    let sess = auth.register_session(&client_id.device_id).unwrap();

    // 10. Unauthorized scopes
    assert_eq!(
        execute_capability(
            &auth,
            &client_id.device_id,
            Some(&sess),
            "workspace.read",
            &host_id.device_id,
            Instant::now()
        )
        .unwrap_err()
        .code(),
        "ERR_SCOPE_DENIED"
    );
    assert_eq!(
        execute_capability(
            &auth,
            &client_id.device_id,
            Some(&sess),
            "exec.shell",
            &host_id.device_id,
            Instant::now()
        )
        .unwrap_err()
        .code(),
        "ERR_SCOPE_DENIED"
    );

    // 12. Active-session revocation
    auth.revoke_peer(&client_id.device_id).unwrap();
    assert!(sess.is_revoked());
    assert_eq!(
        execute_capability(
            &auth,
            &client_id.device_id,
            Some(&sess),
            "status.read",
            &host_id.device_id,
            Instant::now()
        )
        .unwrap_err(),
        JackError::TrustRevoked
    );

    // 13. Reconnection after revocation
    assert_eq!(
        auth.register_session(&client_id.device_id).unwrap_err(),
        JackError::TrustRevoked
    );
}

#[test]
fn neg_14_15_16_17_18_corrupt_symlink_keystore_redaction_and_loopback() {
    // 14. Corrupt authorization store
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

    // 15. Symlinked authorization store
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

    // 16. Unavailable keystore fails closed
    assert_eq!(
        FailClosedKeystore
            .load_or_create("host")
            .unwrap_err()
            .code(),
        "ERR_KEYSTORE_UNAVAILABLE"
    );
    let mem = InMemoryTestKeystore::default();
    let id = mem.load_or_create("host").unwrap();

    // 17. Secret redaction in Debug output
    let inv =
        PairingInvitation::create(id.public_key_bytes(), "127.0.0.1:9000".into(), 300).unwrap();
    let raw_code = inv.formatted_code();
    let dbg_inv = format!("{:?}", inv);
    let dbg_id = format!("{:?}", id);
    assert!(dbg_inv.contains("[REDACTED]"));
    assert!(dbg_id.contains("[REDACTED]"));
    assert!(!dbg_inv.contains(&raw_code.replace('-', "")));

    // 18. Non-loopback connection refused
    let remote: SocketAddr = "192.0.2.1:443".parse().unwrap();
    assert_eq!(
        ensure_loopback(remote).unwrap_err().code(),
        "ERR_LOOPBACK_ONLY"
    );
}

#[test]
fn g7_two_process_loopback_integration_fixture() {
    let host_home = TempDir::new().unwrap();
    let client_home = TempDir::new().unwrap();

    let host_bin = env!("CARGO_BIN_EXE_jack-host-fixture");
    let client_bin = env!("CARGO_BIN_EXE_jack-client-fixture");

    let mut host_child = Command::new(host_bin)
        .arg(host_home.path())
        .arg("approve")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn jack-host-fixture");

    let stdout = host_child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut ready_line = String::new();
    reader.read_line(&mut ready_line).unwrap();
    let parts: Vec<&str> = ready_line.split_whitespace().collect();
    assert_eq!(parts[0], "READY");
    let addr = parts[1];
    let code = parts[2];

    let client_out = Command::new(client_bin)
        .arg(client_home.path())
        .arg(addr)
        .arg(code)
        .output()
        .expect("run jack-client-fixture");

    let client_stdout = String::from_utf8_lossy(&client_out.stdout);
    assert!(
        client_out.status.success(),
        "client failed: stdout={} stderr={}",
        client_stdout,
        String::from_utf8_lossy(&client_out.stderr)
    );
    assert!(client_stdout.contains("PAIRED jack:ed25519:"));
    assert!(client_stdout.contains("STATUS_OK "));
    assert!(client_stdout.contains("UNAUTHORIZED_DENIED ERR_SCOPE_DENIED"));

    let host_status = host_child.wait().unwrap();
    assert!(host_status.success());

    // Confirm atomic auth_store.json created on host only inside disposable TempDir
    assert!(host_home.path().join("auth_store.json").exists());

    // Also test host_serve_capability_once symbol reachable
    let _ = host_serve_capability_once;
}
