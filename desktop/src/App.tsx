import React, { useEffect, useState } from "react";
import {
  DeviceEntry,
  DiagnoseJson,
  DiscoveryResult,
  DoctorJson,
  PlatformInfo,
  TailscalePeer,
  jackApi,
  isValidAlias,
  isValidHost,
  isValidUser,
} from "./api/jack";
import {
  GearIcon,
  JackMark,
  OsIcon,
  StatusBadge,
  TitleBar,
  UserIcon,
  WizardSidebar,
} from "./components/DesignSystem";
import { ES } from "./i18n/es";

type Screen =
  | "welcome"
  | "target-choice"
  | "discovery"
  | "ssh-user"
  | "review"
  | "success"
  | "dashboard"
  | "diagnostics"
  | "settings";

type TargetMode = "workstation" | "mac" | "both" | "device";

function initialScreenFromQuery(): Screen {
  if (typeof window === "undefined") return "welcome";
  const p = new URLSearchParams(window.location.search).get("screen");
  switch (p) {
    case "01": return "welcome";
    case "02": return "target-choice";
    case "03": return "discovery";
    case "04": return "ssh-user";
    case "05": return "review";
    case "06": return "success";
    case "07": return "dashboard";
    default: return "welcome";
  }
}

export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>(initialScreenFromQuery);
  const [mode, setMode] = useState<TargetMode>("both");
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [defaultAlias, setDefaultAlias] = useState<string>("");
  const [cliVersion, setCliVersion] = useState<string>("");
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);

  // Discovery & target state
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [manualMode, setManualMode] = useState<boolean>(false);
  const [selectedWsPeer, setSelectedWsPeer] = useState<TailscalePeer | null>(null);
  const [selectedMacPeer, setSelectedMacPeer] = useState<TailscalePeer | null>(null);
  const [wsHost, setWsHost] = useState<string>("DESKTOP-79SGUPL");
  const [wsUser, setWsUser] = useState<string>("mike");
  const [macHost, setMacHost] = useState<string>("");
  const [macUser, setMacUser] = useState<string>("");
  const [devAlias, setDevAlias] = useState<string>("");
  const [devHost, setDevHost] = useState<string>("");
  const [devUser, setDevUser] = useState<string>("");
  const [setAsDefault, setSetAsDefault] = useState<boolean>(true);
  const [confirmedSave, setConfirmedSave] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [infoMsg, setInfoMsg] = useState<string>("");

  // Diagnostics & status state
  const [doctor, setDoctor] = useState<DoctorJson | null>(null);
  const [diagnose, setDiagnose] = useState<DiagnoseJson | null>(null);
  const [diagLoading, setDiagLoading] = useState<boolean>(false);
  const [statusByAlias, setStatusByAlias] = useState<Record<string, { label: string; kind: "ready" | "configured" | "warn" | "error" }>>({});

  const refreshDevices = async () => {
    try {
      const list = await jackApi.listDevices();
      setDevices(list);
      return list;
    } catch {
      setDevices([]);
      return [];
    }
  };

  useEffect(() => {
    jackApi.getCliVersion().then(setCliVersion).catch(() => {});
    jackApi.getPlatformInfo().then(setPlatformInfo).catch(() => {});
    refreshDevices().then((list) => {
      const hasQuery = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("screen");
      if (!hasQuery && list.length > 0) {
        setScreen("dashboard");
      }
    });
  }, []);

  const triggerDiscovery = async () => {
    setDiscovering(true);
    setErrorMsg("");
    try {
      const res = await jackApi.discoverTailscalePeers();
      setDiscovery(res);
      if (!res.available && res.peers.length === 0) {
        setManualMode(true);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setDiscovering(false);
    }
  };

  const openDiagnostics = async () => {
    setScreen("diagnostics");
    setDiagLoading(true);
    setErrorMsg("");
    try {
      const [doc, diag] = await Promise.all([jackApi.runDoctor(), jackApi.runDiagnose()]);
      setDoctor(doc);
      setDiagnose(diag);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setDiagLoading(false);
    }
  };

  const handleSelectPeer = (peer: TailscalePeer) => {
    if (mode === "mac") {
      setSelectedMacPeer(peer);
      setMacHost(peer.address);
    } else if (mode === "device") {
      setSelectedWsPeer(peer);
      setDevHost(peer.address);
    } else {
      setSelectedWsPeer(peer);
      setWsHost(peer.address);
    }
    setManualMode(false);
  };

  const validateDiscoveryStep = (): boolean => {
    setErrorMsg("");
    if (mode === "workstation" || mode === "both") {
      if (!isValidHost(wsHost.trim())) {
        setErrorMsg("Ingresa una dirección IPv4 o hostname válido para la estación de trabajo.");
        return false;
      }
    }
    if (mode === "mac" || mode === "both") {
      if (mode === "mac" && !isValidHost(macHost.trim())) {
        setErrorMsg("Ingresa una dirección IPv4 o hostname válido para Mac.");
        return false;
      }
      if (mode === "both" && macHost.trim() && !isValidHost(macHost.trim())) {
        setErrorMsg("La dirección de Mac no es válida.");
        return false;
      }
    }
    if (mode === "device") {
      if (!isValidAlias(devAlias.trim())) {
        setErrorMsg("El alias debe tener 1-32 minúsculas, dígitos, '-' o '_' (no reservado).");
        return false;
      }
      if (!isValidHost(devHost.trim())) {
        setErrorMsg("Ingresa una dirección IPv4 o hostname válido para el dispositivo.");
        return false;
      }
    }
    return true;
  };

  const validateUserStep = (): boolean => {
    setErrorMsg("");
    if ((mode === "workstation" || mode === "both") && !isValidUser(wsUser.trim())) {
      setErrorMsg("Usuario SSH inválido para Estación de trabajo.");
      return false;
    }
    if ((mode === "mac" || (mode === "both" && macHost.trim())) && !isValidUser(macUser.trim())) {
      setErrorMsg("Usuario SSH inválido para Mac.");
      return false;
    }
    if (mode === "device" && !isValidUser(devUser.trim())) {
      setErrorMsg("Usuario SSH inválido para el dispositivo.");
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!confirmedSave) {
      setErrorMsg("Marca la casilla de confirmación explícita para guardar.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      const effectiveMode: TargetMode = mode === "both" && !macHost.trim() ? "workstation" : mode;
      const res = await jackApi.saveWizardConfig({
        mode: effectiveMode,
        workstation_user: wsUser.trim() || undefined,
        workstation_host: wsHost.trim() || undefined,
        mac_user: macUser.trim() || undefined,
        mac_host: macHost.trim() || undefined,
        device_alias: devAlias.trim() || undefined,
        device_user: devUser.trim() || undefined,
        device_host: devHost.trim() || undefined,
        set_default: setAsDefault,
        confirmed: true,
      });
      setDevices(res.devices);
      if (setAsDefault) {
        setDefaultAlias(effectiveMode === "device" ? devAlias.trim() : effectiveMode === "mac" ? "mac" : "workstation");
      }
      setScreen("success");
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async (alias: string) => {
    setErrorMsg("");
    setInfoMsg("");
    try {
      const res = await jackApi.launchConnect(alias);
      setInfoMsg(res.message);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleCheckStatus = async (alias: string) => {
    setErrorMsg("");
    try {
      const st = await jackApi.getDeviceStatus(alias);
      const reach = st.device?.reachability;
      const sshOk = st.device?.ssh === "available";
      if (st.status === "HEALTHY" && sshOk) {
        setStatusByAlias((prev) => ({ ...prev, [alias]: { label: ES.dashboard.statusReady, kind: "ready" } }));
      } else if (reach === "reachable" || reach === "direct_ssh") {
        setStatusByAlias((prev) => ({ ...prev, [alias]: { label: ES.dashboard.statusWarn, kind: "warn" } }));
      } else {
        setStatusByAlias((prev) => ({ ...prev, [alias]: { label: ES.dashboard.statusError, kind: "error" } }));
      }
    } catch (e) {
      setStatusByAlias((prev) => ({ ...prev, [alias]: { label: ES.dashboard.statusError, kind: "error" } }));
      setErrorMsg(String(e));
    }
  };

  if (screen === "welcome") {
    return (
      <div className="app-shell">
        <TitleBar subtitle={cliVersion} />
        <main className="welcome-screen">
          <div style={{ marginBottom: 18 }}>
            <JackMark size={92} />
          </div>
          <p className="welcome-subtitle">{ES.welcome.subtitle}</p>
          <div className="welcome-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setErrorMsg("");
                setScreen("target-choice");
              }}
            >
              ▶ {ES.welcome.configureCta}
            </button>
            <button
              type="button"
              className="btn btn-outline-dark"
              onClick={openDiagnostics}
            >
              {ES.welcome.diagnosticsCta}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (screen === "target-choice") {
    const cards: { id: TargetMode; label: string; sub: string; role: string }[] = [
      { id: "workstation", label: ES.targetChoice.workstation, sub: ES.targetChoice.workstationSub, role: "workstation" },
      { id: "both", label: ES.targetChoice.both, sub: ES.targetChoice.bothSub, role: "both" },
      { id: "mac", label: ES.targetChoice.mac, sub: ES.targetChoice.macSub, role: "mac" },
      { id: "device", label: ES.targetChoice.custom, sub: ES.targetChoice.customSub, role: "device" },
    ];
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="split-layout">
          <WizardSidebar activeStep={1} />
          <main className="main-pane">
            <h1 className="pane-title">{ES.targetChoice.title}</h1>
            <p className="pane-subtitle">{ES.targetChoice.subtitle}</p>
            <div className="choice-grid" role="radiogroup" aria-label={ES.targetChoice.title}>
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === c.id}
                  className={`choice-card ${mode === c.id ? "selected" : ""}`}
                  onClick={() => setMode(c.id)}
                >
                  <OsIcon role={c.role} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{c.label}</div>
                    <div style={{ fontSize: 13, color: "#6B7280" }}>{c.sub}</div>
                  </div>
                  <span className="radio-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="banner banner-info">{ES.targetChoice.platformNote}</div>
            <div className="footer-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setScreen(devices.length > 0 ? "dashboard" : "welcome")}
              >
                {ES.targetChoice.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setScreen("discovery");
                  if (!discovery) triggerDiscovery();
                }}
              >
                {ES.targetChoice.next} →
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (screen === "discovery") {
    const title =
      mode === "mac"
        ? ES.discovery.titleMac
        : mode === "device"
          ? ES.discovery.titleDevice
          : ES.discovery.titleWorkstation;
    const peers = discovery?.peers ?? [];
    const activePeer = mode === "mac" ? selectedMacPeer : selectedWsPeer;
    const showWinWarning =
      Boolean(activePeer?.is_windows) ||
      wsHost.toUpperCase().includes("DESKTOP");

    return (
      <div className="app-shell">
        <TitleBar />
        <div className="split-layout">
          <WizardSidebar activeStep={2} />
          <main className="main-pane">
            <h1 className="pane-title">{title}</h1>
            <p className="pane-subtitle">{ES.discovery.subtitle}</p>
            {errorMsg ? <div className="banner banner-error" role="alert">{errorMsg}</div> : null}
            {discovering ? <div className="banner banner-info">{ES.discovery.loading}</div> : null}
            {discovery && !discovering && peers.length === 0 ? (
              <div className="banner banner-warn">{discovery.message || ES.discovery.empty}</div>
            ) : null}
            {showWinWarning ? <div className="banner banner-warn">{ES.discovery.windowsWarning}</div> : null}

            <div className="peer-list" role="radiogroup" aria-label="Pares detectados">
              {peers.map((p) => {
                const isSelected = activePeer?.id === p.id && !manualMode;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`peer-row ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelectPeer(p)}
                  >
                    <div className="peer-left">
                      <OsIcon os={p.os} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                        <div style={{ fontSize: 13, color: "#6B7280" }}>
                          {p.os} · {p.address} · {p.online ? "Detectado en tailnet" : "Desconectado"}
                        </div>
                      </div>
                    </div>
                    <span className="radio-dot" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            {mode === "device" ? (
              <div className="field-group">
                <label className="field-label" htmlFor="alias-input">{ES.discovery.manualAliasLabel}</label>
                <input
                  id="alias-input"
                  className="text-input"
                  value={devAlias}
                  onChange={(e) => setDevAlias(e.target.value)}
                  placeholder="win-lab"
                />
              </div>
            ) : null}

            {manualMode || peers.length === 0 || mode === "both" ? (
              <div className="card-box">
                {mode === "workstation" || mode === "both" ? (
                  <div className="field-group">
                    <label className="field-label" htmlFor="ws-host-input">
                      {ES.discovery.manualHostLabel} (Estación de trabajo)
                    </label>
                    <input
                      id="ws-host-input"
                      className="text-input"
                      value={wsHost}
                      onChange={(e) => setWsHost(e.target.value)}
                      placeholder="100.64.0.10 o servidor.example.ts.net"
                    />
                  </div>
                ) : null}
                {mode === "mac" || mode === "both" ? (
                  <div className="field-group" style={{ marginBottom: 0 }}>
                    <label className="field-label" htmlFor="mac-host-input">
                      {ES.discovery.manualHostLabel} (Mac{mode === "both" ? ", opcional" : ""})
                    </label>
                    <input
                      id="mac-host-input"
                      className="text-input"
                      value={macHost}
                      onChange={(e) => setMacHost(e.target.value)}
                      placeholder="mac.example.ts.net"
                    />
                  </div>
                ) : null}
                {mode === "device" ? (
                  <div className="field-group" style={{ marginBottom: 0 }}>
                    <label className="field-label" htmlFor="dev-host-input">{ES.discovery.manualHostLabel}</label>
                    <input
                      id="dev-host-input"
                      className="text-input"
                      value={devHost}
                      onChange={(e) => setDevHost(e.target.value)}
                      placeholder="192.168.1.50"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={triggerDiscovery} disabled={discovering}>
                ↻ {ES.discovery.refresh}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setManualMode((m) => !m)}>
                {ES.discovery.manualToggle}
              </button>
            </div>

            <div className="footer-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setScreen("target-choice")}>
                ← {ES.discovery.back}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (validateDiscoveryStep()) setScreen("ssh-user");
                }}
              >
                {ES.discovery.next} →
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (screen === "ssh-user") {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="split-layout">
          <WizardSidebar activeStep={3} />
          <main className="main-pane">
            <h1 className="pane-title">{ES.sshUser.title}</h1>
            <p className="pane-subtitle">{ES.sshUser.subtitle}</p>
            {errorMsg ? <div className="banner banner-error" role="alert">{errorMsg}</div> : null}

            {mode === "workstation" || mode === "both" ? (
              <div className="field-group">
                <label className="field-label" htmlFor="ws-user-input">{ES.sshUser.workstationLabel}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <UserIcon />
                  <input
                    id="ws-user-input"
                    className="text-input"
                    value={wsUser}
                    onChange={(e) => setWsUser(e.target.value)}
                    placeholder="mike"
                  />
                </div>
              </div>
            ) : null}

            {mode === "mac" || (mode === "both" && macHost.trim()) ? (
              <div className="field-group">
                <label className="field-label" htmlFor="mac-user-input">{ES.sshUser.macLabel}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <UserIcon />
                  <input
                    id="mac-user-input"
                    className="text-input"
                    value={macUser}
                    onChange={(e) => setMacUser(e.target.value)}
                    placeholder="alex"
                  />
                </div>
              </div>
            ) : null}

            {mode === "device" ? (
              <div className="field-group">
                <label className="field-label" htmlFor="dev-user-input">{ES.sshUser.deviceLabel}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <UserIcon />
                  <input
                    id="dev-user-input"
                    className="text-input"
                    value={devUser}
                    onChange={(e) => setDevUser(e.target.value)}
                    placeholder="alex"
                  />
                </div>
              </div>
            ) : null}

            <div className="banner banner-info">{ES.sshUser.securityNote}</div>

            <div className="footer-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setScreen("discovery")}>
                ← {ES.sshUser.back}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (validateUserStep()) setScreen("review");
                }}
              >
                {ES.sshUser.next} →
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (screen === "review") {
    const primaryHost = mode === "mac" ? macHost : mode === "device" ? devHost : wsHost;
    const primaryUser = mode === "mac" ? macUser : mode === "device" ? devUser : wsUser;
    const modeLabel =
      mode === "both"
        ? "Ambos (Estación y Mac)"
        : mode === "mac"
          ? "Mac"
          : mode === "device"
            ? `Dispositivo (${devAlias})`
            : "Estación de trabajo";

    return (
      <div className="app-shell">
        <TitleBar />
        <div className="split-layout">
          <WizardSidebar activeStep={4} />
          <main className="main-pane">
            <h1 className="pane-title">{ES.review.title}</h1>
            <p className="pane-subtitle">{ES.review.subtitle}</p>
            {errorMsg ? <div className="banner banner-error" role="alert">{errorMsg}</div> : null}

            <div className="card-box">
              <div className="review-row">
                <OsIcon role={mode === "mac" ? "mac" : "workstation"} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {mode === "mac" ? ES.review.macLabel : mode === "device" ? ES.review.deviceLabel : ES.review.workstationLabel}
                  </div>
                  <div style={{ color: "#6B7280", fontSize: 14 }}>{primaryHost}</div>
                </div>
              </div>
              <div className="review-row">
                <UserIcon />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{ES.review.userLabel}</div>
                  <div style={{ color: "#6B7280", fontSize: 14 }}>{primaryUser}</div>
                </div>
              </div>
              <div className="review-row">
                <GearIcon />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{ES.review.modeLabel}</div>
                  <div style={{ color: "#6B7280", fontSize: 14 }}>{modeLabel}</div>
                </div>
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 10 }}>
              <input type="checkbox" checked={setAsDefault} onChange={(e) => setSetAsDefault(e.target.checked)} />
              <span>{ES.review.setDefaultLabel}</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              <input type="checkbox" checked={confirmedSave} onChange={(e) => setConfirmedSave(e.target.checked)} />
              <span>Confirmo guardar estos cambios en la configuración de JACK.</span>
            </label>

            <div className="banner banner-info">{ES.review.overwriteNotice}</div>

            <div className="footer-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setScreen("ssh-user")}>
                ← {ES.review.back}
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? ES.review.saving : `${ES.review.save} ✓`}
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (screen === "success") {
    const primaryAlias = mode === "device" ? devAlias.trim() : mode === "mac" ? "mac" : "workstation";
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="split-layout">
          <WizardSidebar activeStep={5} />
          <main className="main-pane" style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "999px",
                background: "#DCFCE7",
                color: "#16A34A",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
                fontWeight: 800,
                marginBottom: 16,
              }}
            >
              ✓
            </div>
            <h1 className="pane-title">{ES.success.title}</h1>
            <p className="pane-subtitle" style={{ marginBottom: 14 }}>{ES.success.subtitle}</p>
            <div className="banner banner-info" style={{ maxWidth: 420 }}>{ES.success.verificationNote}</div>
            {infoMsg ? <div className="banner banner-success">{infoMsg}</div> : null}
            {errorMsg ? <div className="banner banner-error">{errorMsg}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 260, marginTop: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => handleConnect(primaryAlias)}>
                ▶ {ES.success.connectNow}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  refreshDevices();
                  setScreen("dashboard");
                }}
              >
                {ES.success.goDashboard}
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar subtitle={cliVersion} />
      <div className="split-layout">
        <aside className="sidebar" aria-label="Navegación principal">
          <button
            type="button"
            className={`nav-btn ${screen === "dashboard" ? "active" : ""}`}
            onClick={() => {
              refreshDevices();
              setScreen("dashboard");
            }}
          >
            ⌂ {ES.nav.devices}
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={() => {
              setMode("device");
              setConfirmedSave(false);
              setErrorMsg("");
              setScreen("discovery");
              if (!discovery) triggerDiscovery();
            }}
          >
            + {ES.nav.addDevice}
          </button>
          <button
            type="button"
            className={`nav-btn ${screen === "diagnostics" ? "active" : ""}`}
            onClick={openDiagnostics}
          >
            ∿ {ES.nav.diagnostics}
          </button>
          <button
            type="button"
            className={`nav-btn ${screen === "settings" ? "active" : ""}`}
            onClick={() => setScreen("settings")}
          >
            ⚙ {ES.nav.settings}
          </button>
        </aside>

        <main className="main-pane">
          {errorMsg ? <div className="banner banner-error" role="alert">{errorMsg}</div> : null}
          {infoMsg ? <div className="banner banner-success">{infoMsg}</div> : null}

          {screen === "dashboard" ? (
            <>
              <h1 className="pane-title">{ES.dashboard.title}</h1>
              <p className="pane-subtitle">
                {platformInfo?.supported_note || "Estado basado en tu configuración local de JACK."}
              </p>
              {devices.length === 0 ? (
                <div className="card-box">
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{ES.dashboard.emptyTitle}</div>
                  <p style={{ color: "#6B7280", fontSize: 14, margin: "0 0 14px" }}>{ES.dashboard.emptyBody}</p>
                  <button type="button" className="btn btn-primary" onClick={() => setScreen("target-choice")}>
                    {ES.dashboard.emptyCta}
                  </button>
                </div>
              ) : (
                devices.map((d) => {
                  const st = statusByAlias[d.alias] ?? {
                    label: d.complete ? ES.dashboard.statusConfigured : ES.dashboard.statusWarn,
                    kind: d.complete ? "configured" : "warn",
                  };
                  return (
                    <div key={d.alias} className="device-card">
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <OsIcon role={d.alias} />
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 16 }}>{d.alias}</span>
                            {defaultAlias === d.alias ? <StatusBadge kind="ready" label="Predeterminado" /> : null}
                          </div>
                          <div style={{ margin: "4px 0" }}>
                            <StatusBadge kind={st.kind} label={st.label} />
                          </div>
                          <div style={{ fontSize: 13, color: "#6B7280" }}>
                            {d.host || "?"} · {d.user || "?"}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleCheckStatus(d.alias)}
                          title={ES.dashboard.checkStatus}
                        >
                          {ES.dashboard.checkStatus}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!d.complete}
                          onClick={() => handleConnect(d.alias)}
                        >
                          {ES.dashboard.connect}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          ) : null}

          {screen === "diagnostics" ? (
            <>
              <h1 className="pane-title">{ES.diagnostics.title}</h1>
              <p className="pane-subtitle">{ES.diagnostics.subtitle}</p>
              {diagLoading ? <div className="banner banner-info">Ejecutando diagnóstico...</div> : null}
              {doctor ? (
                <div className="card-box">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <strong>Estado general (jack doctor)</strong>
                    <StatusBadge
                      kind={doctor.overall_status === "PASS" ? "ready" : doctor.overall_status === "WARN" ? "warn" : "error"}
                      label={doctor.overall_status}
                    />
                  </div>
                  <div className="review-row">
                    <span>Plataforma: {doctor.checks.platform.os} ({doctor.checks.platform.runtime || "native"}) — {doctor.checks.platform.supported ? "Compatible" : "No compatible"}</span>
                  </div>
                  <div className="review-row">
                    <span>Cliente SSH: {doctor.checks.ssh.client_available ? "Disponible" : "Faltante"}</span>
                  </div>
                  <div className="review-row">
                    <span>Tailscale CLI: {doctor.checks.tailscale.cli_available ? (doctor.checks.tailscale.daemon_connected ? "Conectado" : "Instalado (desconectado)") : "No instalado"}</span>
                  </div>
                  <div className="review-row">
                    <span>Configuración: {doctor.checks.configuration.valid ? "Válida" : "Faltante o inválida"}</span>
                  </div>
                </div>
              ) : null}
              {diagnose ? (
                <div className="card-box">
                  <div><strong>Incidente:</strong> {diagnose.incident_classification} ({diagnose.severity})</div>
                  <div style={{ color: "#6B7280", fontSize: 14, marginTop: 4 }}>Causa: {diagnose.root_cause}</div>
                  <div style={{ color: "#6B7280", fontSize: 14, marginTop: 4 }}>Acción recomendada: {diagnose.recovery_plan.recommended_action}</div>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn btn-primary" onClick={openDiagnostics}>
                  {ES.diagnostics.refresh}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setScreen(devices.length > 0 ? "dashboard" : "welcome")}>
                  {ES.diagnostics.back}
                </button>
              </div>
            </>
          ) : null}

          {screen === "settings" ? (
            <>
              <h1 className="pane-title">{ES.settings.title}</h1>
              <p className="pane-subtitle">{ES.settings.subtitle}</p>
              <div className="card-box">
                <div><strong>CLI:</strong> {cliVersion || "jack"}</div>
                <div style={{ marginTop: 6 }}><strong>Plataforma:</strong> {platformInfo?.supported_note || "Linux"}</div>
              </div>
              <div className="card-box">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{ES.settings.retentionTitle}</div>
                <p style={{ margin: 0, fontSize: 14, color: "#6B7280" }}>{ES.settings.retentionBody}</p>
              </div>
              <div>
                <button type="button" className="btn btn-secondary" onClick={() => setScreen("target-choice")}>
                  {ES.settings.rerunWizard}
                </button>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default App;
