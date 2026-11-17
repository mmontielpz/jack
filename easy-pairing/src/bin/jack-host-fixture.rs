use jack_easy_pairing::auth::AuthStore;
use jack_easy_pairing::identity::{InMemoryTestKeystore, Keystore};
use jack_easy_pairing::pairing::PairingInvitation;
use jack_easy_pairing::{host_handle_pairing_connection, host_serve_capability_once};
use std::env;
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: jack-host-fixture <jack_home> <approve|deny>");
        std::process::exit(2);
    }
    let jack_home = PathBuf::from(&args[1]);
    let approve = args[2] == "approve";
    let started_at = Instant::now();

    let ks = InMemoryTestKeystore::default();
    let host_id = ks.load_or_create("host").expect("host id");
    let auth = AuthStore::open_isolated(&jack_home).expect("auth store");

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let addr = listener.local_addr().expect("local addr");
    let mut invite = PairingInvitation::create(host_id.public_key_bytes(), addr.to_string(), 300)
        .expect("invite");

    // Emit machine-readable READY line on stdout (addr + code; never logged to persistent files)
    println!("READY {} {}", addr, invite.formatted_code());

    let (tcp, peer_addr) = listener.accept().expect("accept pairing");
    let res = host_handle_pairing_connection(
        tcp,
        peer_addr,
        &host_id,
        &mut invite,
        &auth,
        started_at,
        |_cid, _cname, _sas| approve,
    );

    match res {
        Ok((client_id, _sas)) => {
            let client_pk = auth
                .trusted_pubkey_for_peer(&client_id)
                .expect("trusted peer");
            // Serve 2 capability requests (status.read + 1 negative scope test)
            for _ in 0..2 {
                let (cap_tcp, cap_peer) = listener.accept().expect("accept capability");
                let _ = host_serve_capability_once(
                    cap_tcp, cap_peer, &host_id, client_pk, &auth, started_at,
                );
            }
            println!("HOST_DONE OK");
        }
        Err(e) => {
            println!("HOST_DONE ERR {}", e.code());
            if approve {
                std::process::exit(1);
            }
        }
    }
}
