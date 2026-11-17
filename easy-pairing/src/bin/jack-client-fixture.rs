use jack_easy_pairing::auth::AuthStore;
use jack_easy_pairing::identity::{InMemoryTestKeystore, Keystore};
use jack_easy_pairing::{client_invoke_capability, client_pair_with_code};
use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: jack-client-fixture <jack_home> <addr> <code>");
        std::process::exit(2);
    }
    let jack_home = PathBuf::from(&args[1]);
    let addr: SocketAddr = args[2].parse().expect("valid loopback addr");
    let code = &args[3];

    let ks = InMemoryTestKeystore::default();
    let client_id = ks.load_or_create("client").expect("client id");
    let _client_auth = AuthStore::open_isolated(&jack_home).expect("client auth store");

    let (host_id, host_pk, sas) =
        client_pair_with_code(addr, &client_id, "linux-client-fixture", code, None)
            .expect("pairing succeeded");
    println!("PAIRED {} {}", host_id.0, sas);

    let status = client_invoke_capability(addr, &client_id, host_pk, "status.read")
        .expect("status.read succeeded");
    println!("STATUS_OK {} {}", status.os, status.host_device_id);

    let denied = client_invoke_capability(addr, &client_id, host_pk, "workspace.read")
        .expect_err("workspace.read must be denied");
    println!("UNAUTHORIZED_DENIED {}", denied.code());
}
