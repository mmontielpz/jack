import { useEffect, useMemo, useState } from "react";
import {
  ConnectResult,
  DeviceEntry,
  DeviceStatusJson,
  DiagnoseJson,
  DiscoveryResult,
  DoctorJson,
  PlatformInfo,
  PreflightResult,
  ResetPreview,
  WizardSaveRequest,
  isValidAlias,
  isValidHost,
  isValidUser,
  jackApi,
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
type WizardMode = "workstation" | "mac" | "both" | "device";

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

  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  // Wizard fields (kept empty on first run; preserved across Back/Continue)
  const [mode, setMode] = useState<WizardMode>("workstation");
  const [manualMode, setManualMode] = useState(false);
  const [wsHost, setWsHost] = useState("");
  const [macHost, setMacHost] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [customHost, setCustomHost] = useState("");
  const [wsUser, setWsUser] = useState("");
  const [macUser, setMacUser] = useState("");
  const [customUser, setCustomUser] = useState("");
  const [setDefault, setSetDefault] = useState(true);

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);

  // Settings / Reset state
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const buildWizardRequest = (confirmed = false): WizardSaveRequest => ({
    mode,
    workstation_user: mode === "workstation" || mode === "both" ? wsUser.trim() : undefined,
    workstation_host: mode === "workstation" || mode === "both" ? wsHost.trim() : undefined,
    mac_user: mode === "mac" || mode === "both" ? macUser.trim() : undefined,
    mac_host: mode === "mac" || mode === "both" ? macHost.trim() : undefined,
    device_alias: mode === "device" ? customAlias.trim() : undefined,
    device_user: mode === "device" ? customUser.trim() : undefined,
    device_host: mode === "device" ? customHost.trim() : undefined,
    set_default: setDefault,
    confirmed,
  });

  const resetWizardDraft = () => {
    setMode("workstation");
    setManualMode(false);
    setWsHost("");
    setMacHost("");
    setCustomAlias("");
    setCustomHost("");
    setWsUser("");
    setMacUser("");
    setCustomUser("");
    setSetDefault(true);
    setPreflight(null);
    setErrorMsg(null);
  };

  const refreshDevices = async (): Promise<DeviceEntry[]> => {
    const list = await jackApi.listDevices();
    setDevices(list);
    return list;
  };

  const loadEnvironmentChecks = async () => {
    setDiagLoading(true);
    setDiscoveryLoading(true);
    setErrorMsg(null);
    try {
      const [docRes, platRes, discRes] = await Promise.all([
        jackApi.runDoctor(),
        jackApi.getPlatformInfo(),
        jackApi.discoverTailscalePeers(),
      ]);
      setDoctor(docRes);
      setPlatformInfo(platRes);
      setDiscovery(discRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagLoading(false);
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
          if (stepParam === "02") void loadEnvironmentChecks();
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

  const hasWindowsPeerSelected = useMemo(() => {
    if (!discovery) return false;
    const selectedHosts = [wsHost, macHost, customHost].filter(Boolean);
    return discovery.peers.some(
      (p) => p.is_windows && (selectedHosts.includes(p.address) || selectedHosts.includes(p.name)),
    );
  }, [discovery, wsHost, macHost, customHost]);

  const isStep03Valid = useMemo(() => {
    if (mode === "workstation") return isValidHost(wsHost.trim());
    if (mode === "mac") return isValidHost(macHost.trim());
    if (mode === "both") return isValidHost(wsHost.trim()) && isValidHost(macHost.trim());
    return isValidAlias(customAlias.trim()) && isValidHost(customHost.trim());
  }, [mode, wsHost, macHost, customAlias, customHost]);

  const isStep04Valid = useMemo(() => {
    if (mode === "workstation") return isValidUser(wsUser.trim());
    if (mode === "mac") return isValidUser(macUser.trim());
    if (mode === "both") return isValidUser(wsUser.trim()) && isValidUser(macUser.trim());
    return isValidUser(customUser.trim());
  }, [mode, wsUser, macUser, customUser]);

  const startFirstRunSetup = () => {
    setWizardOrigin("FIRST_RUN");
    setErrorMsg(null);
    setActionMsg(null);
    setWizardStep("02");
    setAppState("ONBOARDING");
    void loadEnvironmentChecks();
  };

  const startAddDeviceFromDashboard = () => {
    resetWizardDraft();
    setWizardOrigin("DASHBOARD");
    setWizardStep("03");
    setAppState("ONBOARDING");
    void loadDiscovery();
  };

  const handleStep02Continue = () => {
    setErrorMsg(null);
    setWizardStep("03");
    if (!discovery) void loadDiscovery();
  };

  const handleStep03Continue = () => {
    if (!isStep03Valid) {
      if (mode === "both") {
        setErrorMsg(EN.errors.missingBoth);
      } else if (mode === "device" && customAlias.trim() && !isValidAlias(customAlias.trim())) {
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

  const primarySavedAlias =
    mode === "workstation" || mode === "both"
      ? "workstation"
      : mode === "mac"
        ? "mac"
        : customAlias.trim() || "workstation";

  const renderPeerPicker = (
    title: string,
    selectedValue: string,
    onSelect: (val: string) => void,
    manualFieldId: string,
  ) => (
    <div style={{ marginBottom: 16 }}>
      <div className="field-label" style={{ marginBottom: 8 }}>
        {title}
      </div>
      {discoveryLoading ? (
        <p className="pane-subtitle">{EN.discovery.loading}</p>
      ) : discovery && discovery.peers.length > 0 && !manualMode ? (
        <div className="peer-list">
          {discovery.peers.map((peer) => {
            const selected = selectedValue === peer.address || selectedValue === peer.name;
            return (
              <button
                key={`${manualFieldId}-${peer.id}`}
                type="button"
                className={`peer-row ${selected ? "selected" : ""}`}
                onClick={() => onSelect(peer.address || peer.name)}
              >
                <div className="peer-left">
                  <OsIcon os={peer.os} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{peer.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {peer.address} · {peer.os}
                    </div>
                  </div>
                </div>
                <StatusBadge
                  kind={peer.online ? "ready" : "warn"}
                  label={peer.online ? EN.dashboard.statusOnline : EN.dashboard.statusOffline}
                />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="field-group">
          {!manualMode && <p className="pane-subtitle">{EN.discovery.empty}</p>}
          <label className="field-label" htmlFor={manualFieldId}>
            {EN.discovery.manualHostLabel}
          </label>
          <input
            id={manualFieldId}
            className="text-input"
            value={selectedValue}
            onChange={(e) => onSelect(e.target.value)}
            placeholder={EN.discovery.hostPlaceholder}
          />
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
            {EN.discovery.hostHint}
          </p>
        </div>
      )}
    </div>
  );

  // 1. ONBOARDING: Step 01 Welcome (full screen, no sidebar)
  if (appState === "ONBOARDING" && wizardStep === "01") {
    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} />
        <main className="welcome-screen">
          <JackMark size={74} />
          <h1>JACK</h1>
          <p>{EN.welcome.subtitle}</p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0 }}>
            {EN.welcome.platformSummary}
          </p>
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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button type="button" className="btn-primary" onClick={startFirstRunSetup}>
              {EN.welcome.configureCta}
            </button>
            <button
              type="button"
              className="btn-secondary"
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

  // 2. ONBOARDING: Steps 02..07 with 7-step WizardSidebar
  if (appState === "ONBOARDING") {
    const cliAvailable = cliVersion.trim().length > 0;
    const sshAvailable = doctor?.checks.ssh.client_available ?? true;

    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion || undefined} />
        <div className="split-layout">
          <WizardSidebar activeStep={STEP_NUM[wizardStep]} />
          <main className="main-pane">
            {errorMsg ? <div className="banner-error">{errorMsg}</div> : null}

            {wizardStep === "02" && (
              <>
                <h2 className="pane-title">{EN.environment.title}</h2>
                <p className="pane-subtitle">{EN.environment.subtitle}</p>

                {diagLoading ? (
                  <p className="pane-subtitle">{EN.environment.checking}</p>
                ) : (
                  <div className="card-box">
                    <div className="review-row">
                      <span>{EN.environment.osLabel}</span>
                      <StatusBadge
                        kind="ready"
                        label={
                          platformInfo?.is_wsl2
                            ? EN.environment.wslBadge
                            : `${platformInfo?.os ?? "linux"} (${EN.environment.nativeBadge})`
                        }
                      />
                    </div>
                    <div className="review-row">
                      <span>{EN.environment.cliLabel}</span>
                      <StatusBadge
                        kind={cliAvailable ? "ready" : "error"}
                        label={cliAvailable ? cliVersion : EN.environment.missing}
                      />
                    </div>
                    <div className="review-row">
                      <span>{EN.environment.sshLabel}</span>
                      <StatusBadge
                        kind={sshAvailable ? "ready" : "warn"}
                        label={sshAvailable ? EN.environment.available : EN.environment.missing}
                      />
                    </div>
                    <div className="review-row">
                      <span>{EN.environment.tailscaleLabel}</span>
                      <StatusBadge
                        kind={discovery?.available ? "ready" : "configured"}
                        label={
                          discovery?.available
                            ? EN.environment.connected
                            : EN.environment.optionalUnavailable
                        }
                      />
                    </div>
                    <div className="review-row">
                      <span>{EN.environment.configLabel}</span>
                      <StatusBadge
                        kind={doctor?.checks.configuration.file_exists ? "ready" : "configured"}
                        label={
                          doctor?.checks.configuration.file_exists
                            ? EN.environment.configReady
                            : EN.environment.configFresh
                        }
                      />
                    </div>
                  </div>
                )}

                {!cliAvailable ? <div className="banner-error">{EN.environment.cliMissingError}</div> : null}
                {cliAvailable && !sshAvailable ? (
                  <div className="banner-warn">{EN.environment.sshMissingWarning}</div>
                ) : null}

                <div className="footer-actions">
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setErrorMsg(null);
                        setWizardStep("01");
                      }}
                    >
                      {EN.environment.back}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void loadEnvironmentChecks()}
                      disabled={diagLoading}
                    >
                      {EN.environment.recheck}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleStep02Continue}
                    disabled={diagLoading || !cliAvailable}
                  >
                    {EN.environment.next}
                  </button>
                </div>
              </>
            )}

            {wizardStep === "03" && (
              <>
                <h2 className="pane-title">{EN.targetChoice.title}</h2>
                <p className="pane-subtitle">{EN.targetChoice.subtitle}</p>

                <div className="choice-grid" style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    className={`choice-card ${mode === "workstation" ? "selected" : ""}`}
                    onClick={() => setMode("workstation")}
                  >
                    <OsIcon role="workstation" />
                    <strong>{EN.targetChoice.workstation}</strong>
                    <span className="pane-subtitle" style={{ margin: 0 }}>
                      {EN.targetChoice.workstationSub}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`choice-card ${mode === "mac" ? "selected" : ""}`}
                    onClick={() => setMode("mac")}
                  >
                    <OsIcon role="mac" />
                    <strong>{EN.targetChoice.mac}</strong>
                    <span className="pane-subtitle" style={{ margin: 0 }}>
                      {EN.targetChoice.macSub}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`choice-card ${mode === "both" ? "selected" : ""}`}
                    onClick={() => setMode("both")}
                  >
                    <OsIcon role="workstation" />
                    <strong>{EN.targetChoice.both}</strong>
                    <span className="pane-subtitle" style={{ margin: 0 }}>
                      {EN.targetChoice.bothSub}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`choice-card ${mode === "device" ? "selected" : ""}`}
                    onClick={() => setMode("device")}
                  >
                    <OsIcon />
                    <strong>{EN.targetChoice.custom}</strong>
                    <span className="pane-subtitle" style={{ margin: 0 }}>
                      {EN.targetChoice.customSub}
                    </span>
                  </button>
                </div>

                {mode === "device" && (
                  <div className="field-group">
                    <label className="field-label" htmlFor="custom-alias-input">
                      {EN.discovery.manualAliasLabel}
                    </label>
                    <input
                      id="custom-alias-input"
                      className="text-input"
                      value={customAlias}
                      onChange={(e) => setCustomAlias(e.target.value)}
                      placeholder={EN.discovery.aliasPlaceholder}
                    />
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0" }}>
                      {EN.discovery.aliasHint}
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void loadDiscovery()}
                    disabled={discoveryLoading}
                  >
                    {EN.discovery.refresh}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setManualMode((v) => !v)}
                  >
                    {EN.discovery.manualToggle}
                  </button>
                </div>

                {(mode === "workstation" || mode === "both") &&
                  renderPeerPicker(EN.discovery.titleWorkstation, wsHost, setWsHost, "ws-host-input")}
                {(mode === "mac" || mode === "both") &&
                  renderPeerPicker(EN.discovery.titleMac, macHost, setMacHost, "mac-host-input")}
                {mode === "device" &&
                  renderPeerPicker(EN.discovery.titleDevice, customHost, setCustomHost, "custom-host-input")}

                {hasWindowsPeerSelected ? (
                  <div className="banner-warn">{EN.discovery.windowsWarning}</div>
                ) : null}

                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
                  {EN.targetChoice.platformNote}
                </p>

                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      if (wizardOrigin === "DASHBOARD") {
                        setAppState("DASHBOARD");
                      } else {
                        setWizardStep("02");
                      }
                    }}
                  >
                    {wizardOrigin === "DASHBOARD" ? EN.targetChoice.cancel : EN.targetChoice.back}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleStep03Continue}
                    disabled={!isStep03Valid}
                  >
                    {EN.targetChoice.next}
                  </button>
                </div>
              </>
            )}

            {wizardStep === "04" && (
              <>
                <h2 className="pane-title">{EN.sshUser.title}</h2>
                <p className="pane-subtitle">{EN.sshUser.subtitle}</p>

                {(mode === "workstation" || mode === "both") && (
                  <div className="field-group">
                    <label className="field-label" htmlFor="ws-user-input">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <UserIcon />
                        {EN.sshUser.workstationLabel}
                      </span>
                    </label>
                    <input
                      id="ws-user-input"
                      className="text-input"
                      value={wsUser}
                      onChange={(e) => setWsUser(e.target.value)}
                      placeholder={EN.sshUser.userPlaceholder}
                    />
                  </div>
                )}

                {(mode === "mac" || mode === "both") && (
                  <div className="field-group">
                    <label className="field-label" htmlFor="mac-user-input">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <UserIcon />
                        {EN.sshUser.macLabel}
                      </span>
                    </label>
                    <input
                      id="mac-user-input"
                      className="text-input"
                      value={macUser}
                      onChange={(e) => setMacUser(e.target.value)}
                      placeholder={EN.sshUser.userPlaceholder}
                    />
                  </div>
                )}

                {mode === "device" && (
                  <div className="field-group">
                    <label className="field-label" htmlFor="custom-user-input">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <UserIcon />
                        {EN.sshUser.deviceLabel}
                      </span>
                    </label>
                    <input
                      id="custom-user-input"
                      className="text-input"
                      value={customUser}
                      onChange={(e) => setCustomUser(e.target.value)}
                      placeholder={EN.sshUser.userPlaceholder}
                    />
                  </div>
                )}

                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>
                  {EN.sshUser.userHint}
                </p>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                  {EN.sshUser.securityNote}
                </p>

                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      setWizardStep("03");
                    }}
                  >
                    {EN.sshUser.back}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
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
                <h2 className="pane-title">{EN.preflight.title}</h2>
                <p className="pane-subtitle">{EN.preflight.subtitle}</p>

                {preflightLoading || !preflight ? (
                  <p className="pane-subtitle">{EN.preflight.running}</p>
                ) : (
                  <>
                    {preflight.overall === "PASS" && (
                      <div className="banner-success">{EN.preflight.overallPass}</div>
                    )}
                    {preflight.overall === "WARNING" && (
                      <div className="banner-warn">{EN.preflight.overallWarn}</div>
                    )}
                    {preflight.overall === "FAIL" && (
                      <div className="banner-error">{EN.preflight.overallFail}</div>
                    )}

                    <div className="card-box">
                      {preflight.checks.map((item) => {
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
                      })}
                    </div>
                  </>
                )}

                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
                  {EN.preflight.honestyNotice}
                </p>

                <div className="footer-actions">
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setErrorMsg(null);
                        setWizardStep("04");
                      }}
                    >
                      {EN.preflight.back}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void runPreflightCheck()}
                      disabled={preflightLoading}
                    >
                      {EN.preflight.recheck}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleStep05Continue}
                    disabled={preflightLoading || !preflight?.can_save}
                  >
                    {EN.preflight.next}
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
                    <span>{EN.review.modeLabel}</span>
                    <strong>{mode}</strong>
                  </div>
                  {(mode === "workstation" || mode === "both") && (
                    <div className="review-row">
                      <span>{EN.review.workstationLabel}</span>
                      <strong>
                        {wsUser.trim()}@{wsHost.trim()}
                      </strong>
                    </div>
                  )}
                  {(mode === "mac" || mode === "both") && (
                    <div className="review-row">
                      <span>{EN.review.macLabel}</span>
                      <strong>
                        {macUser.trim()}@{macHost.trim()}
                      </strong>
                    </div>
                  )}
                  {mode === "device" && (
                    <>
                      <div className="review-row">
                        <span>{EN.review.deviceLabel}</span>
                        <strong>{customAlias.trim()}</strong>
                      </div>
                      <div className="review-row">
                        <span>{EN.review.userLabel}</span>
                        <strong>
                          {customUser.trim()}@{customHost.trim()}
                        </strong>
                      </div>
                    </>
                  )}
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
                    className="btn-secondary"
                    onClick={() => {
                      setErrorMsg(null);
                      setWizardStep("05");
                    }}
                  >
                    {EN.review.back}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
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
                <h2 className="pane-title">{EN.success.title}</h2>
                <p className="pane-subtitle">{EN.success.subtitle}</p>
                <div className="banner-success">
                  {primarySavedAlias} — {EN.dashboard.statusConfigured}
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                  {EN.success.verificationNote}
                </p>
                {connectResult ? (
                  <div className="banner-warn">{connectResult.message}</div>
                ) : null}
                <div className="footer-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setConnectResult(null);
                      setAppState("DASHBOARD");
                    }}
                  >
                    {EN.success.goDashboard}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void handleConnect(primarySavedAlias)}
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

  // 3. MAIN APP SHELL (DASHBOARD | DIAGNOSTICS | SETTINGS)
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
                    {EN.environment.back}
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
                        ? EN.environment.connected
                        : EN.environment.optionalUnavailable}
                    </strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.ssh}</span>
                    <strong>
                      {doctor?.checks.ssh.client_available
                        ? EN.environment.available
                        : EN.environment.missing}
                    </strong>
                  </div>
                  <div className="review-row">
                    <span>{EN.diagnostics.config}</span>
                    <strong>
                      {doctor?.checks.configuration.valid
                        ? EN.environment.available
                        : EN.environment.configFresh}
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
