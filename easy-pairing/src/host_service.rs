use crate::error::JackError;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostState {
    Stopped,
    Starting,
    Ready,
    Pairing,
    Authorizing,
    Active,
    Stopping,
    Failed,
}

impl HostState {
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Stopped, Self::Starting)
                | (Self::Starting, Self::Ready)
                | (Self::Starting, Self::Failed)
                | (Self::Ready, Self::Pairing)
                | (Self::Ready, Self::Active)
                | (Self::Ready, Self::Stopping)
                | (Self::Ready, Self::Failed)
                | (Self::Pairing, Self::Authorizing)
                | (Self::Pairing, Self::Ready)
                | (Self::Pairing, Self::Stopping)
                | (Self::Pairing, Self::Failed)
                | (Self::Authorizing, Self::Active)
                | (Self::Authorizing, Self::Ready)
                | (Self::Authorizing, Self::Stopping)
                | (Self::Authorizing, Self::Failed)
                | (Self::Active, Self::Ready)
                | (Self::Active, Self::Pairing)
                | (Self::Active, Self::Stopping)
                | (Self::Active, Self::Failed)
                | (Self::Stopping, Self::Stopped)
                | (Self::Stopping, Self::Failed)
                | (Self::Failed, Self::Stopped)
        )
    }
}

#[derive(Debug, Clone)]
pub struct HostServiceConfig {
    pub max_concurrent_sessions: usize,
    pub session_idle_timeout_secs: u64,
    pub session_max_lifetime_secs: u64,
    pub approval_timeout_secs: u64,
}

impl Default for HostServiceConfig {
    fn default() -> Self {
        Self {
            max_concurrent_sessions: 4,
            session_idle_timeout_secs: 300,
            session_max_lifetime_secs: 3600,
            approval_timeout_secs: 60,
        }
    }
}

pub trait PlatformHostAdapter: Send + Sync {
    fn platform_name(&self) -> &'static str;
    fn user_space_only(&self) -> bool;
}

pub struct CurrentPlatformAdapter;

impl PlatformHostAdapter for CurrentPlatformAdapter {
    fn platform_name(&self) -> &'static str {
        std::env::consts::OS
    }

    fn user_space_only(&self) -> bool {
        true
    }
}

#[derive(Debug)]
pub struct HostLifecycle {
    state: HostState,
    shutdown_requested: AtomicBool,
}

impl Default for HostLifecycle {
    fn default() -> Self {
        Self::new()
    }
}

impl HostLifecycle {
    pub fn new() -> Self {
        Self {
            state: HostState::Stopped,
            shutdown_requested: AtomicBool::new(false),
        }
    }

    pub fn state(&self) -> HostState {
        self.state
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutdown_requested.load(Ordering::SeqCst)
            || matches!(
                self.state,
                HostState::Stopping | HostState::Stopped | HostState::Failed
            )
    }

    pub fn transition(&mut self, next: HostState) -> Result<(), JackError> {
        if !self.state.can_transition_to(next) {
            return Err(JackError::InvalidHostState(format!(
                "invalid host transition {:?} -> {:?}",
                self.state, next
            )));
        }
        if matches!(
            next,
            HostState::Stopping | HostState::Stopped | HostState::Failed
        ) {
            self.shutdown_requested.store(true, Ordering::SeqCst);
        } else if next == HostState::Starting {
            self.shutdown_requested.store(false, Ordering::SeqCst);
        }
        self.state = next;
        Ok(())
    }

    pub fn start(&mut self) -> Result<(), JackError> {
        self.transition(HostState::Starting)?;
        self.transition(HostState::Ready)?;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), JackError> {
        if self.state == HostState::Stopped {
            return Ok(());
        }
        if self.state != HostState::Stopping && self.state != HostState::Failed {
            self.transition(HostState::Stopping)?;
        }
        self.transition(HostState::Stopped)?;
        Ok(())
    }
}
