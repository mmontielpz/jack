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
                "capability '{}' is not permitted in EP-003 (status.read only)",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DurationPolicy {
    #[default]
    SessionOnly,
    OneHour,
    TwentyFourHours,
    RememberDevice,
}

impl DurationPolicy {
    pub fn ttl_secs(self) -> Option<u64> {
        match self {
            Self::SessionOnly => Some(3600), // bounded session grant, invalidated on session close
            Self::OneHour => Some(3600),
            Self::TwentyFourHours => Some(86_400),
            Self::RememberDevice => None, // persistent trust, never unattended background access
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
    pub duration_policy: DurationPolicy,
    pub issued_at: u64,
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
    pub session_id: String,
    pub peer_id: DeviceId,
    pub grant_id: String,
    pub created_at: u64,
    pub last_activity_at: u64,
    pub idle_timeout_secs: u64,
    pub expires_at: u64,
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
    sessions: Mutex<HashMap<String, ActiveSessionHandle>>,
    max_concurrent_sessions: usize,
    idle_timeout_secs: u64,
    session_max_lifetime_secs: u64,
    session_seq: Mutex<u64>,
}

impl AuthStore {
    pub fn open_isolated(jack_home: &Path) -> Result<Self, JackError> {
        Self::open_isolated_with_limits(jack_home, 4, 300, 3600)
    }

    pub fn open_isolated_with_limits(
        jack_home: &Path,
        max_concurrent_sessions: usize,
        idle_timeout_secs: u64,
        session_max_lifetime_secs: u64,
    ) -> Result<Self, JackError> {
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
            sessions: Mutex::new(HashMap::new()),
            max_concurrent_sessions,
            idle_timeout_secs,
            session_max_lifetime_secs,
            session_seq: Mutex::new(0),
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
        duration_policy: DurationPolicy,
    ) -> Result<Grant, JackError> {
        self.approve_and_persist_at(
            device_id,
            display_name,
            public_key,
            duration_policy,
            now_unix(),
        )
    }

    pub fn approve_and_persist_at(
        &self,
        device_id: DeviceId,
        display_name: String,
        public_key: [u8; 32],
        duration_policy: DurationPolicy,
        now: u64,
    ) -> Result<Grant, JackError> {
        let mut snap = self
            .state
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("auth mutex poisoned".into()))?;
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
            duration_policy,
            issued_at: now,
            expires_at: duration_policy.ttl_secs().map(|s| now.saturating_add(s)),
            revoked: false,
        };
        snap.grants.insert(device_id.0.clone(), grant.clone());
        self.persist_locked(&snap)?;
        Ok(grant)
    }

    pub fn register_session(&self, peer_id: &DeviceId) -> Result<ActiveSessionHandle, JackError> {
        self.register_session_at(peer_id, now_unix())
    }

    pub fn register_session_at(
        &self,
        peer_id: &DeviceId,
        now: u64,
    ) -> Result<ActiveSessionHandle, JackError> {
        let grant = self.authorize_capability(peer_id, "status.read", None, now)?;
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("session mutex poisoned".into()))?;

        // Prune revoked/expired sessions before checking concurrency bound
        sessions.retain(|_, s| {
            !s.is_revoked()
                && now <= s.expires_at
                && now.saturating_sub(s.last_activity_at) <= s.idle_timeout_secs
        });
        if sessions.len() >= self.max_concurrent_sessions {
            return Err(JackError::SessionLimitReached);
        }

        let mut seq = self
            .session_seq
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("seq mutex poisoned".into()))?;
        *seq = seq.saturating_add(1);
        let session_id = format!("sess-{}-{}", now, *seq);

        let handle = ActiveSessionHandle {
            session_id: session_id.clone(),
            peer_id: peer_id.clone(),
            grant_id: grant.grant_id,
            created_at: now,
            last_activity_at: now,
            idle_timeout_secs: self.idle_timeout_secs,
            expires_at: now.saturating_add(self.session_max_lifetime_secs),
            revoked_flag: Arc::new(AtomicBool::new(false)),
        };
        sessions.insert(session_id, handle.clone());
        Ok(handle)
    }

    pub fn validate_session_request(
        &self,
        session_id: &str,
        scope_raw: &str,
        now: u64,
    ) -> Result<(), JackError> {
        let peer_id = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| JackError::AuthStateUnavailable("session mutex poisoned".into()))?;
            let sess = sessions
                .get_mut(session_id)
                .ok_or(JackError::TrustRevoked)?;
            if sess.is_revoked() {
                return Err(JackError::TrustRevoked);
            }
            if now.saturating_sub(sess.last_activity_at) > sess.idle_timeout_secs {
                sess.revoke();
                return Err(JackError::SessionIdleTimeout);
            }
            if now > sess.expires_at {
                sess.revoke();
                return Err(JackError::GrantExpired);
            }
            sess.last_activity_at = now;
            sess.peer_id.clone()
        };
        self.authorize_capability(&peer_id, scope_raw, None, now)?;
        Ok(())
    }

    pub fn close_session(&self, session_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(s) = sessions.remove(session_id) {
                s.revoke();
            }
        }
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
        now: u64,
    ) -> Result<Grant, JackError> {
        let scope = CapabilityScope::parse(scope_raw)?;
        if let Some(s) = session {
            if s.is_revoked() {
                return Err(JackError::TrustRevoked);
            }
        }
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
            if now > exp {
                return Err(JackError::GrantExpired);
            }
        }
        if !grant.scopes.contains(&scope) {
            return Err(JackError::ScopeDenied(format!(
                "scope '{}' not granted",
                scope.as_str()
            )));
        }
        Ok(grant.clone())
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
            .sessions
            .lock()
            .map_err(|_| JackError::AuthStateUnavailable("session mutex poisoned".into()))?;
        for s in sessions.values() {
            if &s.peer_id == peer_id {
                s.revoke();
            }
        }
        Ok(())
    }

    pub fn shutdown_all_sessions(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for s in sessions.values() {
                s.revoke();
            }
            sessions.clear();
        }
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
