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
  status: "PASS" | "WARNING" | "FAIL" | "NOT_TESTED";
  detail: string;
  remediation?: string | null;
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
  service_running: boolean;
  signed_in: boolean;
  connected: boolean;
  status_category: "CONNECTED" | "NOT_INSTALLED" | "SERVICE_STOPPED" | "SIGNED_OUT" | "DISCONNECTED" | "UNKNOWN";
  backend_state: string;
  tailnet_name?: string | null;
  self_name?: string | null;
  os_family: string;
  install_url: string;
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

export interface PendingApprovalView {
  request_id: string;
  peer_id: string;
  peer_name: string;
  requested_scope: string;
  sas_6digit: string;
  expires_at: number;
}

export interface HostShareStatus {
  active: boolean;
  state: string;
  endpoint?: string | null;
  auth_code?: string | null;
  expires_at?: number | null;
  pending_request?: PendingApprovalView | null;
  paired_peer_id?: string | null;
  paired_peer_name?: string | null;
  error?: string | null;
}

export interface EpStatusReadResponse {
  status: string;
  os: string;
  jack_version: string;
  uptime_seconds: number;
}

export interface ClientPairingStatus {
  stage: "Idle" | "Connecting" | "VerifySas" | "WaitingApproval" | "Connected" | "Error";
  sas_6digit?: string | null;
  host_id?: string | null;
  status_read?: EpStatusReadResponse | null;
  error?: string | null;
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
      service_running: true,
      signed_in: true,
      connected: true,
      status_category: "CONNECTED",
      backend_state: "Running",
      tailnet_name: "example.ts.net",
      self_name: "local-host",
      os_family: "linux",
      install_url: "https://tailscale.com/download/linux",
      message: "Tailscale is installed, signed in, and connected.",
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
    const validatePair = (label: string, user?: string, host?: string, allowEmptyUser = false) => {
      if (!user) {
        if (allowEmptyUser) {
          checks.push({
            name: `${label} SSH User`,
            status: "NOT_TESTED",
            detail: "SSH username has not been entered yet.",
            remediation: "Enter the remote SSH username below.",
          });
        } else {
          hasFail = true;
          checks.push({ name: `${label} SSH User`, status: "FAIL", detail: "Invalid SSH username." });
        }
      } else if (!isValidUser(user)) {
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
      validatePair("Device", req.device_user, req.device_host, true);
    }
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
  async epHostListBindOptions(): Promise<string[]> {
    if (isTauri()) return tauriInvoke<string[]>("ep_host_list_bind_options");
    return ["127.0.0.1"];
  },
  async epHostStartSharing(bindIp?: string): Promise<HostShareStatus> {
    if (isTauri()) return tauriInvoke<HostShareStatus>("ep_host_start_sharing", { bindIp: bindIp ?? null });
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epHostPollStatus(): Promise<HostShareStatus> {
    if (isTauri()) return tauriInvoke<HostShareStatus>("ep_host_poll_status");
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epHostDecideApproval(requestId: string, approved: boolean): Promise<HostShareStatus> {
    if (isTauri()) return tauriInvoke<HostShareStatus>("ep_host_decide_approval", { requestId, approved });
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epHostRevokePeer(peerId: string): Promise<void> {
    if (isTauri()) return tauriInvoke<void>("ep_host_revoke_peer", { peerId });
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epHostStopSharing(): Promise<void> {
    if (isTauri()) return tauriInvoke<void>("ep_host_stop_sharing");
    return;
  },
  async epClientStartPairing(endpoint: string, authCode: string, clientName: string): Promise<ClientPairingStatus> {
    if (isTauri()) {
      return tauriInvoke<ClientPairingStatus>("ep_client_start_pairing", { endpoint, authCode, clientName });
    }
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epClientConfirmSas(confirmed: boolean): Promise<ClientPairingStatus> {
    if (isTauri()) return tauriInvoke<ClientPairingStatus>("ep_client_confirm_sas", { confirmed });
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epClientPollStatus(): Promise<ClientPairingStatus> {
    if (isTauri()) return tauriInvoke<ClientPairingStatus>("ep_client_poll_status");
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epClientReadStatus(): Promise<EpStatusReadResponse> {
    if (isTauri()) return tauriInvoke<EpStatusReadResponse>("ep_client_read_status");
    throw new Error("Easy Pairing backend requires the native JACK Desktop runtime.");
  },
  async epClientDisconnect(): Promise<void> {
    if (isTauri()) return tauriInvoke<void>("ep_client_disconnect");
    return;
  },
};

const CROCKFORD_SET = new Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ".split(""));

export function normalizeAuthCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[-\s]/g, "");
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

export function validateAuthCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[-\s]/g, "");
  if (cleaned.length === 0) return "Enter the 8-character Temporary Auth Code.";
  for (const ch of cleaned) {
    if (!CROCKFORD_SET.has(ch)) {
      return `Invalid character '${ch}' in Auth Code (letters I, L, O, U are not used).`;
    }
  }
  if (cleaned.length !== 8) {
    return "Enter all 8 characters of the Temporary Auth Code.";
  }
  return null;
}

export function isValidAuthCode(raw: string): boolean {
  return validateAuthCode(raw) === null;
}

export function isLanOrLoopbackIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255)) {
    return false;
  }
  const [a, b] = parts.map(Number);
  if (a === 0 || a >= 224) return false; // 0.0.0.0/8, multicast, broadcast
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale 100.64.0.0/10
  return false;
}

export function validateEndpoint(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter the Host Address (IP:port).";
  let host = "";
  let portStr = "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]:");
    if (end === -1) return "Enter a valid IPv6 endpoint like [::1]:45123.";
    host = trimmed.slice(1, end);
    portStr = trimmed.slice(end + 2);
    const lower = host.toLowerCase();
    const validV6 = lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
    if (!validV6) return "Only loopback or local LAN IPv6 addresses are allowed.";
  } else {
    const colon = trimmed.lastIndexOf(":");
    if (colon === -1) return "Include the port number (for example, 192.168.1.42:45123).";
    host = trimmed.slice(0, colon);
    portStr = trimmed.slice(colon + 1);
    if (!/^[0-9.]+$/.test(host) || host.split(".").length !== 4) {
      return "Enter a valid IPv4 address and port (for example, 127.0.0.1:45123).";
    }
    if (!isLanOrLoopbackIpv4(host)) {
      return "Only loopback (127.0.0.1) or private LAN addresses are allowed.";
    }
  }
  if (!/^\d+$/.test(portStr)) return "Port must be a number between 1 and 65535.";
  const port = Number(portStr);
  if (port < 1 || port > 65535) return "Port must be between 1 and 65535.";
  return null;
}

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
