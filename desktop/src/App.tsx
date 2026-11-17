import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectResult,
  DeviceEntry,
  DeviceStatusJson,
  DiagnoseJson,
  DiscoveryResult,
  DoctorJson,
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
  sanitizeAlias,
} from "./api/jack";
import {
  BadgeKind,
  GearIcon,
  JackMark,
  OsIcon,
  StatusBadge,
  TitleBar,
  UserIcon,
  WizardSidebar,
} from "./components/DesignSystem";
import { EN } from "./i18n/en";

type AppState = "ONBOARDING" | "DASHBOARD" | "DIAGNOSTICS" | "SETTINGS";
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
  const [appState, setAppState] = useState<AppState>("ONBOARDING");
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
      try {
        const [ver, plat, list] = await Promise.all([
          jackApi.getCliVersion(),
          jackApi.getPlatformInfo(),
          jackApi.listDevices(),
        ]);
        setCliVersion(ver);
        setPlatformInfo(plat);
        setDevices(list);

        const params = new URLSearchParams(window.location.search);
        const stepParam = params.get("step")?.toLowerCase();
        const stateParam = params.get("state");

        if (stateParam === "dashboard") {
          setAppState("DASHBOARD");
        } else if (stateParam === "diagnostics") {
          setDiagnosticsOrigin(list.length > 0 ? "DASHBOARD" : "WELCOME");
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
        } else if (list.length > 0) {
          setAppState("DASHBOARD");
        } else {
          setAppState("ONBOARDING");
          setStage("WELCOME");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
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
                      style={{
                        maxHeight: "calc(100vh - 290px)",
                        minHeight: 140,
                        overflowY: "auto",
                        paddingRight: 4,
                      }}
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
                  style={{ marginBottom: 10, padding: "12px 16px", maxHeight: 220, overflowY: "auto" }}
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
