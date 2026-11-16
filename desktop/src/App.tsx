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
type OnboardingMoment = "WELCOME" | "M1" | "M2" | "M3";
type CompletionKind = "CONNECTED" | "SIMULATION" | "FAILED" | "NEEDS_SETUP";

const MOMENT_NUM: Record<OnboardingMoment, number> = {
  WELCOME: 0,
  M1: 1,
  M2: 2,
  M3: 3,
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
  const [moment, setMoment] = useState<OnboardingMoment>("WELCOME");
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

  // Moment 1: Tailscale & Device Discovery
  const [tailscaleState, setTailscaleState] = useState<TailscaleState | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [peerFilter, setPeerFilter] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<TailscalePeer | null>(null);
  const [targetHost, setTargetHost] = useState("");
  const [targetAlias, setTargetAlias] = useState("");

  // Moment 2: Connect & Verify
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

  // Moment 3: Ready / Action Required
  const [completionKind, setCompletionKind] = useState<CompletionKind>("NEEDS_SETUP");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);

  // Settings / Reset state
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

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
    confirmed = false,
  ): WizardSaveRequest => ({
    mode: "device",
    device_alias: aliasOverride ?? effectiveAlias,
    device_user: sshUser.trim(),
    device_host: (hostOverride ?? targetHost).trim(),
    set_default: setDefault,
    confirmed,
  });

  const resetWizardDraft = () => {
    checkSeqRef.current += 1;
    writeLockRef.current = false;
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

  const loadMoment1Discovery = async () => {
    setDiscoveryLoading(true);
    setErrorMsg(null);
    try {
      const ts = await jackApi.getTailscaleState();
      setTailscaleState(ts);
      if (ts.running && ts.authenticated) {
        const disc = await jackApi.discoverTailscalePeers();
        setDiscovery(disc);
      } else {
        setDiscovery({
          available: false,
          backend_state: ts.backend_state,
          peers: [],
          message: ts.message,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const runMoment2Checks = async (hostToCheck: string, aliasToCheck: string, userToCheck: string) => {
    const seq = ++checkSeqRef.current;
    setChecksLoading(true);
    setPreflight(null);
    setNetworkResult(null);
    setErrorMsg(null);
    try {
      const req: WizardSaveRequest = {
        mode: "device",
        device_alias: aliasToCheck,
        // Use a valid placeholder for structural preflight until the user enters sshUser;
        // actual username is validated via isUsernameValid and re-checked in runPreflight on submit.
        device_user: userToCheck || "pending_user",
        device_host: hostToCheck,
        set_default: setDefault,
        confirmed: false,
      };
      const [preRes, netRes] = await Promise.all([
        jackApi.runPreflight(req),
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
          setMoment("WELCOME");
        } else if (stepParam === "m1") {
          setAppState("ONBOARDING");
          setMoment("M1");
          void loadMoment1Discovery();
        } else if (stepParam === "m2") {
          setAppState("ONBOARDING");
          setMoment("M2");
          void runMoment2Checks("100.64.0.10", "demo-device", "");
        } else if (stepParam === "m3") {
          setAppState("ONBOARDING");
          setMoment("M3");
          setCompletionKind("CONNECTED");
        } else if (list.length > 0) {
          setAppState("DASHBOARD");
        } else {
          setAppState("ONBOARDING");
          setMoment("WELCOME");
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
    setMoment("M1");
    setAppState("ONBOARDING");
    void loadMoment1Discovery();
  };

  const startAddDeviceFromDashboard = () => {
    resetWizardDraft();
    setWizardOrigin("DASHBOARD");
    setMoment("M1");
    setAppState("ONBOARDING");
    void loadMoment1Discovery();
  };

  const enterMoment2 = (host: string, alias: string) => {
    setSshConsent(false);
    setSshAuthResult(null);
    setErrorMsg(null);
    setMoment("M2");
    void runMoment2Checks(host, alias, sshUser.trim());
  };

  const handleSelectPeerAndAdvance = (peer: TailscalePeer) => {
    const host = (peer.address || peer.name).trim();
    const alias = sanitizeAlias(peer.name);
    setSelectedPeer(peer);
    setTargetHost(host);
    setTargetAlias(alias);
    setManualMode(false);
    enterMoment2(host, alias);
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
    enterMoment2(targetHost.trim(), effectiveAlias);
  };

  const persistDevice = async (): Promise<boolean> => {
    const res = await jackApi.saveWizardConfig(buildWizardRequest(undefined, undefined, true));
    setDevices(res.devices);
    return res.saved;
  };

  const handleVerifyAndSave = async () => {
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
      // Re-run preflight with actual username before saving
      const pre = await jackApi.runPreflight(buildWizardRequest(undefined, undefined, false));
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

      if (authRes.status === "VERIFIED") {
        await persistDevice();
        setCompletionKind("CONNECTED");
        setMoment("M3");
      } else if (authRes.status === "NOT_TESTED") {
        await persistDevice();
        setCompletionKind("SIMULATION");
        setMoment("M3");
      } else {
        // FAILED: stay on Moment 2 with classified recovery guidance & retry
        setErrorMsg(authRes.detail);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      writeLockRef.current = false;
      setBusyAction(null);
    }
  };

  const handleSaveUnverified = async () => {
    if (writeLockRef.current || busyAction !== null) return;
    if (!isUsernameValid) {
      setErrorMsg(EN.errors.invalidUser);
      return;
    }

    writeLockRef.current = true;
    setBusyAction("save");
    setErrorMsg(null);
    try {
      const pre = await jackApi.runPreflight(buildWizardRequest(undefined, undefined, false));
      setPreflight(pre);
      if (!pre.can_save) {
        setErrorMsg(EN.errors.preflightBlocked);
        return;
      }
      await persistDevice();
      setCompletionKind(sshAuthResult?.status === "FAILED" ? "FAILED" : "NEEDS_SETUP");
      setMoment("M3");
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
      setMoment("WELCOME");
      setAppState("ONBOARDING");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  // 1. ONBOARDING: Welcome
  if (appState === "ONBOARDING" && moment === "WELCOME") {
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

  // 2. ONBOARDING: 3-Moment Adaptive Experience (M1 -> M2 -> M3)
  if (appState === "ONBOARDING") {
    const tsUnavailable =
      tailscaleState !== null && (!tailscaleState.running || !tailscaleState.authenticated);
    const showManualFields =
      manualMode || (!discoveryLoading && (discovery?.peers.length ?? 0) === 0);

    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} showBrandText={false} />
        <div className="split-layout">
          <WizardSidebar activeStep={MOMENT_NUM[moment]} />
          <main className="main-pane" style={{ display: "flex", flexDirection: "column" }}>
            {errorMsg ? <div className="banner-error">{errorMsg}</div> : null}

            {moment === "M1" && (
              <>
                <h2 className="pane-title">
                  {manualMode ? EN.moment1.manualTitle : EN.moment1.title}
                </h2>
                <p className="pane-subtitle">
                  {manualMode ? EN.moment1.manualSubtitle : EN.moment1.subtitle}
                </p>

                {tsUnavailable && !manualMode ? (
                  <div className="banner-warn">{EN.moment1.tailscaleUnavailable}</div>
                ) : null}

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                  {!manualMode ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void loadMoment1Discovery()}
                      disabled={discoveryLoading}
                    >
                      {EN.moment1.refresh}
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
                    {manualMode ? EN.moment1.usePeersToggle : EN.moment1.manualToggle}
                  </button>
                  {!manualMode && (discovery?.peers.length ?? 0) > 0 ? (
                    <input
                      aria-label="Filter devices"
                      className="text-input"
                      style={{ flex: 1, minWidth: 180 }}
                      value={peerFilter}
                      onChange={(e) => setPeerFilter(e.target.value)}
                      placeholder={EN.moment1.filterPlaceholder}
                    />
                  ) : null}
                </div>

                {!manualMode && (
                  discoveryLoading ? (
                    <p className="pane-subtitle">{EN.moment1.loading}</p>
                  ) : filteredPeers.length > 0 ? (
                    <div
                      className="peer-list"
                      role="list"
                      aria-label="Discovered Tailscale devices"
                      style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}
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
                                  {peer.is_windows ? ` · ${EN.moment1.windowsNote}` : ""}
                                </div>
                              </div>
                            </div>
                            <StatusBadge
                              kind={peer.online ? "ready" : "warn"}
                              label={peer.online ? EN.moment1.networkOnline : EN.moment1.networkOffline}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pane-subtitle">{EN.moment1.empty}</p>
                  )
                )}

                {showManualFields && (
                  <div style={{ marginTop: 6 }}>
                    <div className="field-group">
                      <label className="field-label" htmlFor="target-host-input">
                        {EN.moment1.hostLabel}
                      </label>
                      <input
                        id="target-host-input"
                        className="text-input"
                        value={targetHost}
                        onChange={(e) => {
                          setSelectedPeer(null);
                          setTargetHost(e.target.value);
                        }}
                        placeholder={EN.moment1.hostPlaceholder}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label" htmlFor="target-alias-input">
                        {EN.moment1.aliasLabel}
                      </label>
                      <input
                        id="target-alias-input"
                        className="text-input"
                        value={targetAlias}
                        onChange={(e) => setTargetAlias(e.target.value)}
                        placeholder={EN.moment1.aliasPlaceholder}
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
                      if (wizardOrigin === "DASHBOARD") {
                        setAppState("DASHBOARD");
                      } else {
                        setMoment("WELCOME");
                      }
                    }}
                  >
                    {wizardOrigin === "DASHBOARD" ? EN.moment1.cancel : EN.moment1.back}
                  </button>
                  {showManualFields ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleManualContinue}
                      disabled={!isManualValid}
                    >
                      {EN.moment1.continueManual}
                    </button>
                  ) : null}
                </div>
              </>
            )}

            {moment === "M2" && (
              <>
                <h2 className="pane-title">
                  {EN.moment2.title}: {selectedPeer?.name || targetHost.trim()}
                </h2>
                <p className="pane-subtitle">{EN.moment2.subtitle}</p>

                {selectedPeer && !selectedPeer.online ? (
                  <div className="banner-warn">{EN.moment1.offlineNote}</div>
                ) : null}
                {selectedPeer?.is_windows ? (
                  <div className="banner-warn">{EN.moment1.windowsNote}</div>
                ) : null}

                {/* Progressive Automated Checks */}
                <div className="card-box" style={{ marginBottom: 14 }}>
                  <div className="review-row">
                    <span>{EN.moment2.preflightLabel}</span>
                    {checksLoading || !preflight ? (
                      <StatusBadge kind="configured" label={EN.moment2.checking} />
                    ) : (
                      <StatusBadge
                        kind={preflight.can_save ? "ready" : "error"}
                        label={preflight.overall}
                      />
                    )}
                  </div>
                  <div className="review-row">
                    <div>
                      <div>{EN.moment2.networkLabel}</div>
                      {networkResult ? (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {networkResult.detail}
                        </div>
                      ) : null}
                    </div>
                    {checksLoading || !networkResult ? (
                      <StatusBadge kind="configured" label={EN.moment2.checking} />
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
                      <div>{EN.moment2.sshLabel}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {sshAuthResult ? sshAuthResult.detail : EN.moment2.notTested}
                      </div>
                      {sshAuthResult?.status === "FAILED" && sshAuthResult.recovery_hint ? (
                        <div style={{ fontSize: 12, color: "var(--status-error)", marginTop: 4 }}>
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
                          ? EN.moment2.verified
                          : sshAuthResult?.status === "FAILED"
                            ? EN.moment2.failed
                            : EN.moment2.notTested
                      }
                    />
                  </div>
                </div>

                {/* Required SSH Username (never inferred from local user) */}
                <div className="field-group">
                  <label className="field-label" htmlFor="ssh-user-input">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <UserIcon />
                      {EN.moment2.usernameLabel}
                    </span>
                  </label>
                  <input
                    id="ssh-user-input"
                    className="text-input"
                    value={sshUser}
                    onChange={(e) => {
                      setSshUser(e.target.value);
                      setSshConsent(false);
                      setSshAuthResult(null);
                    }}
                    placeholder={EN.moment2.usernamePlaceholder}
                  />
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                    {EN.moment2.usernameHint}
                  </p>
                </div>

                {/* Explicit Per-Operation Authorization */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    marginBottom: 12,
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
                    {EN.moment2.consentPrefix}{" "}
                    <strong>
                      {sshUser.trim() || "<user>"}@{targetHost.trim()}
                    </strong>
                    .
                  </span>
                </label>

                <div className="footer-actions" style={{ marginTop: "auto" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setErrorMsg(null);
                        setMoment("M1");
                      }}
                      disabled={busyAction !== null}
                    >
                      {EN.moment2.back}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        void runMoment2Checks(targetHost.trim(), effectiveAlias, sshUser.trim())
                      }
                      disabled={checksLoading || busyAction !== null}
                    >
                      {EN.moment2.recheck}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void handleSaveUnverified()}
                      disabled={!isUsernameValid || !preflight?.can_save || busyAction !== null}
                    >
                      {busyAction === "save" ? EN.moment2.saving : EN.moment2.saveUnverified}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleVerifyAndSave()}
                      disabled={
                        !isUsernameValid ||
                        !sshConsent ||
                        !preflight?.can_save ||
                        busyAction !== null
                      }
                    >
                      {busyAction === "verify" ? EN.moment2.verifying : EN.moment2.verifyAndSave}
                    </button>
                  </div>
                </div>
              </>
            )}

            {moment === "M3" && (
              <>
                <h2 className="pane-title">
                  {completionKind === "CONNECTED"
                    ? EN.moment3.titleConnected
                    : completionKind === "SIMULATION"
                      ? EN.moment3.titleSimulation
                      : completionKind === "FAILED"
                        ? EN.moment3.titleFailed
                        : EN.moment3.titleNeedsSetup}
                </h2>
                <p className="pane-subtitle">
                  {completionKind === "CONNECTED"
                    ? EN.moment3.subtitleConnected
                    : completionKind === "SIMULATION"
                      ? EN.moment3.subtitleSimulation
                      : completionKind === "FAILED"
                        ? EN.moment3.subtitleFailed
                        : EN.moment3.subtitleNeedsSetup}
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
                    ? EN.moment3.titleConnected
                    : completionKind === "SIMULATION"
                      ? EN.moment3.titleSimulation
                      : completionKind === "FAILED"
                        ? EN.moment3.titleFailed
                        : EN.moment3.titleNeedsSetup}
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
                          setMoment("M2");
                        }}
                      >
                        {EN.moment3.retryVerify}
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
                      {EN.moment3.goDashboard}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleConnect(effectiveAlias)}
                  >
                    {EN.moment3.connectNow}
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
                      setMoment("WELCOME");
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
