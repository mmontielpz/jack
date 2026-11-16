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

export interface PreflightCheckItem {
  name: string;
  status: "PASS" | "WARNING" | "FAIL";
  detail: string;
}

export interface PreflightResult {
  overall: "PASS" | "WARNING" | "FAIL";
  can_save: boolean;
  checks: PreflightCheckItem[];
}

export interface ResetPreview {
  config_path: string;
  config_exists: boolean;
  backup_dir: string;
  preserved_items: string[];
}

export interface ResetResult {
  reset: boolean;
  backup_path?: string | null;
  affected_files: string[];
  message: string;
}

export interface TailscaleState {
  cli_installed: boolean;
  running: boolean;
  authenticated: boolean;
  backend_state: string;
  tailnet_name?: string | null;
  self_name?: string | null;
  message: string;
}

export interface NetworkReachabilityResult {
  status: "REACHABLE" | "UNREACHABLE" | "NOT_TESTED";
  detail: string;
}

export interface SshAuthTestResult {
  status: "VERIFIED" | "FAILED" | "NOT_TESTED";
  host_key_checked: boolean;
  failure_category?: "offline" | "ssh_unavailable" | "auth_rejected" | "host_key_issue" | "timeout" | "unknown" | null;
  recovery_hint?: string | null;
  detail: string;
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
      supported_note: "Linux (Arch/CachyOS and Ubuntu): supported.",
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
      root_cause: mockDevices.length > 0 ? "NONE" : "No saved configuration found.",
      recovery_plan: {
        recommended_action: mockDevices.length > 0 ? "NONE" : "Configure at least one device.",
      },
    };
  },
  async getTailscaleState(): Promise<TailscaleState> {
    if (isTauri()) return tauriInvoke<TailscaleState>("get_tailscale_state");
    return {
      cli_installed: true,
      running: true,
      authenticated: true,
      backend_state: "Running",
      tailnet_name: "example.ts.net",
      self_name: "local-host",
      message: "Tailscale is running and connected.",
    };
  },
  async checkNetworkReachability(host: string): Promise<NetworkReachabilityResult> {
    if (isTauri()) return tauriInvoke<NetworkReachabilityResult>("check_network_reachability", { host });
    return {
      status: "NOT_TESTED",
      detail: "Preview mode: network reachability was not tested.",
    };
  },
  async testSshAuthentication(user: string, host: string, consent: boolean): Promise<SshAuthTestResult> {
    if (isTauri()) {
      return tauriInvoke<SshAuthTestResult>("test_ssh_authentication", { user, host, consent });
    }
    if (!consent) throw new Error("Explicit user consent is required before testing SSH authentication.");
    return {
      status: "NOT_TESTED",
      host_key_checked: false,
      detail: "Preview mode: SSH authentication was not tested.",
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
      message: "Tailscale peers listed (discovery only; does not test SSH access).",
    };
  },
  async runPreflight(req: WizardSaveRequest): Promise<PreflightResult> {
    if (isTauri()) return tauriInvoke<PreflightResult>("run_preflight", { req });
    const checks: PreflightCheckItem[] = [
      { name: "JACK CLI", status: "PASS", detail: "jack CLI binary is available." },
      { name: "OpenSSH client", status: "PASS", detail: "ssh client is available." },
    ];
    let hasFail = false;
    let hasWarn = false;
    const validatePair = (label: string, user?: string, host?: string) => {
      if (!user || !isValidUser(user)) {
        hasFail = true;
        checks.push({ name: `${label} SSH User`, status: "FAIL", detail: "Invalid SSH username." });
      }
      if (!host || !isValidHost(host)) {
        hasFail = true;
        checks.push({ name: `${label} Host`, status: "FAIL", detail: "Invalid IPv4 address or hostname." });
      }
    };
    if (req.mode === "workstation" || req.mode === "both") {
      validatePair("Workstation", req.workstation_user, req.workstation_host);
      if (mockDevices.some((d) => d.alias === "workstation")) {
        hasWarn = true;
        checks.push({
          name: "Alias conflict",
          status: "WARNING",
          detail: "Existing 'workstation' entry will be updated.",
        });
      }
    }
    if (req.mode === "mac" || req.mode === "both") {
      validatePair("Mac", req.mac_user, req.mac_host);
      if (mockDevices.some((d) => d.alias === "mac")) {
        hasWarn = true;
        checks.push({ name: "Alias conflict", status: "WARNING", detail: "Existing 'mac' entry will be updated." });
      }
    }
    if (req.mode === "device") {
      if (!req.device_alias || !isValidAlias(req.device_alias)) {
        hasFail = true;
        checks.push({ name: "Device Alias", status: "FAIL", detail: "Invalid or reserved device alias." });
      } else if (mockDevices.some((d) => d.alias === req.device_alias)) {
        hasWarn = true;
        checks.push({
          name: "Alias conflict",
          status: "WARNING",
          detail: `Existing '${req.device_alias}' entry will be updated.`,
        });
      }
      validatePair("Device", req.device_user, req.device_host);
    }
    checks.push({
      name: "SSH Authentication",
      status: "WARNING",
      detail: "SSH authentication not tested.",
    });
    const overall = hasFail ? "FAIL" : hasWarn || checks.some((c) => c.status === "WARNING") ? "WARNING" : "PASS";
    return { overall, can_save: !hasFail, checks };
  },
  async saveWizardConfig(req: WizardSaveRequest): Promise<SaveResult> {
    if (isTauri()) return tauriInvoke<SaveResult>("save_wizard_config", { req });
    if (!req.confirmed) throw new Error("Explicit confirmation is required before saving.");
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
    return { saved: true, devices: [...mockDevices], message: "Configuration saved." };
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
      message: `Validation ready for jack connect ${alias}.`,
    };
  },
  async previewResetConfig(): Promise<ResetPreview> {
    if (isTauri()) return tauriInvoke<ResetPreview>("preview_reset_config");
    return {
      config_path: "~/.config/jack/config",
      config_exists: mockDevices.length > 0,
      backup_dir: "~/.config/jack",
      preserved_items: [
        "~/.ssh (SSH keys & config)",
        "~/.ssh/known_hosts",
        "Tailscale state & daemon",
      ],
    };
  },
  async resetJackConfig(confirmed: boolean): Promise<ResetResult> {
    if (isTauri()) return tauriInvoke<ResetResult>("reset_jack_config", { confirmed });
    if (!confirmed) throw new Error("Explicit confirmation is required to reset configuration.");
    mockDevices.splice(0, mockDevices.length);
    return {
      reset: true,
      backup_path: "~/.config/jack/config.bak.preview",
      affected_files: ["~/.config/jack/config"],
      message: "JACK configuration backed up and reset.",
    };
  },
};

const RESERVED_ALIASES = new Set([
  "workstation",
  "mac",
  "add",
  "connect",
  "devices",
  "default",
  "status",
  "doctor",
  "diagnose",
  "repair",
  "setup",
  "update",
  "install",
  "uninstall",
  "help",
  "device",
]);

export function isValidAlias(v: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v) && !RESERVED_ALIASES.has(v);
}

export function sanitizeAlias(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 32);
  if (!cleaned || RESERVED_ALIASES.has(cleaned)) {
    return "remote-device";
  }
  return cleaned;
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
