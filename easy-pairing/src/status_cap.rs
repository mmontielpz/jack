use crate::auth::{ActiveSessionHandle, AuthStore};
use crate::error::JackError;
use crate::identity::DeviceId;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatusReadResponse {
    pub os: String,
    pub jack_version: String,
    pub host_device_id: String,
    pub uptime_seconds: u64,
}

pub fn execute_capability(
    auth: &AuthStore,
    peer_id: &DeviceId,
    session: Option<&ActiveSessionHandle>,
    requested_scope: &str,
    host_id: &DeviceId,
    started_at: Instant,
) -> Result<StatusReadResponse, JackError> {
    auth.authorize_capability(peer_id, requested_scope, session)?;
    Ok(StatusReadResponse {
        os: std::env::consts::OS.to_string(),
        jack_version: env!("CARGO_PKG_VERSION").to_string(),
        host_device_id: host_id.0.clone(),
        uptime_seconds: started_at.elapsed().as_secs(),
    })
}
