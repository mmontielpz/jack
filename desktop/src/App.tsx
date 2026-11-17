import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClientPairingStatus,
  ConnectResult,
  DeviceEntry,
  DeviceStatusJson,
  DiagnoseJson,
  DiscoveryResult,
  DoctorJson,
  EpStatusReadResponse,
  HostShareStatus,
  NetworkReachabilityResult,
  PlatformInfo,
  PreflightResult,
  ResetPreview,
  SshAuthTestResult,
  TailscalePeer,
  TailscaleState,
  WizardSaveRequest,
  isValidAlias,
  isValidHost,
  isValidUser,
  jackApi,
  normalizeAuthCode,
  sanitizeAlias,
  validateAuthCode,
  validateEndpoint,
} from "./api/jack";
import {
  BadgeKind,
  EpWizardSidebar,
  GearIcon,
  JackMark,
  OsIcon,
  StatusBadge,
  TitleBar,
  UserIcon,
  WizardSidebar,
} from "./components/DesignSystem";
import { EN } from "./i18n/en";

function formatEpUserError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("err_pake_binding_failed") || lower.includes("invalid") && lower.includes("code")) {
    return "Invalid or expired Auth Code. Check the code and try again.";
  }
  if (lower.includes("err_invite_expired") || lower.includes("expired")) {
    return "This Auth Code has expired. Generate a new code and try again.";
  }
  if (lower.includes("err_approval_denied")) {
    return "The host denied this pairing request.";
  }
  if (lower.includes("err_approval_timeout")) {
    return "Approval timed out on the host. Please try again.";
  }
  if (lower.includes("err_sas_mismatch") || lower.includes("did not match")) {
    return "Verification codes did not match. Pairing cancelled.";
  }
  if (lower.includes("err_loopback_only") || lower.includes("err_invalid_input")) {
    return "Enter a valid local loopback address (for example, 127.0.0.1:45123).";
  }
  if (lower.includes("err_revoked")) {
    return "Access was revoked by the host.";
  }
  if (lower.includes("disconnected before completing")) {
    return "The other device cancelled pairing. You can try again or regenerate the code.";
  }
  if (lower.includes("err_io") || lower.includes("timed out") || lower.includes("os error 11")) {
    return "Pairing connection timed out or was interrupted. Please try again.";
  }
  if (lower.startsWith("err_")) {
    return "Pairing could not be completed. Please try again.";
  }
  return raw;
}

type AppState = "EASY_PAIRING" | "ONBOARDING" | "DASHBOARD" | "DIAGNOSTICS" | "SETTINGS";
type EpScreen = "HOME" | "SHARE" | "ENTER_CODE" | "VERIFY_SAS" | "CONNECTED";
type OnboardingStage = "WELCOME" | "S1" | "S2" | "S3" | "S4";
type CompletionKind = "CONNECTED" | "SIMULATION" | "FAILED" | "NEEDS_SETUP";

const STAGE_NUM: Record<OnboardingStage, number> = {
  WELCOME: 0,
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
};

function mapDeviceStatusBadge(
  device: DeviceEntry,
  liveStatus?: DeviceStatusJson,
): { kind: BadgeKind; label: string } {
  if (!device.complete) {
    return { kind: "error", label: EN.dashboard.statusError };
  }
  if (!liveStatus) {
    return { kind: "configured", label: EN.dashboard.statusConfigured };
  }
  const upperStatus = liveStatus.status.toUpperCase();
  const reach = liveStatus.device.reachability.toLowerCase();
  if (upperStatus === "ERROR" || upperStatus === "MISCONFIGURED") {
    return { kind: "error", label: EN.dashboard.statusError };
  }
  if (reach === "reachable" || upperStatus === "HEALTHY") {
    return { kind: "ready", label: EN.dashboard.statusOnline };
  }
  if (reach === "unreachable") {
    return { kind: "warn", label: EN.dashboard.statusOffline };
  }
  return { kind: "configured", label: EN.dashboard.statusUnknown };
}

export function App() {
  const [appState, setAppState] = useState<AppState>("EASY_PAIRING");
  const [stage, setStage] = useState<OnboardingStage>("WELCOME");
  const [wizardOrigin, setWizardOrigin] = useState<"FIRST_RUN" | "DASHBOARD">("FIRST_RUN");
  const [diagnosticsOrigin, setDiagnosticsOrigin] = useState<"WELCOME" | "DASHBOARD">("DASHBOARD");

  const [cliVersion, setCliVersion] = useState<string>("");
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, DeviceStatusJson>>({});
  const [checkingAlias, setCheckingAlias] = useState<string | null>(null);

  const [doctor, setDoctor] = useState<DoctorJson | null>(null);
  const [diagnose, setDiagnose] = useState<DiagnoseJson | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  // Stage 1: Check Tailscale
  const [tailscaleState, setTailscaleState] = useState<TailscaleState | null>(null);
  const [tailscaleLoading, setTailscaleLoading] = useState(false);
  const stageSeqRef = useRef(0);
  const autoAdvanceTimerRef = useRef<number | null>(null);

  // Stage 2: Choose Device
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [peerFilter, setPeerFilter] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<TailscalePeer | null>(null);
  const [targetHost, setTargetHost] = useState("");
  const [targetAlias, setTargetAlias] = useState("");

  // Stage 3: Connect & Verify
  const [sshUser, setSshUser] = useState("");
  const [setDefault, setSetDefault] = useState(true);
  const [checksLoading, setChecksLoading] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [networkResult, setNetworkResult] = useState<NetworkReachabilityResult | null>(null);
  const [sshConsent, setSshConsent] = useState(false);
  const [sshAuthResult, setSshAuthResult] = useState<SshAuthTestResult | null>(null);
  const [busyAction, setBusyAction] = useState<"verify" | "save" | null>(null);
  const checkSeqRef = useRef(0);
  const writeLockRef = useRef(false);

  // Stage 4: Ready
  const [completionKind, setCompletionKind] = useState<CompletionKind>("NEEDS_SETUP");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);

  // Settings / Reset state
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Easy Pairing (EP-004 Auth Code-first) state
  const [epScreen, setEpScreen] = useState<EpScreen>("HOME");
  const [hostShare, setHostShare] = useState<HostShareStatus | null>(null);
  const [epBindOptions, setEpBindOptions] = useState<string[]>(["127.0.0.1"]);
  const [epSelectedBindIp, setEpSelectedBindIp] = useState<string>("127.0.0.1");
  const [epCodeInput, setEpCodeInput] = useState("");
  const [epEndpointInput, setEpEndpointInput] = useState("127.0.0.1:");
  const [epCodeError, setEpCodeError] = useState<string | null>(null);
  const [epEndpointError, setEpEndpointError] = useState<string | null>(null);
  const [epClientStatus, setEpClientStatus] = useState<ClientPairingStatus | null>(null);
  const [epLiveStatus, setEpLiveStatus] = useState<EpStatusReadResponse | null>(null);
  const [epBusy, setEpBusy] = useState(false);
  const [epHostAuthorizing, setEpHostAuthorizing] = useState(false);
  const [epTick, setEpTick] = useState(0);

  const clearAutoAdvance = () => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  };

  useEffect(() => () => clearAutoAdvance(), []);

  const effectiveAlias = useMemo(() => {
    const trimmed = targetAlias.trim();
    if (trimmed) return trimmed;
    if (selectedPeer) return sanitizeAlias(selectedPeer.name);
    if (targetHost.trim()) return sanitizeAlias(targetHost.trim());
    return "";
  }, [targetAlias, selectedPeer, targetHost]);

  const buildWizardRequest = (
    hostOverride?: string,
    aliasOverride?: string,
    userOverride?: string,
    confirmed = false,
  ): WizardSaveRequest => ({
    mode: "device",
    device_alias: aliasOverride ?? effectiveAlias,
    device_user: (userOverride ?? sshUser).trim(),
    device_host: (hostOverride ?? targetHost).trim(),
    set_default: setDefault,
    confirmed,
  });

  const resetWizardDraft = () => {
    clearAutoAdvance();
    stageSeqRef.current += 1;
    checkSeqRef.current += 1;
    writeLockRef.current = false;
    setTailscaleState(null);
    setDiscovery(null);
    setPeerFilter("");
    setManualMode(false);
    setSelectedPeer(null);
    setTargetHost("");
    setTargetAlias("");
    setSshUser("");
    setSetDefault(true);
    setPreflight(null);
    setNetworkResult(null);
    setSshConsent(false);
    setSshAuthResult(null);
    setBusyAction(null);
    setErrorMsg(null);
  };

  const refreshDevices = async (): Promise<DeviceEntry[]> => {
    const list = await jackApi.listDevices();
    setDevices(list);
    return list;
  };

  const loadDiscovery = async () => {
    setDiscoveryLoading(true);
    try {
      const res = await jackApi.discoverTailscalePeers();
      setDiscovery(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const checkTailscaleAndMaybeAdvance = async (allowAutoAdvance = true) => {
    clearAutoAdvance();
    const seq = ++stageSeqRef.current;
    setTailscaleLoading(true);
    setErrorMsg(null);
    try {
      const ts = await jackApi.getTailscaleState();
      if (seq !== stageSeqRef.current) return;
      setTailscaleState(ts);
      if (ts.status_category === "CONNECTED" && allowAutoAdvance) {
        void loadDiscovery();
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          if (seq !== stageSeqRef.current) return;
          setManualMode(false);
          setStage("S2");
        }, 350);
      }
    } catch (err) {
      if (seq !== stageSeqRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === stageSeqRef.current) {
        setTailscaleLoading(false);
      }
    }
  };

  const runStage3PreflightOnly = async (hostToCheck: string, aliasToCheck: string, userToCheck: string) => {
    const seq = ++checkSeqRef.current;
    try {
      const preRes = await jackApi.runPreflight(
        buildWizardRequest(hostToCheck, aliasToCheck, userToCheck, false),
      );
      if (seq !== checkSeqRef.current) return;
      setPreflight(preRes);
    } catch (err) {
      if (seq !== checkSeqRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const runStage3InitialChecks = async (hostToCheck: string, aliasToCheck: string, userToCheck: string) => {
    const seq = ++checkSeqRef.current;
    setChecksLoading(true);
    setPreflight(null);
    setNetworkResult(null);
    setErrorMsg(null);
    try {
      const [preRes, netRes] = await Promise.all([
        jackApi.runPreflight(buildWizardRequest(hostToCheck, aliasToCheck, userToCheck, false)),
        isValidHost(hostToCheck)
          ? jackApi.checkNetworkReachability(hostToCheck)
          : Promise.resolve<NetworkReachabilityResult>({
              status: "NOT_TESTED",
              detail: "Invalid host address.",
            }),
      ]);
      if (seq !== checkSeqRef.current) return;
      setPreflight(preRes);
      setNetworkResult(netRes);
    } catch (err) {
      if (seq !== checkSeqRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === checkSeqRef.current) {
        setChecksLoading(false);
      }
    }
  };

  const loadDiagnostics = async () => {
    setDiagLoading(true);
    setErrorMsg(null);
    try {
      const [docRes, diagRes] = await Promise.all([jackApi.runDoctor(), jackApi.runDiagnose()]);
      setDoctor(docRes);
      setDiagnose(diagRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagLoading(false);
    }
  };

  const loadSettingsData = async () => {
    try {
      const preview = await jackApi.previewResetConfig();
      setResetPreview(preview);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const boot = async () => {
      const params = new URLSearchParams(window.location.search);
      const epParam = params.get("ep")?.toLowerCase();
      const stepParam = params.get("step")?.toLowerCase();
      const stateParam = params.get("state");

      if (epParam === "home") {
        setAppState("EASY_PAIRING");
        setEpScreen("HOME");
      } else if (epParam === "share") {
        setAppState("EASY_PAIRING");
        setEpScreen("SHARE");
        setHostShare({
          active: true,
          state: "WaitingForRequest",
          endpoint: "127.0.0.1:45123",
          auth_code: "7K9M-2P4Q",
          expires_at: Math.floor(Date.now() / 1000) + 295,
        });
      } else if (epParam === "approve") {
        setAppState("EASY_PAIRING");
        setEpScreen("SHARE");
        setHostShare({
          active: true,
          state: "Authorizing",
          endpoint: "127.0.0.1:45123",
          auth_code: "7K9M-2P4Q",
          expires_at: Math.floor(Date.now() / 1000) + 240,
          pending_request: {
            request_id: "apr-preview-1",
            peer_id: "jack:ed25519:demo9f3a2b1c4d5e",
            peer_name: "linux-workstation",
            requested_scope: "status.read",
            sas_6digit: "482 910",
            expires_at: Math.floor(Date.now() / 1000) + 55,
          },
        });
      } else if (epParam === "enter-code") {
        setAppState("EASY_PAIRING");
        setEpScreen("ENTER_CODE");
        setEpEndpointInput("127.0.0.1:45123");
        setEpCodeInput("7K9M-2P4Q");
      } else if (epParam === "verify-sas") {
        setAppState("EASY_PAIRING");
        setEpScreen("VERIFY_SAS");
        setEpClientStatus({ stage: "VerifySas", sas_6digit: "482 910" });
      } else if (epParam === "connected") {
        setAppState("EASY_PAIRING");
        setEpScreen("CONNECTED");
        setEpClientStatus({
          stage: "Connected",
          host_id: "jack:ed25519:host8a7b6c5d4e3f",
          status_read: { status: "ok", os: "linux", jack_version: "0.1.0", uptime_seconds: 12 },
        });
        setEpLiveStatus({ status: "ok", os: "linux", jack_version: "0.1.0", uptime_seconds: 12 });
      } else if (epParam === "error") {
        setAppState("EASY_PAIRING");
        setEpScreen("ENTER_CODE");
        setErrorMsg(formatEpUserError("ERR_INVITE_EXPIRED"));
      } else if (stateParam === "dashboard") {
        setAppState("DASHBOARD");
      } else if (stateParam === "diagnostics") {
        setDiagnosticsOrigin("WELCOME");
        setAppState("DIAGNOSTICS");
        void loadDiagnostics();
      } else if (stateParam === "settings") {
        setAppState("SETTINGS");
        void loadSettingsData();
      } else if (stepParam === "01" || stepParam === "welcome") {
        setAppState("ONBOARDING");
        setStage("WELCOME");
      } else if (stepParam === "s1") {
        setAppState("ONBOARDING");
        setStage("S1");
        void checkTailscaleAndMaybeAdvance(false);
      } else if (stepParam === "s2") {
        setAppState("ONBOARDING");
        setStage("S2");
        void loadDiscovery();
      } else if (stepParam === "s3") {
        setAppState("ONBOARDING");
        setStage("S3");
        setTargetHost("100.64.0.10");
        setTargetAlias("demo-device");
        void runStage3InitialChecks("100.64.0.10", "demo-device", "");
      } else if (stepParam === "s4") {
        setAppState("ONBOARDING");
        setStage("S4");
        setTargetHost("100.64.0.10");
        setTargetAlias("demo-device");
        setSshUser("alice");
        setCompletionKind("CONNECTED");
      } else {
        setAppState("EASY_PAIRING");
        setEpScreen("HOME");
      }

      // Non-blocking background metadata load: missing bash CLI on Windows never stalls or breaks Easy Pairing
      const [verRes, platRes, listRes] = await Promise.allSettled([
        jackApi.getCliVersion(),
        jackApi.getPlatformInfo(),
        jackApi.listDevices(),
      ]);
      if (verRes.status === "fulfilled") {
        setCliVersion(verRes.value);
      }
      if (platRes.status === "fulfilled") {
        setPlatformInfo(platRes.value);
      }
      if (listRes.status === "fulfilled") {
        setDevices(listRes.value);
        if (!epParam && !stepParam && !stateParam && listRes.value.length > 0) {
          setAppState("DASHBOARD");
        } else if (stateParam === "diagnostics") {
          setDiagnosticsOrigin(listRes.value.length > 0 ? "DASHBOARD" : "WELCOME");
        }
      }
    };
    void boot();
  }, []);

  const filteredPeers = useMemo(() => {
    const peers = discovery?.peers ?? [];
    const q = peerFilter.trim().toLowerCase();
    if (!q) return peers;
    return peers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.os.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q),
    );
  }, [discovery, peerFilter]);

  const isManualValid = useMemo(
    () => isValidHost(targetHost.trim()) && isValidAlias(effectiveAlias),
    [targetHost, effectiveAlias],
  );

  const isUsernameValid = useMemo(() => isValidUser(sshUser.trim()), [sshUser]);

  const startFirstRunSetup = () => {
    resetWizardDraft();
    setWizardOrigin("FIRST_RUN");
    setStage("S1");
    setAppState("ONBOARDING");
    void checkTailscaleAndMaybeAdvance(true);
  };

  const startAddDeviceFromDashboard = () => {
    resetWizardDraft();
    setWizardOrigin("DASHBOARD");
    setStage("S1");
    setAppState("ONBOARDING");
    void checkTailscaleAndMaybeAdvance(true);
  };

  const enterStage3 = (host: string, alias: string) => {
    clearAutoAdvance();
    setSshConsent(false);
    setSshAuthResult(null);
    setErrorMsg(null);
    setStage("S3");
    void runStage3InitialChecks(host, alias, sshUser.trim());
  };

  const handleSelectPeerAndAdvance = (peer: TailscalePeer) => {
    const host = (peer.address || peer.name).trim();
    const alias = sanitizeAlias(peer.name);
    setSelectedPeer(peer);
    setTargetHost(host);
    setTargetAlias(alias);
    setManualMode(false);
    enterStage3(host, alias);
  };

  const handleManualContinue = () => {
    if (!isManualValid) {
      if (targetAlias.trim() && !isValidAlias(targetAlias.trim())) {
        setErrorMsg(EN.errors.invalidAlias);
      } else {
        setErrorMsg(EN.errors.missingSelection);
      }
      return;
    }
    setSelectedPeer(null);
    enterStage3(targetHost.trim(), effectiveAlias);
  };

  const handleUsernameChange = (nextUser: string) => {
    setSshUser(nextUser);
    setSshConsent(false);
    setSshAuthResult(null);
    setErrorMsg(null);
    void runStage3PreflightOnly(targetHost.trim(), effectiveAlias, nextUser.trim());
  };

  const persistDevice = async (): Promise<boolean> => {
    const res = await jackApi.saveWizardConfig(
      buildWizardRequest(undefined, undefined, undefined, true),
    );
    setDevices(res.devices);
    return res.saved;
  };

  const handleVerifyConnection = async () => {
    if (writeLockRef.current || busyAction !== null) return;
    if (!isUsernameValid) {
      setErrorMsg(EN.errors.invalidUser);
      return;
    }
    if (!sshConsent) return;

    writeLockRef.current = true;
    setBusyAction("verify");
    setErrorMsg(null);
    try {
      const pre = await jackApi.runPreflight(
        buildWizardRequest(undefined, undefined, undefined, false),
      );
      setPreflight(pre);
      if (!pre.can_save) {
        setErrorMsg(EN.errors.preflightBlocked);
        return;
      }

      const authRes = await jackApi.testSshAuthentication(
        sshUser.trim(),
        targetHost.trim(),
        sshConsent,
      );
      setSshAuthResult(authRes);

      if (authRes.status === "FAILED") {
        setErrorMsg(authRes.detail);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      writeLockRef.current = false;
      setBusyAction(null);
    }
  };

  const handleSaveAndContinue = async (mode: "verified" | "simulation" | "unverified") => {
    if (writeLockRef.current || busyAction !== null) return;
    if (!isUsernameValid) {
      setErrorMsg(EN.errors.invalidUser);
      return;
    }

    writeLockRef.current = true;
    setBusyAction("save");
    setErrorMsg(null);
    try {
      const pre = await jackApi.runPreflight(
        buildWizardRequest(undefined, undefined, undefined, false),
      );
      setPreflight(pre);
      if (!pre.can_save) {
        setErrorMsg(EN.errors.preflightBlocked);
        return;
      }
      await persistDevice();
      if (mode === "verified") {
        setCompletionKind("CONNECTED");
      } else if (mode === "simulation") {
        setCompletionKind("SIMULATION");
      } else {
        setCompletionKind(sshAuthResult?.status === "FAILED" ? "FAILED" : "NEEDS_SETUP");
      }
      setStage("S4");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      writeLockRef.current = false;
      setBusyAction(null);
    }
  };

  const handleConnect = async (alias: string) => {
    setErrorMsg(null);
    setActionMsg(null);
    try {
      const res = await jackApi.launchConnect(alias);
      setConnectResult(res);
      setActionMsg(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCheckStatus = async (alias: string) => {
    setCheckingAlias(alias);
    setErrorMsg(null);
    try {
      const st = await jackApi.getDeviceStatus(alias);
      setDeviceStatuses((prev) => ({ ...prev, [alias]: st }));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingAlias(null);
    }
  };

  const handleSetDefault = async (alias: string) => {
    setErrorMsg(null);
    try {
      const msg = await jackApi.setDefaultDevice(alias);
      setActionMsg(msg);
      await refreshDevices();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetConfirm = async () => {
    setResetting(true);
    setErrorMsg(null);
    try {
      const res = await jackApi.resetJackConfig(true);
      setDevices([]);
      setDeviceStatuses({});
      setShowResetConfirm(false);
      resetWizardDraft();
      setActionMsg(res.message);
      setWizardOrigin("FIRST_RUN");
      setStage("WELCOME");
      setAppState("ONBOARDING");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  // Easy Pairing polling (Host share & Client WaitingApproval)
  useEffect(() => {
    if (appState !== "EASY_PAIRING" || epScreen !== "SHARE" || !hostShare?.active) return;
    if (new URLSearchParams(window.location.search).has("ep")) return; // static preview
    const id = window.setInterval(() => {
      setEpTick((t) => t + 1);
      void jackApi
        .epHostPollStatus()
        .then((st) => {
          setHostShare(st);
          if (st.paired_peer_id || st.error || !st.active) {
            setEpHostAuthorizing(false);
          }
          if (st.error) setErrorMsg(formatEpUserError(st.error));
        })
        .catch(() => {});
    }, 400);
    return () => window.clearInterval(id);
  }, [appState, epScreen, hostShare?.active, hostShare?.endpoint]);

  useEffect(() => {
    if (
      appState !== "EASY_PAIRING" ||
      (epClientStatus?.stage !== "WaitingApproval" && epClientStatus?.stage !== "Connecting")
    ) {
      return;
    }
    const id = window.setInterval(() => {
      void jackApi
        .epClientPollStatus()
        .then((st) => {
          setEpClientStatus(st);
          if (st.stage === "VerifySas" && epScreen === "ENTER_CODE") {
            setEpScreen("VERIFY_SAS");
          } else if (st.stage === "Connected") {
            setEpLiveStatus(st.status_read ?? null);
            setEpScreen("CONNECTED");
          } else if (st.stage === "Error" && st.error) {
            setErrorMsg(formatEpUserError(st.error));
          }
        })
        .catch((err) =>
          setErrorMsg(formatEpUserError(err instanceof Error ? err.message : String(err))),
        );
    }, 300);
    return () => window.clearInterval(id);
  }, [appState, epScreen, epClientStatus?.stage]);

  // Bounded session-state reconciliation while Connected so host revocation/stop fails closed.
  useEffect(() => {
    if (
      appState !== "EASY_PAIRING" ||
      epScreen !== "CONNECTED" ||
      epClientStatus?.stage !== "Connected"
    ) {
      return;
    }
    if (new URLSearchParams(window.location.search).has("ep")) return; // static preview
    let cancelled = false;
    let inFlight = false;
    const id = window.setInterval(() => {
      if (cancelled || inFlight) return;
      inFlight = true;
      void jackApi
        .epClientReadStatus()
        .then((res) => {
          if (cancelled) return;
          setEpLiveStatus(res);
        })
        .catch((err) => {
          if (cancelled) return;
          const raw = err instanceof Error ? err.message : String(err);
          void jackApi.epClientDisconnect().catch(() => {});
          setEpLiveStatus(null);
          setEpClientStatus({ stage: "Error", error: raw });
          setErrorMsg(formatEpUserError(raw));
          setEpScreen("ENTER_CODE");
        })
        .finally(() => {
          inFlight = false;
        });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [appState, epScreen, epClientStatus?.stage]);

  const handleEpStartShare = async (bindIpOverride?: string) => {
    setEpBusy(true);
    setEpHostAuthorizing(false);
    setActionMsg(null);
    setErrorMsg(null);
    const chosenIp = bindIpOverride ?? epSelectedBindIp;
    try {
      const opts = await jackApi.epHostListBindOptions().catch(() => ["127.0.0.1"]);
      setEpBindOptions(opts);
      const st = await jackApi.epHostStartSharing(chosenIp);
      setHostShare(st);
      setEpScreen("SHARE");
    } catch (err) {
      setErrorMsg(formatEpUserError(err instanceof Error ? err.message : String(err)));
    } finally {
      setEpBusy(false);
    }
  };

  const handleEpCancelShare = async () => {
    await jackApi.epHostStopSharing().catch(() => {});
    setEpHostAuthorizing(false);
    setHostShare(null);
    setErrorMsg(null);
    setEpScreen("HOME");
  };

  const handleEpDecideApproval = async (requestId: string, approved: boolean) => {
    setEpBusy(true);
    setEpHostAuthorizing(approved);
    setActionMsg(null);
    setErrorMsg(null);
    try {
      const st = await jackApi.epHostDecideApproval(requestId, approved);
      setHostShare(st);
      if (!approved) {
        setEpHostAuthorizing(false);
        setActionMsg(EN.ep.deniedMsg);
      } else if (st.paired_peer_id || st.error) {
        setEpHostAuthorizing(false);
      }
    } catch (err) {
      setEpHostAuthorizing(false);
      setErrorMsg(formatEpUserError(err instanceof Error ? err.message : String(err)));
    } finally {
      setEpBusy(false);
    }
  };

  const handleEpRevokePeer = async (peerId: string) => {
    setEpBusy(true);
    setErrorMsg(null);
    try {
      await jackApi.epHostRevokePeer(peerId);
      await jackApi.epHostStopSharing();
      setHostShare(null);
      setActionMsg("Access revoked.");
      setEpScreen("HOME");
    } catch (err) {
      setErrorMsg(formatEpUserError(err instanceof Error ? err.message : String(err)));
    } finally {
      setEpBusy(false);
    }
  };

  const handleEpClientConnect = async () => {
    const codeErr = validateAuthCode(epCodeInput);
    const epErr = validateEndpoint(epEndpointInput);
    setEpCodeError(codeErr);
    setEpEndpointError(epErr);
    if (codeErr || epErr) {
      return;
    }
    setEpBusy(true);
    setErrorMsg(null);
    try {
      const st = await jackApi.epClientStartPairing(
        epEndpointInput.trim(),
        epCodeInput.trim(),
        "jack-desktop-client",
      );
      setEpClientStatus(st);
      if (st.stage === "Error") {
        setErrorMsg(formatEpUserError(st.error ?? "Pairing failed."));
      } else if (st.stage === "VerifySas") {
        setEpScreen("VERIFY_SAS");
      } else if (st.stage === "Connected") {
        setEpLiveStatus(st.status_read ?? null);
        setEpScreen("CONNECTED");
      }
    } catch (err) {
      setErrorMsg(formatEpUserError(err instanceof Error ? err.message : String(err)));
    } finally {
      setEpBusy(false);
    }
  };

  const handleEpConfirmSas = async (confirmed: boolean) => {
    setEpBusy(true);
    setErrorMsg(null);
    try {
      if (!confirmed) {
        await jackApi.epClientConfirmSas(false).catch(() => {});
        await jackApi.epClientDisconnect().catch(() => {});
        setEpClientStatus(null);
        setErrorMsg("Verification codes did not match. Pairing cancelled.");
        setEpScreen("ENTER_CODE");
        return;
      }
      const st = await jackApi.epClientConfirmSas(true);
      setEpClientStatus(st);
      if (st.stage === "Connected") {
        setEpLiveStatus(st.status_read ?? null);
        setEpScreen("CONNECTED");
      } else if (st.stage === "Error") {
        setErrorMsg(formatEpUserError(st.error ?? "Pairing failed."));
      }
    } catch (err) {
      setErrorMsg(formatEpUserError(err instanceof Error ? err.message : String(err)));
    } finally {
      setEpBusy(false);
    }
  };

  const handleEpRefreshStatus = async () => {
    setEpBusy(true);
    setErrorMsg(null);
    try {
      const res = await jackApi.epClientReadStatus();
      setEpLiveStatus(res);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setErrorMsg(formatEpUserError(raw));
      setEpClientStatus({ stage: "Error", error: raw });
      setEpScreen("ENTER_CODE");
    } finally {
      setEpBusy(false);
    }
  };

  const handleEpDisconnect = async () => {
    await jackApi.epClientDisconnect().catch(() => {});
    setEpClientStatus(null);
    setEpLiveStatus(null);
    setErrorMsg(null);
    setEpScreen("HOME");
  };

  // 0. EASY PAIRING (EP-004 Auth Code-First Experience)
  if (appState === "EASY_PAIRING" && epScreen === "HOME") {
    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} showBrandText={false} />
        <main className="welcome-screen">
          <div className="welcome-logo">
            <JackMark size={84} />
          </div>
          <p className="welcome-subtitle">{EN.ep.subtitle}</p>
          {actionMsg ? (
            <div className="banner-success" style={{ maxWidth: 460 }}>
              {actionMsg}
            </div>
          ) : null}
          {errorMsg ? (
            <div className="banner-error" style={{ maxWidth: 460 }}>
              {errorMsg}
            </div>
          ) : null}
          <div className="welcome-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setErrorMsg(null);
                setActionMsg(null);
                setEpCodeInput("");
                setEpCodeError(null);
                setEpEndpointError(null);
                setEpScreen("ENTER_CODE");
              }}
            >
              {EN.ep.addDevice}
            </button>
            <button
              type="button"
              className="btn btn-outline-dark"
              onClick={() => void handleEpStartShare()}
              disabled={epBusy}
            >
              {EN.ep.shareDevice}
            </button>
            <button
              type="button"
              className="btn btn-outline-dark"
              style={{ fontSize: 13, padding: "8px 14px", opacity: 0.85 }}
              onClick={startFirstRunSetup}
            >
              {EN.ep.manualSshLink}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (appState === "EASY_PAIRING") {
    const epStep =
      epScreen === "SHARE"
        ? hostShare?.pending_request || epHostAuthorizing
          ? 2
          : hostShare?.paired_peer_id
            ? 3
            : 1
        : epScreen === "ENTER_CODE"
          ? 1
          : epScreen === "VERIFY_SAS"
            ? 2
            : 3;

    const remainingSecs =
      hostShare?.expires_at && epTick >= 0
        ? Math.max(0, hostShare.expires_at - Math.floor(Date.now() / 1000))
        : 0;
    const mins = Math.floor(remainingSecs / 60);
    const secs = String(remainingSecs % 60).padStart(2, "0");

    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} showBrandText={false} />
        <div className="split-layout">
          <EpWizardSidebar activeStep={epStep} mode={epScreen === "SHARE" ? "host" : "client"} />
          <main className="main-pane" style={{ display: "flex", flexDirection: "column" }}>
            {errorMsg ? <div className="banner-error">{errorMsg}</div> : null}
            {actionMsg ? <div className="banner-success">{actionMsg}</div> : null}

            {epScreen === "SHARE" && (
              hostShare?.pending_request ? (
                <>
                  <h2 className="pane-title">{EN.ep.approveTitle}</h2>
                  <p className="pane-subtitle">{EN.ep.approveSubtitle}</p>

                  <div className="card-box" style={{ marginBottom: 14 }}>
                    <div className="review-row">
                      <span>{EN.ep.requestingDevice}</span>
                      <strong>{hostShare.pending_request.peer_name}</strong>
                    </div>
                    <div className="review-row">
                      <span>{EN.ep.sasLabel}</span>
                      <strong style={{ fontSize: 22, letterSpacing: 2, color: "var(--brand-primary)" }}>
                        {hostShare.pending_request.sas_6digit}
                      </strong>
                    </div>
                    <div className="review-row">
                      <span>{EN.ep.requestedScope}</span>
                      <strong>{EN.ep.scopeStatusRead}</strong>
                    </div>
                    <div className="review-row">
                      <span>{EN.ep.durationLabel}</span>
                      <strong>{EN.ep.durationSession}</strong>
                    </div>
                  </div>

                  <div className="footer-actions" style={{ marginTop: "auto" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        void handleEpDecideApproval(hostShare.pending_request!.request_id, false)
                      }
                      disabled={epBusy}
                    >
                      {EN.ep.denyCta}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        void handleEpDecideApproval(hostShare.pending_request!.request_id, true)
                      }
                      disabled={epBusy}
                    >
                      {EN.ep.approveCta}
                    </button>
                  </div>
                </>
              ) : hostShare?.paired_peer_id ? (
                <>
                  <h2 className="pane-title">{EN.ep.peerAuthorizedTitle}</h2>
                  <p className="pane-subtitle">{EN.ep.peerAuthorizedSubtitle}</p>
                  <div
                    role="status"
                    className="card-box"
                    style={{
                      padding: 20,
                      background: "#ecfdf5",
                      border: "1px solid #86efac",
                      color: "#166534",
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, textAlign: "center" }}>
                      {EN.ep.peerAuthorizedTitle}
                    </div>
                    <div className="review-row">
                      <span>{EN.ep.requestingDevice}</span>
                      <strong>{hostShare.paired_peer_name || "Paired Device"}</strong>
                    </div>
                    <div className="review-row">
                      <span>Status</span>
                      <strong>{EN.ep.peerAuthorizedStatus}</strong>
                    </div>
                    <div className="review-row">
                      <span>{EN.ep.requestedScope}</span>
                      <strong>{EN.ep.scopeStatusRead}</strong>
                    </div>
                    <div className="review-row">
                      <span>{EN.ep.durationLabel}</span>
                      <strong>{EN.ep.durationSession}</strong>
                    </div>
                  </div>
                  <div className="footer-actions" style={{ marginTop: "auto" }}>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        background: "#dc2626",
                        color: "#ffffff",
                        border: "1px solid #b91c1c",
                      }}
                      onClick={() => void handleEpRevokePeer(hostShare.paired_peer_id!)}
                      disabled={epBusy}
                    >
                      {EN.ep.revokeCta}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleEpCancelShare()}
                    >
                      {EN.ep.stopSharing}
                    </button>
                  </div>
                </>
              ) : epHostAuthorizing ? (
                <>
                  <h2 className="pane-title">{EN.ep.authorizingTitle}</h2>
                  <p className="pane-subtitle">{EN.ep.authorizingSubtitle}</p>
                  <div className="footer-actions" style={{ marginTop: "auto" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleEpCancelShare()}
                    >
                      {EN.ep.cancel}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="pane-title">{EN.ep.shareTitle}</h2>
                  <p className="pane-subtitle">{EN.ep.shareSubtitle}</p>

                  <div className="card-box" style={{ textAlign: "center", padding: 24 }}>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                      {EN.ep.authCodeLabel}
                    </div>
                    <div
                      style={{
                        fontSize: 36,
                        fontWeight: 800,
                        letterSpacing: 4,
                        color: "var(--brand-primary)",
                        marginBottom: 14,
                      }}
                    >
                      {hostShare?.auth_code ?? "---- ----"}
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        fontVariantNumeric: "tabular-nums",
                        marginBottom: 10,
                      }}
                    >
                      {EN.ep.expiresIn} {mins}:{secs}
                    </div>
                    {hostShare?.endpoint ? (
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {EN.ep.endpointLabel}:{" "}
                        <span
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            fontWeight: 700,
                          }}
                        >
                          {hostShare.endpoint}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {epBindOptions.length > 1 ? (
                    <div className="field-group" style={{ marginTop: 12 }}>
                      <label className="field-label" htmlFor="ep-bind-select">
                        {EN.ep.bindSelectLabel}
                      </label>
                      <select
                        id="ep-bind-select"
                        className="text-input"
                        value={epSelectedBindIp}
                        disabled={epBusy}
                        onChange={(e) => {
                          const nextIp = e.target.value;
                          setEpSelectedBindIp(nextIp);
                          void handleEpStartShare(nextIp);
                        }}
                      >
                        {epBindOptions.map((ip) => (
                          <option key={ip} value={ip}>
                            {ip === "127.0.0.1" ? EN.ep.bindLoopbackLabel : `Local Network (${ip})`}
                          </option>
                        ))}
                      </select>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                        {EN.ep.bindLanHint}
                      </p>
                    </div>
                  ) : null}

                  <div className="footer-actions" style={{ marginTop: "auto" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleEpCancelShare()}
                    >
                      {EN.ep.cancel}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleEpStartShare()}
                      disabled={epBusy}
                    >
                      {EN.ep.regenerate}
                    </button>
                  </div>
                </>
              )
            )}

            {epScreen === "ENTER_CODE" && (
              <>
                <h2 className="pane-title">{EN.ep.enterCodeTitle}</h2>
                <p className="pane-subtitle">{EN.ep.enterCodeSubtitle}</p>

                <div className="field-group">
                  <label className="field-label" htmlFor="ep-auth-code">
                    {EN.ep.authCodeLabel}
                  </label>
                  <input
                    id="ep-auth-code"
                    className="text-input"
                    value={epCodeInput}
                    onChange={(e) => {
                      const norm = normalizeAuthCode(e.target.value);
                      setEpCodeInput(norm);
                      if (epCodeError) setEpCodeError(validateAuthCode(norm));
                    }}
                    placeholder={EN.ep.codePlaceholder}
                  />
                  {epCodeError ? (
                    <p style={{ fontSize: 12, color: "#dc2626", margin: "6px 0 0", fontWeight: 600 }}>
                      {epCodeError}
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                      {EN.ep.codeHint}
                    </p>
                  )}
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor="ep-endpoint">
                    {EN.ep.hostAddrLabel}
                  </label>
                  <input
                    id="ep-endpoint"
                    className="text-input"
                    value={epEndpointInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEpEndpointInput(val);
                      if (epEndpointError) setEpEndpointError(validateEndpoint(val));
                    }}
                    placeholder="127.0.0.1:45123"
                  />
                  {epEndpointError ? (
                    <p style={{ fontSize: 12, color: "#dc2626", margin: "6px 0 0", fontWeight: 600 }}>
                      {epEndpointError}
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                      {EN.ep.hostAddrHint}
                    </p>
                  )}
                </div>

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      setEpScreen("HOME");
                    }}
                  >
                    {EN.ep.back}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleEpClientConnect()}
                    disabled={epBusy || !epCodeInput.trim() || !epEndpointInput.trim()}
                  >
                    {EN.ep.connectCta}
                  </button>
                </div>
              </>
            )}

            {epScreen === "VERIFY_SAS" && (
              <>
                <h2 className="pane-title">{EN.ep.verifySasTitle}</h2>
                <p className="pane-subtitle">{EN.ep.verifySasSubtitle}</p>

                <div className="card-box" style={{ textAlign: "center", padding: 24 }}>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                    {EN.ep.sasLabel}
                  </div>
                  <div
                    style={{
                      fontSize: 36,
                      fontWeight: 800,
                      letterSpacing: 4,
                      color: "var(--brand-primary)",
                    }}
                  >
                    {epClientStatus?.sas_6digit ?? "--- ---"}
                  </div>
                  {epClientStatus?.stage === "WaitingApproval" ? (
                    <p className="pane-subtitle" style={{ marginTop: 12, marginBottom: 0 }}>
                      {EN.ep.waitingApproval}
                    </p>
                  ) : null}
                </div>

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  {epClientStatus?.stage === "Error" ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        void jackApi.epClientDisconnect().catch(() => {});
                        setEpClientStatus(null);
                        setErrorMsg(null);
                        setEpScreen("ENTER_CODE");
                      }}
                      disabled={epBusy}
                    >
                      {EN.ep.retry}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleEpConfirmSas(false)}
                        disabled={epBusy || epClientStatus?.stage === "WaitingApproval"}
                      >
                        {EN.ep.mismatchSasCta}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handleEpConfirmSas(true)}
                        disabled={epBusy || epClientStatus?.stage === "WaitingApproval"}
                      >
                        {EN.ep.confirmSasCta}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {epScreen === "CONNECTED" && epClientStatus?.stage === "Connected" && (
              <>
                <h2 className="pane-title">{EN.ep.connectedTitle}</h2>
                <p className="pane-subtitle">{EN.ep.connectedSubtitle}</p>

                <div className="card-box">
                  <div className="review-row">
                    <span>Host</span>
                    <strong>Authorized Host</strong>
                  </div>
                  <div className="review-row">
                    <span>Status (status.read)</span>
                    <StatusBadge kind="ready" label={epLiveStatus?.status ?? "ok"} />
                  </div>
                  {epLiveStatus ? (
                    <>
                      <div className="review-row">
                        <span>OS</span>
                        <strong>{epLiveStatus.os}</strong>
                      </div>
                      <div className="review-row">
                        <span>Uptime</span>
                        <strong>{epLiveStatus.uptime_seconds}s</strong>
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleEpDisconnect()}
                  >
                    {EN.ep.disconnect}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleEpRefreshStatus()}
                    disabled={epBusy}
                  >
                    {EN.ep.refreshStatus}
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    );
  }

  // 1. ONBOARDING: Welcome
  if (appState === "ONBOARDING" && stage === "WELCOME") {
    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} showBrandText={false} />
        <main className="welcome-screen">
          <div className="welcome-logo">
            <JackMark size={84} />
          </div>
          <p className="welcome-subtitle">{EN.welcome.subtitle}</p>
          {actionMsg ? (
            <div className="banner-success" style={{ maxWidth: 460 }}>
              {actionMsg}
            </div>
          ) : null}
          {errorMsg ? (
            <div className="banner-error" style={{ maxWidth: 460 }}>
              {errorMsg}
            </div>
          ) : null}
          <div className="welcome-actions">
            <button type="button" className="btn btn-primary" onClick={startFirstRunSetup}>
              {EN.welcome.configureCta}
            </button>
            <button
              type="button"
              className="btn btn-outline-dark"
              onClick={() => {
                setDiagnosticsOrigin("WELCOME");
                setAppState("DIAGNOSTICS");
                void loadDiagnostics();
              }}
            >
              {EN.welcome.diagnosticsCta}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // 2. ONBOARDING: 4-Stage Adaptive Flow (S1 -> S2 -> S3 -> S4)
  if (appState === "ONBOARDING") {
    const showManualFields =
      manualMode || (!discoveryLoading && (discovery?.peers.length ?? 0) === 0);
    const isVerified = sshAuthResult?.status === "VERIFIED";
    const isDryRunNotTested = sshAuthResult?.status === "NOT_TESTED";

    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} showBrandText={false} />
        <div className="split-layout">
          <WizardSidebar activeStep={STAGE_NUM[stage]} />
          <main className="main-pane" style={{ display: "flex", flexDirection: "column" }}>
            {errorMsg ? <div className="banner-error">{errorMsg}</div> : null}

            {stage === "S1" && (
              <>
                <h2 className="pane-title">{EN.stage1.title}</h2>
                <p className="pane-subtitle">{EN.stage1.subtitle}</p>

                {tailscaleLoading || !tailscaleState ? (
                  <p className="pane-subtitle">{EN.stage1.checking}</p>
                ) : (
                  <>
                    <div className="card-box" style={{ marginBottom: 14 }}>
                      <div className="review-row">
                        <span>{EN.stage1.installedLabel}</span>
                        <StatusBadge
                          kind={tailscaleState.cli_installed ? "ready" : "error"}
                          label={
                            tailscaleState.cli_installed
                              ? EN.stage1.installed
                              : EN.stage1.notInstalled
                          }
                        />
                      </div>
                      <div className="review-row">
                        <span>{EN.stage1.serviceLabel}</span>
                        <StatusBadge
                          kind={
                            tailscaleState.status_category === "UNKNOWN"
                              ? "configured"
                              : tailscaleState.service_running
                                ? "ready"
                                : "warn"
                          }
                          label={
                            tailscaleState.status_category === "UNKNOWN"
                              ? EN.stage1.unknown
                              : tailscaleState.service_running
                                ? EN.stage1.running
                                : EN.stage1.stopped
                          }
                        />
                      </div>
                      <div className="review-row">
                        <span>{EN.stage1.signInLabel}</span>
                        <StatusBadge
                          kind={
                            tailscaleState.status_category === "UNKNOWN" || !tailscaleState.cli_installed
                              ? "configured"
                              : tailscaleState.signed_in
                                ? "ready"
                                : "warn"
                          }
                          label={
                            tailscaleState.status_category === "UNKNOWN" || !tailscaleState.cli_installed
                              ? EN.stage1.unknown
                              : tailscaleState.signed_in
                                ? EN.stage1.signedIn
                                : EN.stage1.signedOut
                          }
                        />
                      </div>
                      <div className="review-row">
                        <span>{EN.stage1.connectionLabel}</span>
                        <StatusBadge
                          kind={
                            tailscaleState.connected
                              ? "ready"
                              : tailscaleState.status_category === "UNKNOWN"
                                ? "configured"
                                : "warn"
                          }
                          label={
                            tailscaleState.connected
                              ? EN.stage1.connected
                              : tailscaleState.status_category === "UNKNOWN"
                                ? EN.stage1.unknown
                                : EN.stage1.disconnected
                          }
                        />
                      </div>
                    </div>

                    {tailscaleState.status_category === "CONNECTED" ? (
                      <div className="banner-success">{EN.stage1.healthyNote}</div>
                    ) : tailscaleState.status_category === "NOT_INSTALLED" ? (
                      <div className="banner-warn">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {EN.stage1.notInstalledTitle}
                        </div>
                        <div style={{ marginBottom: 8 }}>{EN.stage1.notInstalledBody}</div>
                        <a
                          href={tailscaleState.install_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--brand-primary)", fontWeight: 600 }}
                        >
                          {EN.stage1.installLinkLabel}
                        </a>
                      </div>
                    ) : tailscaleState.status_category === "SIGNED_OUT" ? (
                      <div className="banner-warn">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {EN.stage1.signedOutTitle}
                        </div>
                        <div>{EN.stage1.signedOutBody}</div>
                      </div>
                    ) : tailscaleState.status_category === "SERVICE_STOPPED" ? (
                      <div className="banner-warn">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {EN.stage1.serviceStoppedTitle}
                        </div>
                        <div>{EN.stage1.serviceStoppedBodyArchUbuntu}</div>
                      </div>
                    ) : (
                      <div className="banner-warn">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {EN.stage1.disconnectedTitle}
                        </div>
                        <div>{tailscaleState.message}</div>
                      </div>
                    )}
                  </>
                )}

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      clearAutoAdvance();
                      stageSeqRef.current += 1;
                      setErrorMsg(null);
                      if (wizardOrigin === "DASHBOARD") {
                        setAppState("DASHBOARD");
                      } else {
                        setStage("WELCOME");
                      }
                    }}
                  >
                    {wizardOrigin === "DASHBOARD" ? EN.stage2.cancel : EN.stage1.back}
                  </button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setManualMode(true);
                        setDiscovery({
                          available: false,
                          backend_state: tailscaleState?.backend_state ?? "Manual",
                          peers: [],
                          message: "Manual SSH target",
                        });
                        setStage("S2");
                      }}
                    >
                      {EN.stage1.manualSshCta}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void checkTailscaleAndMaybeAdvance(true)}
                      disabled={tailscaleLoading}
                    >
                      {EN.stage1.retryCheck}
                    </button>
                  </div>
                </div>
              </>
            )}

            {stage === "S2" && (
              <>
                <h2 className="pane-title">
                  {manualMode ? EN.stage2.manualTitle : EN.stage2.title}
                </h2>
                <p className="pane-subtitle">
                  {manualMode ? EN.stage2.manualSubtitle : EN.stage2.subtitle}
                </p>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginBottom: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  {!manualMode ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void loadDiscovery()}
                      disabled={discoveryLoading}
                    >
                      {EN.stage2.refresh}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setManualMode((v) => !v);
                      setErrorMsg(null);
                    }}
                  >
                    {manualMode ? EN.stage2.usePeersToggle : EN.stage2.manualToggle}
                  </button>
                  {!manualMode && (discovery?.peers.length ?? 0) > 0 ? (
                    <input
                      aria-label="Filter devices"
                      className="text-input"
                      style={{ flex: 1, minWidth: 180 }}
                      value={peerFilter}
                      onChange={(e) => setPeerFilter(e.target.value)}
                      placeholder={EN.stage2.filterPlaceholder}
                    />
                  ) : null}
                </div>

                {!manualMode && (
                  discoveryLoading ? (
                    <p className="pane-subtitle">{EN.stage2.loading}</p>
                  ) : filteredPeers.length > 0 ? (
                    <div
                      className="peer-list"
                      role="list"
                      aria-label="Discovered Tailscale devices"
                    >
                      {filteredPeers.map((peer) => (
                        <div key={peer.id} role="listitem">
                          <button
                            type="button"
                            className="peer-row"
                            style={{ width: "100%" }}
                            onClick={() => handleSelectPeerAndAdvance(peer)}
                          >
                            <div className="peer-left">
                              <OsIcon os={peer.os} />
                              <div>
                                <div style={{ fontWeight: 600 }}>{peer.name}</div>
                                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                  {peer.os || "Unknown OS"} · {peer.address}
                                </div>
                              </div>
                            </div>
                            <StatusBadge
                              kind={peer.online ? "ready" : "warn"}
                              label={peer.online ? EN.stage2.networkOnline : EN.stage2.networkOffline}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pane-subtitle">{EN.stage2.empty}</p>
                  )
                )}

                {showManualFields && (
                  <div style={{ marginTop: 6 }}>
                    <div className="field-group">
                      <label className="field-label" htmlFor="target-host-input">
                        {EN.stage2.hostLabel}
                      </label>
                      <input
                        id="target-host-input"
                        className="text-input"
                        value={targetHost}
                        onChange={(e) => {
                          setSelectedPeer(null);
                          setTargetHost(e.target.value);
                        }}
                        placeholder={EN.stage2.hostPlaceholder}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label" htmlFor="target-alias-input">
                        {EN.stage2.aliasLabel}
                      </label>
                      <input
                        id="target-alias-input"
                        className="text-input"
                        value={targetAlias}
                        onChange={(e) => setTargetAlias(e.target.value)}
                        placeholder={EN.stage2.aliasPlaceholder}
                      />
                    </div>
                  </div>
                )}

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      if (wizardOrigin === "DASHBOARD" && manualMode) {
                        setAppState("DASHBOARD");
                      } else {
                        setStage("S1");
                        void checkTailscaleAndMaybeAdvance(false);
                      }
                    }}
                  >
                    {wizardOrigin === "DASHBOARD" ? EN.stage2.cancel : EN.stage2.back}
                  </button>
                  {showManualFields ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleManualContinue}
                      disabled={!isManualValid}
                    >
                      {EN.stage2.continueManual}
                    </button>
                  ) : null}
                </div>
              </>
            )}

            {stage === "S3" && (
              <>
                <h2 className="pane-title">
                  {EN.stage3.title}: {selectedPeer?.name || targetHost.trim()}
                </h2>
                <p className="pane-subtitle">{EN.stage3.subtitle}</p>

                {selectedPeer && !selectedPeer.online ? (
                  <div className="banner-warn">{EN.stage2.offlineNote}</div>
                ) : null}
                {selectedPeer?.is_windows ? (
                  <div className="banner-warn">{EN.stage2.windowsNote}</div>
                ) : null}

                {/* Granular Preflight + Network + SSH Auth Status */}
                <div
                  className="card-box"
                  style={{ marginBottom: 10, padding: "12px 16px" }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{EN.stage3.preflightTitle}</div>
                  {checksLoading || !preflight ? (
                    <div className="review-row">
                      <span>{EN.stage3.preflightTitle}</span>
                      <StatusBadge kind="configured" label={EN.stage3.checking} />
                    </div>
                  ) : (
                    preflight.checks.map((item) => {
                      const kind: BadgeKind =
                        item.status === "PASS"
                          ? "ready"
                          : item.status === "FAIL"
                            ? "error"
                            : item.status === "WARNING"
                              ? "warn"
                              : "configured";
                      return (
                        <div key={item.name} className="review-row">
                          <div>
                            <div style={{ fontWeight: 600 }}>{item.name}</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                              {item.detail}
                            </div>
                            {item.remediation && item.status !== "PASS" ? (
                              <div
                                style={{
                                  fontSize: 12,
                                  color:
                                    item.status === "FAIL"
                                      ? "var(--status-error)"
                                      : "var(--text-secondary)",
                                  marginTop: 2,
                                }}
                              >
                                {item.remediation}
                              </div>
                            ) : null}
                          </div>
                          <StatusBadge kind={kind} label={item.status} />
                        </div>
                      );
                    })
                  )}

                  <div className="review-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>{EN.stage3.networkTitle}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {networkResult ? networkResult.detail : EN.stage3.checking}
                      </div>
                    </div>
                    {checksLoading || !networkResult ? (
                      <StatusBadge kind="configured" label={EN.stage3.checking} />
                    ) : (
                      <StatusBadge
                        kind={
                          networkResult.status === "REACHABLE"
                            ? "ready"
                            : networkResult.status === "UNREACHABLE"
                              ? "warn"
                              : "configured"
                        }
                        label={networkResult.status}
                      />
                    )}
                  </div>

                  <div className="review-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>{EN.stage3.sshTitle}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {sshAuthResult ? sshAuthResult.detail : EN.stage3.notTested}
                      </div>
                      {sshAuthResult?.status === "FAILED" && sshAuthResult.recovery_hint ? (
                        <div style={{ fontSize: 12, color: "var(--status-error)", marginTop: 2 }}>
                          {sshAuthResult.recovery_hint}
                        </div>
                      ) : null}
                    </div>
                    <StatusBadge
                      kind={
                        sshAuthResult?.status === "VERIFIED"
                          ? "ready"
                          : sshAuthResult?.status === "FAILED"
                            ? "error"
                            : "warn"
                      }
                      label={
                        sshAuthResult?.status === "VERIFIED"
                          ? EN.stage3.verified
                          : sshAuthResult?.status === "FAILED"
                            ? EN.stage3.failed
                            : EN.stage3.notTested
                      }
                    />
                  </div>
                </div>

                {isDryRunNotTested ? (
                  <div className="banner-warn">{EN.stage3.dryRunNotice}</div>
                ) : null}

                <div className="field-group">
                  <label className="field-label" htmlFor="ssh-user-input">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <UserIcon />
                      {EN.stage3.usernameLabel}
                    </span>
                  </label>
                  <input
                    id="ssh-user-input"
                    className="text-input"
                    value={sshUser}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder={EN.stage3.usernamePlaceholder}
                  />
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                    {EN.stage3.usernameHint}
                  </p>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    marginBottom: 10,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sshConsent}
                    onChange={(e) => setSshConsent(e.target.checked)}
                    disabled={!isUsernameValid || busyAction !== null}
                  />
                  <span>
                    {EN.stage3.consentPrefix}{" "}
                    <strong>
                      {sshUser.trim() || "<user>"}@{targetHost.trim()}
                    </strong>{" "}
                    {EN.stage3.consentSuffix}
                  </span>
                </label>

                <details style={{ fontSize: 13, marginBottom: 10 }}>
                  <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>
                    {EN.stage3.advancedSummary}
                  </summary>
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{EN.stage3.advancedNote}</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        void handleSaveAndContinue(isDryRunNotTested ? "simulation" : "unverified")
                      }
                      disabled={!isUsernameValid || !preflight?.can_save || busyAction !== null}
                    >
                      {busyAction === "save" ? EN.stage3.saving : EN.stage3.saveUnverified}
                    </button>
                  </div>
                </details>

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      setStage("S2");
                    }}
                    disabled={busyAction !== null}
                  >
                    {EN.stage3.back}
                  </button>

                  {isVerified ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleSaveAndContinue("verified")}
                      disabled={!isUsernameValid || !preflight?.can_save || busyAction !== null}
                    >
                      {busyAction === "save" ? EN.stage3.saving : EN.stage3.saveAndContinue}
                    </button>
                  ) : isDryRunNotTested ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleSaveAndContinue("simulation")}
                      disabled={!isUsernameValid || !preflight?.can_save || busyAction !== null}
                    >
                      {busyAction === "save" ? EN.stage3.saving : EN.stage3.saveAndContinue}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleVerifyConnection()}
                      disabled={
                        !isUsernameValid ||
                        !sshConsent ||
                        !preflight?.can_save ||
                        checksLoading ||
                        busyAction !== null
                      }
                    >
                      {busyAction === "verify"
                        ? EN.stage3.verifying
                        : sshAuthResult?.status === "FAILED"
                          ? EN.stage3.retryVerify
                          : EN.stage3.verifyConnection}
                    </button>
                  )}
                </div>
              </>
            )}

            {stage === "S4" && (
              <>
                <h2 className="pane-title">
                  {completionKind === "CONNECTED"
                    ? EN.stage4.titleConnected
                    : completionKind === "SIMULATION"
                      ? EN.stage4.titleSimulation
                      : completionKind === "FAILED"
                        ? EN.stage4.titleFailed
                        : EN.stage4.titleNeedsSetup}
                </h2>
                <p className="pane-subtitle">
                  {completionKind === "CONNECTED"
                    ? EN.stage4.subtitleConnected
                    : completionKind === "SIMULATION"
                      ? EN.stage4.subtitleSimulation
                      : completionKind === "FAILED"
                        ? EN.stage4.subtitleFailed
                        : EN.stage4.subtitleNeedsSetup}
                </p>

                <div
                  className={
                    completionKind === "CONNECTED"
                      ? "banner-success"
                      : completionKind === "FAILED"
                        ? "banner-error"
                        : "banner-warn"
                  }
                >
                  {effectiveAlias} ({sshUser.trim()}@{targetHost.trim()}) —{" "}
                  {completionKind === "CONNECTED"
                    ? EN.stage4.titleConnected
                    : completionKind === "SIMULATION"
                      ? EN.stage4.titleSimulation
                      : completionKind === "FAILED"
                        ? EN.stage4.titleFailed
                        : EN.stage4.titleNeedsSetup}
                </div>

                {connectResult ? <div className="banner-warn">{connectResult.message}</div> : null}

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    {completionKind !== "CONNECTED" ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setConnectResult(null);
                          setStage("S3");
                        }}
                      >
                        {EN.stage4.retryVerify}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setConnectResult(null);
                        setAppState("DASHBOARD");
                      }}
                    >
                      {EN.stage4.goDashboard}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleConnect(effectiveAlias)}
                  >
                    {EN.stage4.connectNow}
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    );
  }

  // 3. MAIN APP SHELL (DASHBOARD [FROZEN] | DIAGNOSTICS | SETTINGS)
  return (
    <div className="app-shell">
      <TitleBar subtitle={cliVersion || undefined} />
      <div className="split-layout">
        <aside className="sidebar" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-btn ${appState === "DASHBOARD" ? "active" : ""}`}
            onClick={() => {
              setErrorMsg(null);
              setAppState("DASHBOARD");
            }}
          >
            {EN.nav.devices}
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={startAddDeviceFromDashboard}
          >
            + {EN.nav.addDevice}
          </button>
          <button
            type="button"
            className={`nav-btn ${appState === "DIAGNOSTICS" ? "active" : ""}`}
            onClick={() => {
              setErrorMsg(null);
              setDiagnosticsOrigin("DASHBOARD");
              setAppState("DIAGNOSTICS");
              void loadDiagnostics();
            }}
          >
            {EN.nav.diagnostics}
          </button>
          <button
            type="button"
            className={`nav-btn ${appState === "SETTINGS" ? "active" : ""}`}
            onClick={() => {
              setErrorMsg(null);
              setShowResetConfirm(false);
              setAppState("SETTINGS");
              void loadSettingsData();
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <GearIcon />
              {EN.nav.settings}
            </span>
          </button>
        </aside>

        <main className="main-pane">
          {errorMsg ? <div className="banner-error">{errorMsg}</div> : null}
          {actionMsg ? <div className="banner-success">{actionMsg}</div> : null}

          {appState === "DASHBOARD" && (
            <>
              <h2 className="pane-title">{EN.dashboard.title}</h2>
              <p className="pane-subtitle">{EN.dashboard.subtitle}</p>
              {devices.length === 0 ? (
                <div className="card-box">
                  <h3 style={{ marginTop: 0 }}>{EN.dashboard.emptyTitle}</h3>
                  <p className="pane-subtitle">{EN.dashboard.emptyBody}</p>
                  <button type="button" className="btn-primary" onClick={startFirstRunSetup}>
                    {EN.dashboard.emptyCta}
                  </button>
                </div>
              ) : (
                devices.map((dev) => {
                  const badge = mapDeviceStatusBadge(dev, deviceStatuses[dev.alias]);
                  return (
                    <div key={dev.alias} className="device-card">
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <OsIcon role={dev.alias} />
                        <div>
                          <div style={{ fontWeight: 700 }}>{dev.alias}</div>
                          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                            {dev.user || "?"}@{dev.host || "?"}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <StatusBadge kind={badge.kind} label={badge.label} />
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void handleCheckStatus(dev.alias)}
                          disabled={checkingAlias === dev.alias}
                        >
                          {checkingAlias === dev.alias
                            ? EN.dashboard.checkingStatus
                            : EN.dashboard.checkStatus}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void handleSetDefault(dev.alias)}
                        >
                          {EN.dashboard.setDefault}
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void handleConnect(dev.alias)}
                        >
                          {EN.dashboard.connect}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {appState === "DIAGNOSTICS" && (
            <>
              <h2 className="pane-title">{EN.diagnostics.title}</h2>
              <p className="pane-subtitle">{EN.diagnostics.subtitle}</p>
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void loadDiagnostics()}
                  disabled={diagLoading}
                >
                  {EN.diagnostics.refresh}
                </button>
                {diagnosticsOrigin === "WELCOME" && devices.length === 0 ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setStage("WELCOME");
                      setAppState("ONBOARDING");
                    }}
                  >
                    {EN.diagnostics.back}
                  </button>
                ) : null}
              </div>

              {diagLoading ? (
                <p className="pane-subtitle">{EN.diagnostics.loading}</p>
              ) : (
                <div className="card-box">
                  <div className="review-row">
                    <span>{EN.diagnostics.overall}</span>
                    <StatusBadge
                      kind={
                        doctor?.overall_status === "PASS"
                          ? "ready"
                          : doctor?.overall_status === "WARN"
                            ? "warn"
                            : "error"
                      }
                      label={doctor?.overall_status ?? "UNKNOWN"}
                    />
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.platform}</span>
                    <strong>{doctor?.checks.platform.os ?? platformInfo?.os ?? "unknown"}</strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.tailscale}</span>
                    <strong>
                      {doctor?.checks.tailscale.daemon_connected
                        ? EN.diagnostics.connected
                        : EN.diagnostics.stopped}
                    </strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.ssh}</span>
                    <strong>
                      {doctor?.checks.ssh.client_available
                        ? EN.diagnostics.installed
                        : EN.diagnostics.notInstalled}
                    </strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.config}</span>
                    <strong>
                      {doctor?.checks.configuration.valid ? "Valid" : "Not configured"}
                    </strong>
                  </div>
                  {diagnose ? (
                    <>
                      <div className="review-row">
                        <span>{EN.diagnostics.rootCause}</span>
                        <strong>{diagnose.root_cause}</strong>
                      </div>
                      <div className="review-row">
                        <span>{EN.diagnostics.action}</span>
                        <strong>{diagnose.recovery_plan.recommended_action}</strong>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </>
          )}

          {appState === "SETTINGS" && (
            <>
              <h2 className="pane-title">{EN.settings.title}</h2>
              <p className="pane-subtitle">{EN.settings.subtitle}</p>

              <div className="card-box">
                <div className="review-row">
                  <span>{EN.settings.cliVersion}</span>
                  <strong>{cliVersion || "unknown"}</strong>
                </div>
                <div className="review-row">
                  <span>{EN.settings.platformLabel}</span>
                  <strong>{platformInfo?.supported_note ?? "Linux"}</strong>
                </div>
                <div className="review-row">
                  <span>{EN.settings.configPathLabel}</span>
                  <strong>{resetPreview?.config_path ?? "~/.config/jack/config"}</strong>
                </div>
              </div>

              <div className="card-box">
                <h3 style={{ marginTop: 0 }}>{EN.settings.resetTitle}</h3>
                <p className="pane-subtitle">{EN.settings.resetDescription}</p>

                {!showResetConfirm ? (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      setShowResetConfirm(true);
                      void loadSettingsData();
                    }}
                  >
                    {EN.settings.resetCta}
                  </button>
                ) : (
                  <div className="banner-warn" style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {EN.settings.resetConfirmTitle}
                    </div>
                    <p style={{ margin: "0 0 8px" }}>{EN.settings.resetConfirmBody}</p>
                    {resetPreview ? (
                      <div style={{ fontSize: 13, marginBottom: 10 }}>
                        <div>
                          <strong>{EN.settings.configPathLabel}:</strong> {resetPreview.config_path}
                        </div>
                        <div>
                          <strong>{EN.settings.resetPreservedLabel}</strong>{" "}
                          {resetPreview.preserved_items.join(", ")}
                        </div>
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowResetConfirm(false)}
                        disabled={resetting}
                      >
                        {EN.settings.resetCancel}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => void handleResetConfirm()}
                        disabled={resetting}
                      >
                        {resetting ? EN.settings.resetting : EN.settings.resetConfirmAction}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="card-box">
                <h3 style={{ marginTop: 0 }}>{EN.settings.uninstallTitle}</h3>
                <p className="pane-subtitle">{EN.settings.uninstallDescription}</p>
                <ul style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 13 }}>
                  <li>{EN.settings.uninstallLinuxArch}</li>
                  <li>{EN.settings.uninstallLinuxDeb}</li>
                  <li>{EN.settings.uninstallWsl}</li>
                </ul>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                  {EN.settings.uninstallDataNote}
                </p>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
