import { useEffect, useMemo, useState } from "react";
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
type WizardStep = "01" | "02" | "03" | "04" | "05" | "06" | "07";

const STEP_NUM: Record<WizardStep, number> = {
  "01": 1,
  "02": 2,
  "03": 3,
  "04": 4,
  "05": 5,
  "06": 6,
  "07": 7,
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
  const [wizardStep, setWizardStep] = useState<WizardStep>("01");
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

  // Tailscale-first onboarding state (G2–G5)
  const [tailscaleState, setTailscaleState] = useState<TailscaleState | null>(null);
  const [tailscaleLoading, setTailscaleLoading] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  const [manualMode, setManualMode] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<TailscalePeer | null>(null);
  const [targetHost, setTargetHost] = useState("");
  const [targetAlias, setTargetAlias] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [setDefault, setSetDefault] = useState(true);

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [networkResult, setNetworkResult] = useState<NetworkReachabilityResult | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [sshConsent, setSshConsent] = useState(false);
  const [sshAuthResult, setSshAuthResult] = useState<SshAuthTestResult | null>(null);
  const [sshAuthLoading, setSshAuthLoading] = useState(false);

  const [saving, setSaving] = useState(false);
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

  const buildWizardRequest = (confirmed = false): WizardSaveRequest => ({
    mode: "device",
    device_alias: effectiveAlias,
    device_user: sshUser.trim(),
    device_host: targetHost.trim(),
    set_default: setDefault,
    confirmed,
  });

  const resetWizardDraft = () => {
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
    setErrorMsg(null);
  };

  const refreshDevices = async (): Promise<DeviceEntry[]> => {
    const list = await jackApi.listDevices();
    setDevices(list);
    return list;
  };

  const loadTailscaleState = async () => {
    setTailscaleLoading(true);
    setErrorMsg(null);
    try {
      const ts = await jackApi.getTailscaleState();
      setTailscaleState(ts);
      if (ts.running && ts.authenticated) {
        setDiscoveryLoading(true);
        const disc = await jackApi.discoverTailscalePeers();
        setDiscovery(disc);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTailscaleLoading(false);
      setDiscoveryLoading(false);
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

  const runPreflightCheck = async () => {
    setPreflightLoading(true);
    setErrorMsg(null);
    try {
      const res = await jackApi.runPreflight(buildWizardRequest(false));
      setPreflight(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleCheckNetworkReachability = async () => {
    setNetworkLoading(true);
    setErrorMsg(null);
    try {
      const res = await jackApi.checkNetworkReachability(targetHost.trim());
      setNetworkResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setNetworkLoading(false);
    }
  };

  const handleTestSshAuth = async () => {
    if (!sshConsent) return;
    setSshAuthLoading(true);
    setErrorMsg(null);
    try {
      const res = await jackApi.testSshAuthentication(sshUser.trim(), targetHost.trim(), sshConsent);
      setSshAuthResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSshAuthLoading(false);
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
        const stepParam = params.get("step") as WizardStep | null;
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
        } else if (stepParam && STEP_NUM[stepParam]) {
          setAppState("ONBOARDING");
          setWizardStep(stepParam);
          if (stepParam === "02") void loadTailscaleState();
          if (stepParam === "03") void loadDiscovery();
          if (stepParam === "05") void runPreflightCheck();
        } else if (list.length > 0) {
          setAppState("DASHBOARD");
        } else {
          setAppState("ONBOARDING");
          setWizardStep("01");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    };
    void boot();
  }, []);

  const isStep03Valid = useMemo(
    () => isValidHost(targetHost.trim()) && isValidAlias(effectiveAlias),
    [targetHost, effectiveAlias],
  );

  const isStep04Valid = useMemo(() => isValidUser(sshUser.trim()), [sshUser]);

  const startFirstRunSetup = () => {
    setWizardOrigin("FIRST_RUN");
    setErrorMsg(null);
    setActionMsg(null);
    setWizardStep("02");
    setAppState("ONBOARDING");
    void loadTailscaleState();
  };

  const startAddDeviceFromDashboard = () => {
    resetWizardDraft();
    setWizardOrigin("DASHBOARD");
    setWizardStep("03");
    setAppState("ONBOARDING");
    void loadDiscovery();
  };

  const handleSelectPeer = (peer: TailscalePeer) => {
    setSelectedPeer(peer);
    setTargetHost(peer.address || peer.name);
    setTargetAlias(sanitizeAlias(peer.name));
    setManualMode(false);
    setErrorMsg(null);
  };

  const handleStep02Continue = (useManual = false) => {
    setErrorMsg(null);
    if (useManual) {
      setManualMode(true);
    } else if (!discovery && tailscaleState?.authenticated) {
      void loadDiscovery();
    }
    setWizardStep("03");
  };

  const handleStep03Continue = () => {
    if (!isStep03Valid) {
      if (targetAlias.trim() && !isValidAlias(targetAlias.trim())) {
        setErrorMsg(EN.errors.invalidAlias);
      } else {
        setErrorMsg(EN.errors.missingSelection);
      }
      return;
    }
    setErrorMsg(null);
    setWizardStep("04");
  };

  const handleStep04Continue = () => {
    if (!isStep04Valid) {
      setErrorMsg(EN.errors.invalidUser);
      return;
    }
    setErrorMsg(null);
    setWizardStep("05");
    void runPreflightCheck();
  };

  const handleStep05Continue = () => {
    if (!preflight || !preflight.can_save) {
      setErrorMsg(EN.errors.preflightBlocked);
      return;
    }
    setErrorMsg(null);
    setWizardStep("06");
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await jackApi.saveWizardConfig(buildWizardRequest(true));
      setDevices(res.devices);
      setWizardStep("07");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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
      setWizardStep("01");
      setAppState("ONBOARDING");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  // 1. ONBOARDING: Step 01 Welcome (official logo only, no redundant text, rounded buttons)
  if (appState === "ONBOARDING" && wizardStep === "01") {
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

  // 2. ONBOARDING: Steps 02..07 with 7-step Tailscale-first WizardSidebar
  if (appState === "ONBOARDING") {
    const tsReady = Boolean(tailscaleState?.running && tailscaleState?.authenticated);
    const sshStatusLabel =
      sshAuthResult?.status === "VERIFIED"
        ? EN.testStep.sshVerified
        : sshAuthResult?.status === "FAILED"
          ? EN.testStep.sshFailed
          : EN.testStep.sshNotTested;

    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} showBrandText={false} />
        <div className="split-layout">
          <WizardSidebar activeStep={STEP_NUM[wizardStep]} />
          <main className="main-pane">
            {errorMsg ? <div className="banner-error">{errorMsg}</div> : null}

            {wizardStep === "02" && (
              <>
                <h2 className="pane-title">{EN.tailscale.title}</h2>
                <p className="pane-subtitle">{EN.tailscale.subtitle}</p>

                {tailscaleLoading || !tailscaleState ? (
                  <p className="pane-subtitle">{EN.tailscale.checking}</p>
                ) : (
                  <>
                    <div className="card-box">
                      <div className="review-row">
                        <span>{EN.tailscale.cliLabel}</span>
                        <StatusBadge
                          kind={tailscaleState.cli_installed ? "ready" : "warn"}
                          label={
                            tailscaleState.cli_installed
                              ? EN.tailscale.installed
                              : EN.tailscale.notInstalled
                          }
                        />
                      </div>
                      <div className="review-row">
                        <span>{EN.tailscale.stateLabel}</span>
                        <StatusBadge
                          kind={tsReady ? "ready" : "warn"}
                          label={
                            tsReady
                              ? EN.tailscale.connected
                              : tailscaleState.backend_state === "NeedsLogin"
                                ? EN.tailscale.needsLogin
                                : EN.tailscale.stopped
                          }
                        />
                      </div>
                      {tailscaleState.tailnet_name ? (
                        <div className="review-row">
                          <span>{EN.tailscale.tailnetLabel}</span>
                          <strong>{tailscaleState.tailnet_name}</strong>
                        </div>
                      ) : null}
                    </div>

                    {tsReady ? (
                      <div className="banner-success">{EN.tailscale.readyNote}</div>
                    ) : (
                      <div className="banner-warn">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {EN.tailscale.setupHelpTitle}
                        </div>
                        <div>{EN.tailscale.setupHelpBody}</div>
                      </div>
                    )}
                  </>
                )}

                <div className="footer-actions">
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setErrorMsg(null);
                        setWizardStep("01");
                      }}
                    >
                      {EN.tailscale.back}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void loadTailscaleState()}
                      disabled={tailscaleLoading}
                    >
                      {EN.tailscale.recheck}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!tsReady && !tailscaleLoading ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => handleStep02Continue(true)}
                      >
                        {EN.tailscale.continueManual}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleStep02Continue(!tsReady)}
                      disabled={tailscaleLoading}
                    >
                      {EN.tailscale.next}
                    </button>
                  </div>
                </div>
              </>
            )}

            {wizardStep === "03" && (
              <>
                <h2 className="pane-title">
                  {manualMode ? EN.discovery.manualTitle : EN.discovery.title}
                </h2>
                <p className="pane-subtitle">
                  {manualMode ? EN.discovery.manualSubtitle : EN.discovery.subtitle}
                </p>

                <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                  {!manualMode ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void loadDiscovery()}
                      disabled={discoveryLoading}
                    >
                      {EN.discovery.refresh}
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
                    {manualMode ? EN.discovery.usePeersToggle : EN.discovery.manualToggle}
                  </button>
                </div>

                {!manualMode ? (
                  discoveryLoading ? (
                    <p className="pane-subtitle">{EN.discovery.loading}</p>
                  ) : discovery && discovery.peers.length > 0 ? (
                    <div className="peer-list">
                      {discovery.peers.map((peer) => {
                        const selected =
                          selectedPeer?.id === peer.id ||
                          targetHost === peer.address ||
                          targetHost === peer.name;
                        return (
                          <button
                            key={peer.id}
                            type="button"
                            className={`peer-row ${selected ? "selected" : ""}`}
                            onClick={() => handleSelectPeer(peer)}
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
                              label={
                                peer.online
                                  ? EN.discovery.networkOnline
                                  : EN.discovery.networkOffline
                              }
                            />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="pane-subtitle">{EN.discovery.empty}</p>
                  )
                ) : null}

                {(manualMode || (discovery && discovery.peers.length === 0)) && (
                  <>
                    <div className="field-group">
                      <label className="field-label" htmlFor="target-host-input">
                        {EN.discovery.hostLabel}
                      </label>
                      <input
                        id="target-host-input"
                        className="text-input"
                        value={targetHost}
                        onChange={(e) => {
                          setSelectedPeer(null);
                          setTargetHost(e.target.value);
                        }}
                        placeholder={EN.discovery.hostPlaceholder}
                      />
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                        {EN.discovery.hostHint}
                      </p>
                    </div>
                    <div className="field-group">
                      <label className="field-label" htmlFor="target-alias-input">
                        {EN.discovery.aliasLabel}
                      </label>
                      <input
                        id="target-alias-input"
                        className="text-input"
                        value={targetAlias}
                        onChange={(e) => setTargetAlias(e.target.value)}
                        placeholder={EN.discovery.aliasPlaceholder}
                      />
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                        {EN.discovery.aliasHint}
                      </p>
                    </div>
                  </>
                )}

                {selectedPeer?.is_windows ? (
                  <div className="banner-warn">{EN.discovery.windowsWarning}</div>
                ) : null}
                {selectedPeer && !selectedPeer.online ? (
                  <div className="banner-warn">{EN.discovery.offlineWarning}</div>
                ) : null}

                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      if (wizardOrigin === "DASHBOARD") {
                        setAppState("DASHBOARD");
                      } else {
                        setWizardStep("02");
                      }
                    }}
                  >
                    {wizardOrigin === "DASHBOARD" ? EN.discovery.cancel : EN.discovery.back}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleStep03Continue}
                    disabled={!isStep03Valid}
                  >
                    {EN.discovery.next}
                  </button>
                </div>
              </>
            )}

            {wizardStep === "04" && (
              <>
                <h2 className="pane-title">{EN.sshUser.title}</h2>
                <p className="pane-subtitle">
                  {EN.sshUser.subtitle} <strong>{selectedPeer?.name || targetHost.trim()}</strong>.
                </p>

                <div className="field-group">
                  <label className="field-label" htmlFor="ssh-user-input">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <UserIcon />
                      {EN.sshUser.label}
                    </span>
                  </label>
                  <input
                    id="ssh-user-input"
                    className="text-input"
                    value={sshUser}
                    onChange={(e) => setSshUser(e.target.value)}
                    placeholder={EN.sshUser.userPlaceholder}
                  />
                </div>

                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>
                  {EN.sshUser.userHint}
                </p>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                  {EN.sshUser.securityNote}
                </p>

                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      setWizardStep("03");
                    }}
                  >
                    {EN.sshUser.back}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleStep04Continue}
                    disabled={!isStep04Valid}
                  >
                    {EN.sshUser.next}
                  </button>
                </div>
              </>
            )}

            {wizardStep === "05" && (
              <>
                <h2 className="pane-title">{EN.testStep.title}</h2>
                <p className="pane-subtitle">{EN.testStep.subtitle}</p>

                {/* Level 1: Local Preflight */}
                <div className="card-box">
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{EN.testStep.preflightTitle}</div>
                  {preflightLoading || !preflight ? (
                    <p className="pane-subtitle">{EN.testStep.running}</p>
                  ) : (
                    preflight.checks.map((item) => {
                      const kind: BadgeKind =
                        item.status === "PASS"
                          ? "ready"
                          : item.status === "WARNING"
                            ? "warn"
                            : "error";
                      return (
                        <div key={item.name} className="review-row">
                          <div>
                            <div style={{ fontWeight: 600 }}>{item.name}</div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                              {item.detail}
                            </div>
                          </div>
                          <StatusBadge kind={kind} label={item.status} />
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Level 2: Network Reachability */}
                <div className="card-box">
                  <div className="review-row">
                    <div>
                      <div style={{ fontWeight: 700 }}>{EN.testStep.networkTitle}</div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {networkResult ? networkResult.detail : EN.testStep.networkIdle}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {networkResult ? (
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
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleCheckNetworkReachability()}
                        disabled={networkLoading}
                      >
                        {networkLoading ? EN.testStep.networkChecking : EN.testStep.networkCheckCta}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Level 3: Explicitly Authorized SSH Authentication Test */}
                <div className="card-box">
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{EN.testStep.sshTitle}</div>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 10px" }}>
                    {EN.testStep.sshNote}
                  </p>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={sshConsent}
                      onChange={(e) => setSshConsent(e.target.checked)}
                    />
                    <span>
                      {EN.testStep.sshConsentLabel}{" "}
                      <strong>
                        {sshUser.trim()}@{targetHost.trim()}
                      </strong>
                      .
                    </span>
                  </label>
                  <div className="review-row">
                    <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      {sshAuthResult ? sshAuthResult.detail : EN.testStep.sshNotTested}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <StatusBadge
                        kind={
                          sshAuthResult?.status === "VERIFIED"
                            ? "ready"
                            : sshAuthResult?.status === "FAILED"
                              ? "error"
                              : "warn"
                        }
                        label={sshStatusLabel}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleTestSshAuth()}
                        disabled={!sshConsent || sshAuthLoading}
                      >
                        {sshAuthLoading ? EN.testStep.sshTesting : EN.testStep.sshTestCta}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="footer-actions">
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setErrorMsg(null);
                        setWizardStep("04");
                      }}
                    >
                      {EN.testStep.back}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void runPreflightCheck()}
                      disabled={preflightLoading}
                    >
                      {EN.testStep.recheck}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleStep05Continue}
                    disabled={preflightLoading || !preflight?.can_save}
                  >
                    {EN.testStep.next}
                  </button>
                </div>
              </>
            )}

            {wizardStep === "06" && (
              <>
                <h2 className="pane-title">{EN.review.title}</h2>
                <p className="pane-subtitle">{EN.review.subtitle}</p>

                <div className="card-box">
                  <div className="review-row">
                    <span>{EN.review.aliasLabel}</span>
                    <strong>{effectiveAlias}</strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.review.hostLabel}</span>
                    <strong>{targetHost.trim()}</strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.review.userLabel}</span>
                    <strong>{sshUser.trim()}</strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.review.preflightLabel}</span>
                    <StatusBadge
                      kind={preflight?.can_save ? "ready" : "error"}
                      label={preflight?.overall ?? "UNKNOWN"}
                    />
                  </div>
                  <div className="review-row">
                    <span>{EN.review.networkLabel}</span>
                    <strong>{networkResult?.status ?? "NOT_TESTED"}</strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.review.sshAuthLabel}</span>
                    <StatusBadge
                      kind={
                        sshAuthResult?.status === "VERIFIED"
                          ? "ready"
                          : sshAuthResult?.status === "FAILED"
                            ? "error"
                            : "warn"
                      }
                      label={sshStatusLabel}
                    />
                  </div>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={setDefault}
                    onChange={(e) => setSetDefault(e.target.checked)}
                  />
                  <span>{EN.review.setDefaultLabel}</span>
                </label>

                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                  {EN.review.overwriteNotice}
                </p>

                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      setWizardStep("05");
                    }}
                  >
                    {EN.review.back}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {saving ? EN.review.saving : EN.review.save}
                  </button>
                </div>
              </>
            )}

            {wizardStep === "07" && (
              <>
                <h2 className="pane-title">
                  {sshAuthResult?.status === "VERIFIED"
                    ? EN.success.titleVerified
                    : sshAuthResult?.status === "FAILED"
                      ? EN.success.titleFailed
                      : EN.success.titleNotVerified}
                </h2>
                <p className="pane-subtitle">
                  {sshAuthResult?.status === "VERIFIED"
                    ? EN.success.subtitleVerified
                    : sshAuthResult?.status === "FAILED"
                      ? EN.success.subtitleFailed
                      : EN.success.subtitleNotVerified}
                </p>
                <div
                  className={
                    sshAuthResult?.status === "VERIFIED" ? "banner-success" : "banner-warn"
                  }
                >
                  {effectiveAlias} ({sshUser.trim()}@{targetHost.trim()}) —{" "}
                  {sshAuthResult?.status === "VERIFIED"
                    ? EN.testStep.sshVerified
                    : sshAuthResult?.status === "FAILED"
                      ? EN.testStep.sshFailed
                      : EN.dashboard.statusConfigured}
                </div>
                {connectResult ? (
                  <div className="banner-warn">{connectResult.message}</div>
                ) : null}
                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setConnectResult(null);
                      setAppState("DASHBOARD");
                    }}
                  >
                    {EN.success.goDashboard}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleConnect(effectiveAlias)}
                  >
                    {EN.success.connectNow}
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
                      setWizardStep("01");
                      setAppState("ONBOARDING");
                    }}
                  >
                    {EN.tailscale.back}
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
                        ? EN.tailscale.connected
                        : EN.tailscale.stopped}
                    </strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.ssh}</span>
                    <strong>
                      {doctor?.checks.ssh.client_available
                        ? EN.tailscale.installed
                        : EN.tailscale.notInstalled}
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
