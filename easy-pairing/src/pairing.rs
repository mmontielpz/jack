use crate::auth::now_unix;
use crate::error::JackError;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::fmt;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

type HmacSha256 = Hmac<Sha256>;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_QR_URI_BYTES: usize = 1024;
pub const MAX_INVITE_TTL_SECS: u64 = 300;
pub const MAX_PAIRING_ATTEMPTS: u8 = 5;

const CROCKFORD_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PairingState {
    Ready,
    InvitationCreated,
    WaitingForRequest,
    VerifyingIdentity,
    WaitingForApproval,
    Authorized,
    Connected,
    Denied,
    Expired,
    Failed,
    Revoked,
}

impl PairingState {
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Ready, Self::InvitationCreated)
                | (Self::InvitationCreated, Self::WaitingForRequest)
                | (Self::WaitingForRequest, Self::VerifyingIdentity)
                | (Self::WaitingForRequest, Self::Expired)
                | (Self::WaitingForRequest, Self::Ready)
                | (Self::VerifyingIdentity, Self::WaitingForApproval)
                | (Self::VerifyingIdentity, Self::Failed)
                | (Self::VerifyingIdentity, Self::Expired)
                | (Self::WaitingForApproval, Self::Authorized)
                | (Self::WaitingForApproval, Self::Denied)
                | (Self::WaitingForApproval, Self::Expired)
                | (Self::Authorized, Self::Connected)
                | (Self::Authorized, Self::Revoked)
                | (Self::Connected, Self::Revoked)
                | (Self::Connected, Self::Ready)
                | (Self::Denied, Self::Ready)
                | (Self::Expired, Self::Ready)
                | (Self::Failed, Self::Ready)
                | (Self::Revoked, Self::Ready)
        )
    }

    pub fn transition(&mut self, next: Self) -> Result<(), JackError> {
        if !self.can_transition_to(next) {
            return Err(JackError::InvalidInput(format!(
                "invalid state transition {:?} -> {:?}",
                self, next
            )));
        }
        *self = next;
        Ok(())
    }
}

pub fn generate_crockford_code() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    let mut out = String::with_capacity(9);
    for (i, b) in bytes.iter().enumerate() {
        if i == 4 {
            out.push('-');
        }
        out.push(CROCKFORD_ALPHABET[(b & 0x1F) as usize] as char);
    }
    out
}

pub fn normalize_crockford_code(raw: &str) -> Result<Zeroizing<String>, JackError> {
    let mut norm = String::with_capacity(8);
    for ch in raw.trim().chars() {
        if ch == '-' || ch == ' ' {
            continue;
        }
        let up = ch.to_ascii_uppercase();
        if !CROCKFORD_ALPHABET.contains(&(up as u8)) {
            return Err(JackError::InvalidInput(
                "invalid character in pairing code".into(),
            ));
        }
        norm.push(up);
    }
    if norm.len() != 8 {
        return Err(JackError::InvalidInput(
            "pairing code must be 8 Crockford Base32 characters".into(),
        ));
    }
    Ok(Zeroizing::new(norm))
}

#[derive(Clone)]
pub struct PairingInvitation {
    pub invite_id: [u8; 16],
    pub host_pk: [u8; 32],
    pub endpoint: String,
    code_norm: Zeroizing<String>,
    pake_secret: Zeroizing<[u8; 16]>,
    pub expires_at: u64,
    pub attempts: u8,
    pub consumed: bool,
    pub locked: bool,
    pub active_attempt: bool,
    pub state: PairingState,
}

impl fmt::Debug for PairingInvitation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingInvitation")
            .field("invite_id", &URL_SAFE_NO_PAD.encode(self.invite_id))
            .field("endpoint", &self.endpoint)
            .field("expires_at", &self.expires_at)
            .field("attempts", &self.attempts)
            .field("consumed", &self.consumed)
            .field("locked", &self.locked)
            .field("state", &self.state)
            .field("code_norm", &"[REDACTED]")
            .field("pake_secret", &"[REDACTED]")
            .finish()
    }
}

impl PairingInvitation {
    pub fn create(host_pk: [u8; 32], endpoint: String, ttl_secs: u64) -> Result<Self, JackError> {
        if ttl_secs == 0 || ttl_secs > MAX_INVITE_TTL_SECS {
            return Err(JackError::InvalidInput(
                "invitation TTL must be between 1 and 300 seconds".into(),
            ));
        }
        let mut invite_id = [0u8; 16];
        let mut pake = [0u8; 16];
        OsRng.fill_bytes(&mut invite_id);
        OsRng.fill_bytes(&mut pake);

        let formatted = generate_crockford_code();
        let code_norm = normalize_crockford_code(&formatted)?;
        let mut state = PairingState::Ready;
        state.transition(PairingState::InvitationCreated)?;
        state.transition(PairingState::WaitingForRequest)?;

        Ok(Self {
            invite_id,
            host_pk,
            endpoint,
            code_norm,
            pake_secret: Zeroizing::new(pake),
            expires_at: now_unix().saturating_add(ttl_secs),
            attempts: 0,
            consumed: false,
            locked: false,
            active_attempt: false,
            state,
        })
    }

    pub fn formatted_code(&self) -> String {
        format!("{}-{}", &self.code_norm[..4], &self.code_norm[4..])
    }

    pub fn to_qr_uri(&self) -> Result<Zeroizing<String>, JackError> {
        let id_b64 = URL_SAFE_NO_PAD.encode(self.invite_id);
        let pk_b64 = URL_SAFE_NO_PAD.encode(self.host_pk);
        let ep_b64 = URL_SAFE_NO_PAD.encode(self.endpoint.as_bytes());
        let pake_b64 = URL_SAFE_NO_PAD.encode(*self.pake_secret);
        let uri = format!(
            "jack://pair?v={}&id={}&pk={}&ep={}&exp={}&pake={}",
            PROTOCOL_VERSION, id_b64, pk_b64, ep_b64, self.expires_at, pake_b64
        );
        if uri.len() > MAX_QR_URI_BYTES {
            return Err(JackError::InvalidInput("QR URI exceeds 1024 bytes".into()));
        }
        Ok(Zeroizing::new(uri))
    }

    pub fn begin_attempt(&mut self, now: u64) -> Result<(), JackError> {
        if self.locked || self.attempts >= MAX_PAIRING_ATTEMPTS {
            return Err(JackError::PairingLocked);
        }
        if self.consumed {
            return Err(JackError::InviteConsumed);
        }
        if now > self.expires_at {
            let _ = self.state.transition(PairingState::Expired);
            return Err(JackError::InviteExpired);
        }
        if self.active_attempt {
            return Err(JackError::PairingBusy);
        }
        self.active_attempt = true;
        self.state.transition(PairingState::VerifyingIdentity)?;
        Ok(())
    }

    pub fn record_failed_attempt(&mut self) {
        self.active_attempt = false;
        self.attempts = self.attempts.saturating_add(1);
        if self.attempts >= MAX_PAIRING_ATTEMPTS {
            self.locked = true;
            let _ = self.state.transition(PairingState::Failed);
        } else {
            self.state = PairingState::WaitingForRequest;
        }
    }

    pub fn mark_awaiting_approval(&mut self) -> Result<(), JackError> {
        self.state.transition(PairingState::WaitingForApproval)
    }

    pub fn mark_authorized(&mut self) -> Result<(), JackError> {
        self.consumed = true;
        self.active_attempt = false;
        self.state.transition(PairingState::Authorized)
    }

    pub fn mark_denied(&mut self) -> Result<(), JackError> {
        self.consumed = true;
        self.active_attempt = false;
        self.state.transition(PairingState::Denied)
    }

    pub fn code_secret_bytes(&self) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(self.code_norm.as_bytes().to_vec())
    }

    pub fn qr_secret_bytes(&self) -> Zeroizing<Vec<u8>> {
        Zeroizing::new(self.pake_secret.to_vec())
    }
}

pub struct ParsedQrInvitation {
    pub version: u8,
    pub invite_id: [u8; 16],
    pub host_pk: [u8; 32],
    pub endpoint: String,
    pub expires_at: u64,
    pub pake_secret: Zeroizing<[u8; 16]>,
}

impl fmt::Debug for ParsedQrInvitation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ParsedQrInvitation")
            .field("version", &self.version)
            .field("endpoint", &self.endpoint)
            .field("expires_at", &self.expires_at)
            .field("pake_secret", &"[REDACTED]")
            .finish()
    }
}

pub fn parse_qr_uri(uri: &str, now: u64) -> Result<ParsedQrInvitation, JackError> {
    if uri.len() > MAX_QR_URI_BYTES {
        return Err(JackError::InvalidInput(
            "QR URI exceeds 1024-byte limit".into(),
        ));
    }
    let query = uri
        .strip_prefix("jack://pair?")
        .ok_or_else(|| JackError::InvalidInput("invalid QR URI scheme".into()))?;

    let mut v: Option<u8> = None;
    let mut id: Option<[u8; 16]> = None;
    let mut pk: Option<[u8; 32]> = None;
    let mut ep: Option<String> = None;
    let mut exp: Option<u64> = None;
    let mut pake: Option<Zeroizing<[u8; 16]>> = None;

    for pair in query.split('&') {
        let (k, val) = pair
            .split_once('=')
            .ok_or_else(|| JackError::InvalidInput("malformed QR query param".into()))?;
        match k {
            "v" => {
                let parsed: u8 = val
                    .parse()
                    .map_err(|_| JackError::ProtocolVersion("invalid version".into()))?;
                if parsed != PROTOCOL_VERSION {
                    return Err(JackError::ProtocolVersion(format!(
                        "unsupported QR protocol version {}",
                        parsed
                    )));
                }
                v = Some(parsed);
            }
            "id" => {
                let bytes = URL_SAFE_NO_PAD
                    .decode(val)
                    .map_err(|_| JackError::InvalidInput("invalid invite id".into()))?;
                let arr: [u8; 16] = bytes
                    .try_into()
                    .map_err(|_| JackError::InvalidInput("invalid invite id length".into()))?;
                id = Some(arr);
            }
            "pk" => {
                let bytes = URL_SAFE_NO_PAD
                    .decode(val)
                    .map_err(|_| JackError::InvalidInput("invalid host pubkey".into()))?;
                let arr: [u8; 32] = bytes
                    .try_into()
                    .map_err(|_| JackError::InvalidInput("invalid host pubkey length".into()))?;
                pk = Some(arr);
            }
            "ep" => {
                let bytes = URL_SAFE_NO_PAD
                    .decode(val)
                    .map_err(|_| JackError::InvalidInput("invalid endpoint".into()))?;
                let s = String::from_utf8(bytes)
                    .map_err(|_| JackError::InvalidInput("non-utf8 endpoint".into()))?;
                ep = Some(s);
            }
            "exp" => {
                exp = Some(
                    val.parse()
                        .map_err(|_| JackError::InvalidInput("invalid expiry".into()))?,
                );
            }
            "pake" => {
                let bytes = URL_SAFE_NO_PAD
                    .decode(val)
                    .map_err(|_| JackError::InvalidInput("invalid pake secret".into()))?;
                let arr: [u8; 16] = bytes
                    .try_into()
                    .map_err(|_| JackError::InvalidInput("invalid pake length".into()))?;
                pake = Some(Zeroizing::new(arr));
            }
            other => {
                return Err(JackError::InvalidInput(format!(
                    "unsupported QR field '{}'",
                    other
                )));
            }
        }
    }

    let expires_at = exp.ok_or_else(|| JackError::InvalidInput("missing exp".into()))?;
    if now > expires_at {
        return Err(JackError::InviteExpired);
    }

    Ok(ParsedQrInvitation {
        version: v.ok_or_else(|| JackError::ProtocolVersion("missing v".into()))?,
        invite_id: id.ok_or_else(|| JackError::InvalidInput("missing id".into()))?,
        host_pk: pk.ok_or_else(|| JackError::InvalidInput("missing pk".into()))?,
        endpoint: ep.ok_or_else(|| JackError::InvalidInput("missing ep".into()))?,
        expires_at,
        pake_secret: pake.ok_or_else(|| JackError::InvalidInput("missing pake".into()))?,
    })
}

pub fn build_channel_transcript(
    invite_id: &[u8; 16],
    host_pk: &[u8; 32],
    client_pk: &[u8; 32],
    tls_cb: &[u8; 32],
) -> Vec<u8> {
    let mut t = Vec::with_capacity(12 + 16 + 32 + 32 + 32);
    t.extend_from_slice(b"jack-pair-v1");
    t.extend_from_slice(invite_id);
    t.extend_from_slice(host_pk);
    t.extend_from_slice(client_pk);
    t.extend_from_slice(tls_cb);
    t
}

pub struct DerivedPairingKeys {
    confirm_key: Zeroizing<[u8; 32]>,
    pub sas_6digit: String,
}

impl DerivedPairingKeys {
    pub fn confirm_key_bytes(&self) -> &[u8; 32] {
        &self.confirm_key
    }
}

pub fn derive_channel_bound_keys(
    spake2_shared: &[u8],
    tls_cb: &[u8; 32],
    transcript: &[u8],
) -> Result<DerivedPairingKeys, JackError> {
    let hk = Hkdf::<Sha256>::new(Some(tls_cb), spake2_shared);

    let mut confirm_info = Vec::with_capacity(19 + transcript.len());
    confirm_info.extend_from_slice(b"jack-pair-v1-confirm");
    confirm_info.extend_from_slice(transcript);
    let mut confirm_key = Zeroizing::new([0u8; 32]);
    hk.expand(&confirm_info, &mut *confirm_key)
        .map_err(|_| JackError::PakeBindingFailed)?;

    let mut sas_info = Vec::with_capacity(15 + transcript.len());
    sas_info.extend_from_slice(b"jack-pair-v1-sas");
    sas_info.extend_from_slice(transcript);
    let mut sas_bytes = [0u8; 4];
    hk.expand(&sas_info, &mut sas_bytes)
        .map_err(|_| JackError::PakeBindingFailed)?;
    let val = u32::from_be_bytes(sas_bytes) % 1_000_000;
    let sas_6digit = format!("{:03} {:03}", val / 1000, val % 1000);

    Ok(DerivedPairingKeys {
        confirm_key,
        sas_6digit,
    })
}

pub fn compute_confirm_mac(
    confirm_key: &[u8; 32],
    role_label: &[u8],
    transcript: &[u8],
) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(confirm_key).expect("HMAC key size valid");
    mac.update(role_label);
    mac.update(transcript);
    let out = mac.finalize().into_bytes();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

pub fn verify_confirm_mac(
    confirm_key: &[u8; 32],
    role_label: &[u8],
    transcript: &[u8],
    presented: &[u8; 32],
) -> Result<(), JackError> {
    let expected = compute_confirm_mac(confirm_key, role_label, transcript);
    if expected.ct_eq(presented).into() {
        Ok(())
    } else {
        Err(JackError::PakeBindingFailed)
    }
}

pub fn start_spake2_client(secret: &[u8]) -> (Spake2<Ed25519Group>, Vec<u8>) {
    Spake2::<Ed25519Group>::start_a(
        &Password::new(secret),
        &Identity::new(b"jack-client-v1"),
        &Identity::new(b"jack-host-v1"),
    )
}

pub fn start_spake2_host(secret: &[u8]) -> (Spake2<Ed25519Group>, Vec<u8>) {
    Spake2::<Ed25519Group>::start_b(
        &Password::new(secret),
        &Identity::new(b"jack-client-v1"),
        &Identity::new(b"jack-host-v1"),
    )
}
