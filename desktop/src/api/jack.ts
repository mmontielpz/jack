export interface PlatformInfo {
  os: string;
  is_wsl2: boolean;
  supported_note: string;
}

export interface DeviceEntry {
  alias: string;
  user: string;
  host: string;
  source: string;
  complete: boolean;
}

export interface TailscalePeer {
  id: string;
  name: string;
  address: string;
  os: string;
  online: boolean;
  is_windows: boolean;
}

export interface DiscoveryResult {
  available: boolean;
  backend_state: string;
  peers: TailscalePeer[];
  message: string;
}

export interface WizardSaveRequest {
  mode: "workstation" | "mac" | "both" | "device";
  workstation_user?: string;
  workstation_host?: string;
  mac_user?: string;
  mac_host?: string;
  device_alias?: string;
  device_user?: string;
  device_host?: string;
  set_default: boolean;
  confirmed: boolean;
}

export interface SaveResult {
  saved: boolean;
  devices: DeviceEntry[];
  message: StringOrEmpty;
}

type StringOrEmpty = string;

export interface ConnectResult {
  launched: boolean;
  dry_run: boolean;
  alias: string;
  target_summary: string;
  message: string;
}

export interface DoctorJson {
  overall_status: "PASS" | "WARN" | "FAIL";
  checks: {
    platform: { os: string; runtime?: string; supported: boolean };
    tailscale: { cli_available: boolean; daemon_connected: boolean; required?: boolean };
    ssh: { client_available: boolean };
    configuration: { file_exists: boolean; valid: boolean; complete_devices?: number; default_device_valid?: boolean };
  };
}

export interface DiagnoseJson {
  incident_classification: string;
  severity: string;
  root_cause: string;
  recovery_plan: { recommended_action: string };
}

export interface DeviceStatusJson {
  status: string;
  device: {
    alias: string;
    reachability: string;
    ssh: string;
  };
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const isTauri = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

// Synthetic fixture fallback used ONLY when running outside Tauri (e.g. unit tests / headless screenshot verification).
const mockDevices: DeviceEntry[] = [];

export const jackApi = {
  async getCliVersion(): Promise<string> {
    if (isTauri()) return tauriInvoke<string>("get_cli_version");
    return "jack 0.1.1 (preview)";
  },
  async getPlatformInfo(): Promise<PlatformInfo> {
    if (isTauri()) return tauriInvoke<PlatformInfo>("get_platform_info");
    return {
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux (Arch/CachyOS y Ubuntu): compatible.",
    };
  },
  async listDevices(): Promise<DeviceEntry[]> {
    if (isTauri()) return tauriInvoke<DeviceEntry[]>("list_devices");
    return [...mockDevices];
  },
  async getDeviceStatus(alias: string): Promise<DeviceStatusJson> {
    if (isTauri()) return tauriInvoke<DeviceStatusJson>("get_device_status", { alias });
    return { status: "HEALTHY", device: { alias, reachability: "reachable", ssh: "available" } };
  },
  async runDoctor(): Promise<DoctorJson> {
    if (isTauri()) return tauriInvoke<DoctorJson>("run_doctor");
    return {
      overall_status: mockDevices.length > 0 ? "PASS" : "FAIL",
      checks: {
        platform: { os: "Linux", runtime: "native", supported: true },
        tailscale: { cli_available: true, daemon_connected: true, required: false },
        ssh: { client_available: true },
        configuration: {
          file_exists: mockDevices.length > 0,
          valid: mockDevices.length > 0,
          complete_devices: mockDevices.length,
          default_device_valid: true,
        },
      },
    };
  },
  async runDiagnose(): Promise<DiagnoseJson> {
    if (isTauri()) return tauriInvoke<DiagnoseJson>("run_diagnose");
    return {
      incident_classification: mockDevices.length > 0 ? "INCIDENT_NONE" : "INCIDENT_CONFIG_MISSING",
      severity: mockDevices.length > 0 ? "INFO" : "CRITICAL",
      root_cause: mockDevices.length > 0 ? "NONE" : "Sin configuración guardada.",
      recovery_plan: { recommended_action: mockDevices.length > 0 ? "NONE" : "Configura un dispositivo." },
    };
  },
  async discoverTailscalePeers(): Promise<DiscoveryResult> {
    if (isTauri()) return tauriInvoke<DiscoveryResult>("discover_tailscale_peers");
    return {
      available: true,
      backend_state: "Running",
      peers: [
        { id: "p1", name: "vpn-gateway", address: "100.73.24.113", os: "Linux", online: true, is_windows: false },
        { id: "p2", name: "t-dev-runner", address: "100.92.220.76", os: "Linux", online: true, is_windows: false },
        { id: "p3", name: "DESKTOP-79SGUPL", address: "100.104.234.71", os: "Windows", online: true, is_windows: true },
      ],
      message: "Dispositivos de Tailscale obtenidos (solo descubrimiento; no prueba acceso SSH).",
    };
  },
  async saveWizardConfig(req: WizardSaveRequest): Promise<SaveResult> {
    if (isTauri()) return tauriInvoke<SaveResult>("save_wizard_config", { req });
    if (!req.confirmed) throw new Error("Confirmación requerida.");
    if (req.mode === "workstation" || req.mode === "both") {
      mockDevices.push({
        alias: "workstation",
        user: req.workstation_user || "",
        host: req.workstation_host || "",
        source: "legacy_workstation",
        complete: true,
      });
    }
    if (req.mode === "mac" || req.mode === "both") {
      mockDevices.push({
        alias: "mac",
        user: req.mac_user || "",
        host: req.mac_host || "",
        source: "legacy_mac",
        complete: true,
      });
    }
    if (req.mode === "device") {
      mockDevices.push({
        alias: req.device_alias || "",
        user: req.device_user || "",
        host: req.device_host || "",
        source: "device",
        complete: true,
      });
    }
    return { saved: true, devices: [...mockDevices], message: "Configuración guardada." };
  },
  async setDefaultDevice(alias: string): Promise<string> {
    if (isTauri()) return tauriInvoke<string>("set_default_device", { alias });
    return `Default device set to '${alias}'.`;
  },
  async launchConnect(alias: string): Promise<ConnectResult> {
    if (isTauri()) return tauriInvoke<ConnectResult>("launch_connect", { alias });
    return {
      launched: false,
      dry_run: true,
      alias,
      target_summary: `${alias}`,
      message: `Validación lista para jack connect ${alias}.`,
    };
  },
};

export function isValidAlias(v: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v) && !["workstation", "mac", "add", "connect", "devices", "default", "status", "doctor", "diagnose", "repair", "setup", "update", "install", "uninstall", "help", "device"].includes(v);
}

export function isValidUser(v: string): boolean {
  return v.length > 0 && v.length <= 64 && /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(v);
}

export function isValidHost(v: string): boolean {
  if (!v || v.length > 253 || v.startsWith("-")) return false;
  if (/^[0-9.]+$/.test(v)) {
    const parts = v.split(".");
    return parts.length === 4 && parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255);
  }
  return v.split(".").every((l) => l.length >= 1 && l.length <= 63 && /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(l));
}
