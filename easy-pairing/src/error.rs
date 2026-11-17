use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JackError {
    ProtocolVersion(String),
    InviteExpired,
    InviteConsumed,
    PairingBusy,
    PairingLocked,
    PakeBindingFailed,
    SasMismatch,
    ApprovalDenied,
    ApprovalTimeout,
    ApprovalMismatch,
    ApprovalReplay,
    TrustRevoked,
    GrantExpired,
    ScopeDenied(String),
    SessionLimitReached,
    SessionIdleTimeout,
    HostShuttingDown,
    InvalidHostState(String),
    AuthStateUnavailable(String),
    KeystoreUnavailable(String),
    HostUnreachable(String),
    LoopbackOnly(String),
    InvalidInput(String),
    Io(String),
}

impl JackError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProtocolVersion(_) => "ERR_PROTOCOL_VERSION",
            Self::InviteExpired => "ERR_INVITE_EXPIRED",
            Self::InviteConsumed => "ERR_INVITE_CONSUMED",
            Self::PairingBusy => "ERR_PAIRING_BUSY",
            Self::PairingLocked => "ERR_PAIRING_LOCKED",
            Self::PakeBindingFailed => "ERR_PAKE_BINDING_FAILED",
            Self::SasMismatch => "ERR_SAS_MISMATCH",
            Self::ApprovalDenied => "ERR_APPROVAL_DENIED",
            Self::ApprovalTimeout => "ERR_APPROVAL_TIMEOUT",
            Self::ApprovalMismatch => "ERR_APPROVAL_MISMATCH",
            Self::ApprovalReplay => "ERR_APPROVAL_REPLAY",
            Self::TrustRevoked => "ERR_TRUST_REVOKED",
            Self::GrantExpired => "ERR_GRANT_EXPIRED",
            Self::ScopeDenied(_) => "ERR_SCOPE_DENIED",
            Self::SessionLimitReached => "ERR_SESSION_LIMIT_REACHED",
            Self::SessionIdleTimeout => "ERR_SESSION_IDLE_TIMEOUT",
            Self::HostShuttingDown => "ERR_HOST_SHUTTING_DOWN",
            Self::InvalidHostState(_) => "ERR_INVALID_HOST_STATE",
            Self::AuthStateUnavailable(_) => "ERR_AUTH_STATE_UNAVAILABLE",
            Self::KeystoreUnavailable(_) => "ERR_KEYSTORE_UNAVAILABLE",
            Self::HostUnreachable(_) => "ERR_HOST_UNREACHABLE",
            Self::LoopbackOnly(_) => "ERR_LOOPBACK_ONLY",
            Self::InvalidInput(_) => "ERR_INVALID_INPUT",
            Self::Io(_) => "ERR_IO",
        }
    }
}

impl fmt::Display for JackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProtocolVersion(m)
            | Self::ScopeDenied(m)
            | Self::InvalidHostState(m)
            | Self::AuthStateUnavailable(m)
            | Self::KeystoreUnavailable(m)
            | Self::HostUnreachable(m)
            | Self::LoopbackOnly(m)
            | Self::InvalidInput(m)
            | Self::Io(m) => write!(f, "{}: {}", self.code(), m),
            _ => write!(f, "{}", self.code()),
        }
    }
}

impl std::error::Error for JackError {}
