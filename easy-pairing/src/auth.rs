use crate::error::JackError;
use crate::identity::DeviceId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityScope {
    StatusRead,
}

impl CapabilityScope {
    pub fn parse(raw: &str) -> Result<Self, JackError> {
        match raw {
            "status.read" => Ok(Self::StatusRead),
            other => Err(JackError::ScopeDenied(format!(
                "capability '{}' is not permitted in EP-002 (status.read only)",
                other
            ))),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StatusRead => "status.read",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedPeer {
    pub device_id: DeviceId,
    pub display_name: String,
    pub public_key: [u8; 32],
    pub paired_at: u64,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grant {
    pub grant_id: String,
    pub peer_id: DeviceId,
    pub scopes: Vec<CapabilityScope>,
    pub expires_at: Option<u64>,
    pub revoked: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthSnapshot {
    pub peers: HashMap<String, TrustedPeer>,
    pub grants: HashMap<String, Grant>,
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone)]
pub struct ActiveSessionHandle {
    pub peer_id: DeviceId,
    pub revoked_flag: Arc<AtomicBool>,
}

impl ActiveSessionHandle {
    pub fn is_revoked(&self) -> bool {
        self.revoked_flag.load(Ordering::SeqCst)
    }

    pub fn revoke(&self) {
        self.revoked_flag.store(true, Ordering::SeqCst);
    }
}

#[derive(Debug)]
pub struct AuthStore {
    store_path: PathBuf,
    state: Mutex<AuthSnapshot>,
    active_sessions: Mutex<Vec<ActiveSessionHandle>>,
}

impl AuthStore {
    pub fn open_isolated(jack_home: &Path) -> Result<Self, JackError> {
        validate_safe_dir(jack_home)?;
        if !jack_home.exists() {
            fs::create_dir_all(jack_home)
                .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(jack_home, fs::Permissions::from_mode(0o700))
                    .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
            }
        }
        let store_path = jack_home.join("auth_store.json");
        let state = if store_path.exists() {
            validate_safe_file(&store_path)?;
            let raw = fs::read_to_string(&store_path)
                .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
            serde_json::from_str::<AuthSnapshot>(&raw).map_err(|e| {
                JackError::AuthStateUnavailable(format!("corrupt auth store: {}", e))
            })?
        } else {
            AuthSnapshot::default()
        };

        Ok(Self {
            store_path,
            state: Mutex::new(state),
            active_sessions: Mutex::new(Vec::new()),
        })
    }

    pub fn store_path(&self) -> &Path {
        &self.store_path
    }

    fn persist_locked(&self, snap: &AuthSnapshot) -> Result<(), JackError> {
        let parent = self
            .store_path
            .parent()
            .ok_or_else(|| JackError::AuthStateUnavailable("missing store parent".into()))?;
        validate_safe_dir(parent)?;
        if self.store_path.exists() {
            validate_safe_file(&self.store_path)?;
        }
        let tmp = parent.join(format!("auth_store.tmp.{}", std::process::id()));
        let json = serde_json::to_string_pretty(snap)
            .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
        fs::write(&tmp, json.as_bytes())
            .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))
                .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
        }
        fs::rename(&tmp, &self.store_path)
            .map_err(|e| JackError::AuthStateUnavailable(e.to_string()))?;
        Ok(())
    }

    pub fn approve_and_persist(
        &self,
        device_id: DeviceId,
        display_name: String,
        public_key: [u8; 32],
        ttl_secs: Option<u64>,
    ) -> Result<Grant, JackError> {
        let mut snap = self
            .state
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("auth mutex poisoned".into()))?;
        let now = now_unix();
        snap.peers.insert(
            device_id.0.clone(),
            TrustedPeer {
                device_id: device_id.clone(),
                display_name,
                public_key,
                paired_at: now,
                revoked: false,
            },
        );
        let grant_id = format!("grant-{}-{}", now, snap.grants.len() + 1);
        let grant = Grant {
            grant_id: grant_id.clone(),
            peer_id: device_id.clone(),
            scopes: vec![CapabilityScope::StatusRead],
            expires_at: ttl_secs.map(|s| now.saturating_add(s)),
            revoked: false,
        };
        snap.grants.insert(device_id.0.clone(), grant.clone());
        self.persist_locked(&snap)?;
        Ok(grant)
    }

    pub fn register_session(&self, peer_id: &DeviceId) -> Result<ActiveSessionHandle, JackError> {
        self.authorize_capability(peer_id, "status.read", None)?;
        let handle = ActiveSessionHandle {
            peer_id: peer_id.clone(),
            revoked_flag: Arc::new(AtomicBool::new(false)),
        };
        let mut sessions = self
            .active_sessions
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("session mutex poisoned".into()))?;
        sessions.push(handle.clone());
        Ok(handle)
    }

    pub fn trusted_pubkey_for_peer(&self, peer_id: &DeviceId) -> Result<[u8; 32], JackError> {
        let snap = self
            .state
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("auth mutex poisoned".into()))?;
        let peer = snap.peers.get(&peer_id.0).ok_or(JackError::TrustRevoked)?;
        if peer.revoked {
            return Err(JackError::TrustRevoked);
        }
        Ok(peer.public_key)
    }

    pub fn authorize_capability(
        &self,
        peer_id: &DeviceId,
        scope_raw: &str,
        session: Option<&ActiveSessionHandle>,
    ) -> Result<(), JackError> {
        let scope = CapabilityScope::parse(scope_raw)?;
        if let Some(s) = session {
            if s.is_revoked() {
                return Err(JackError::TrustRevoked);
            }
        }
        // Fail closed if store file was tampered with or replaced by a symlink on disk
        if self.store_path.exists() {
            validate_safe_file(&self.store_path)?;
        }
        let snap = self
            .state
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("auth mutex poisoned".into()))?;
        let peer = snap.peers.get(&peer_id.0).ok_or(JackError::TrustRevoked)?;
        if peer.revoked {
            return Err(JackError::TrustRevoked);
        }
        let grant = snap.grants.get(&peer_id.0).ok_or(JackError::TrustRevoked)?;
        if grant.revoked {
            return Err(JackError::TrustRevoked);
        }
        if let Some(exp) = grant.expires_at {
            if now_unix() > exp {
                return Err(JackError::GrantExpired);
            }
        }
        if !grant.scopes.contains(&scope) {
            return Err(JackError::ScopeDenied(format!(
                "scope '{}' not granted",
                scope.as_str()
            )));
        }
        Ok(())
    }

    pub fn revoke_peer(&self, peer_id: &DeviceId) -> Result<(), JackError> {
        {
            let mut snap = self
                .state
                .lock()
                .map_err(|_| JackError::AuthStateUnavailable("auth mutex poisoned".into()))?;
            if let Some(peer) = snap.peers.get_mut(&peer_id.0) {
                peer.revoked = true;
            }
            if let Some(grant) = snap.grants.get_mut(&peer_id.0) {
                grant.revoked = true;
            }
            self.persist_locked(&snap)?;
        }
        let sessions = self
            .active_sessions
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("session mutex poisoned".into()))?;
        for s in sessions.iter() {
            if &s.peer_id == peer_id {
                s.revoke();
            }
        }
        Ok(())
    }
}

fn validate_safe_dir(dir: &Path) -> Result<(), JackError> {
    if let Ok(meta) = fs::symlink_metadata(dir) {
        if meta.file_type().is_symlink() {
            return Err(JackError::AuthStateUnavailable(
                "refusing symlinked JACK_HOME directory".into(),
            ));
        }
    }
    Ok(())
}

fn validate_safe_file(file: &Path) -> Result<(), JackError> {
    let meta = fs::symlink_metadata(file)
        .map_err(|e| JackError::AuthStateUnavailable(format!("stat failed: {}", e)))?;
    if meta.file_type().is_symlink() {
        return Err(JackError::AuthStateUnavailable(
            "refusing symlinked authorization store".into(),
        ));
    }
    if !meta.file_type().is_file() {
        return Err(JackError::AuthStateUnavailable(
            "authorization store is not a regular file".into(),
        ));
    }
    Ok(())
}
