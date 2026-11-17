use crate::auth::{now_unix, AuthStore};
use crate::error::JackError;
use crate::identity::DeviceId;
use serde::{Deserialize, Serialize};
use std::time::Instant;

/// Minimal non-sensitive status metadata (no private machine IDs, IPs, or secrets).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatusReadResponse {
    pub status: String,
    pub os: String,
    pub jack_version: String,
    pub uptime_seconds: u64,
}

pub fn execute_capability(
    auth: &AuthStore,
    peer_id: &DeviceId,
    session_id: Option<&str>,
    requested_scope: &str,
    started_at: Instant,
) -> Result<StatusReadResponse, JackError> {
    if let Some(sid) = session_id {
        auth.validate_session_request(sid, requested_scope, now_unix())?;
    } else {
        auth.authorize_capability(peer_id, requested_scope, None, now_unix())?;
    }
    Ok(StatusReadResponse {
        status: "ok".to_string(),
        os: std::env::consts::OS.to_string(),
        jack_version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: started_at.elapsed().as_secs(),
    })
}
