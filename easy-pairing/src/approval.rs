use crate::auth::{now_unix, DurationPolicy};
use crate::error::JackError;
use crate::identity::DeviceId;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct ApprovalRequest {
    pub request_id: String,
    pub invite_id: [u8; 16],
    pub peer_id: DeviceId,
    pub peer_display_name: String,
    pub requested_scope: String,
    pub requested_duration: DurationPolicy,
    pub sas_6digit: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub request_id: String,
    pub invite_id: [u8; 16],
    pub peer_id: DeviceId,
    pub approved: bool,
    pub granted_duration: DurationPolicy,
}

#[derive(Debug, Default)]
pub struct ApprovalGate {
    pending: Option<ApprovalRequest>,
    consumed_requests: HashSet<String>,
    seq: u64,
}

impl ApprovalGate {
    #[allow(clippy::too_many_arguments)]
    pub fn open_request(
        &mut self,
        invite_id: [u8; 16],
        peer_id: DeviceId,
        peer_display_name: String,
        requested_scope: String,
        requested_duration: DurationPolicy,
        sas_6digit: String,
        ttl_secs: u64,
        now: u64,
    ) -> Result<ApprovalRequest, JackError> {
        if self.pending.is_some() {
            return Err(JackError::PairingBusy);
        }
        self.seq = self.seq.saturating_add(1);
        let req = ApprovalRequest {
            request_id: format!("apr-{}-{}", now, self.seq),
            invite_id,
            peer_id,
            peer_display_name,
            requested_scope,
            requested_duration,
            sas_6digit,
            expires_at: now.saturating_add(ttl_secs),
        };
        self.pending = Some(req.clone());
        Ok(req)
    }

    pub fn resolve(
        &mut self,
        decision: &ApprovalDecision,
        now: u64,
    ) -> Result<DurationPolicy, JackError> {
        if self.consumed_requests.contains(&decision.request_id) {
            return Err(JackError::ApprovalReplay);
        }
        let pending = self.pending.take().ok_or(JackError::ApprovalMismatch)?;

        if pending.request_id != decision.request_id
            || pending.invite_id != decision.invite_id
            || pending.peer_id != decision.peer_id
        {
            // Restore pending only if mismatch came from an unrelated spoofed decision
            self.pending = Some(pending);
            return Err(JackError::ApprovalMismatch);
        }

        self.consumed_requests.insert(pending.request_id);

        if now > pending.expires_at {
            return Err(JackError::ApprovalTimeout);
        }
        if !decision.approved {
            return Err(JackError::ApprovalDenied);
        }
        Ok(decision.granted_duration)
    }

    pub fn cancel_pending(&mut self) {
        if let Some(p) = self.pending.take() {
            self.consumed_requests.insert(p.request_id);
        }
    }

    pub fn has_pending(&self) -> bool {
        self.pending.is_some()
    }

    pub fn pending_invite_id(&self) -> Option<[u8; 16]> {
        self.pending.as_ref().map(|p| p.invite_id)
    }
}

pub fn make_approval_decision(
    req: &ApprovalRequest,
    approved: bool,
    granted_duration: DurationPolicy,
) -> ApprovalDecision {
    let _ = now_unix();
    ApprovalDecision {
        request_id: req.request_id.clone(),
        invite_id: req.invite_id,
        peer_id: req.peer_id.clone(),
        approved,
        granted_duration,
    }
}
