import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { jackApi } from "./api/jack";

function setupBaseMocks() {
  vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
  vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
  vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
    os: "linux",
    is_wsl2: false,
    supported_note: "Linux",
  });
}

describe("JACK Desktop 4-Stage Tailscale-Aware Onboarding", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("auto-advances healthy Tailscale to Choose Device, filters 20 devices without repeated warnings, and runs Verify Connection -> Save & Continue", async () => {
    setupBaseMocks();
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: true,
      running: true,
      authenticated: true,
      service_running: true,
      signed_in: true,
      connected: true,
      status_category: "CONNECTED",
      backend_state: "Running",
      tailnet_name: "lab.ts.net",
      self_name: "cachy",
      os_family: "linux",
      install_url: "https://tailscale.com/download/linux",
      message: "Connected",
    });
    const manyPeers = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      name: i === 12 ? "win-lab" : `node-${i}`,
      address: `100.64.0.${10 + i}`,
      os: i === 12 ? "Windows" : "Linux",
      online: true,
      is_windows: i === 12,
    }));
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: true,
      backend_state: "Running",
      peers: manyPeers,
      message: "ok",
    });
    vi.spyOn(jackApi, "runPreflight").mockImplementation(async (req) => ({
      overall: "PASS",
      can_save: true,
      checks: [
        {
          name: "SSH username",
          status: req.device_user ? "PASS" : "NOT_TESTED",
          detail: req.device_user ? "Valid" : "Not entered",
          remediation: req.device_user ? null : "Enter username below.",
        },
        { name: "JACK CLI", status: "PASS", detail: "Available", remediation: null },
      ],
    }));
    vi.spyOn(jackApi, "checkNetworkReachability").mockResolvedValue({
      status: "REACHABLE",
      detail: "TCP port 22 reachable.",
    });
    const sshSpy = vi.spyOn(jackApi, "testSshAuthentication").mockResolvedValue({
      status: "VERIFIED",
      host_key_checked: true,
      detail: "SSH authentication succeeded.",
    });
    const saveSpy = vi.spyOn(jackApi, "saveWizardConfig").mockResolvedValue({
      saved: true,
      devices: [{ alias: "win-lab", user: "alice", host: "100.64.0.22", source: "device", complete: true }],
      message: "Saved",
    });

    render(<App />);

    // Welcome -> Stage 1 Check Tailscale -> auto-advances to Stage 2 Choose Device
    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    await screen.findByText(/Tailscale is connected\. Continuing/i);
    await screen.findByRole("heading", { name: "Choose Device" }, { timeout: 2500 });

    // No repeated Windows warning in peer list; responsive list height
    expect(screen.queryByText(/OpenSSH Server must be enabled/i)).toBeNull();
    const listEl = screen.getByRole("list", { name: "Discovered Tailscale devices" });
    expect(listEl).toHaveStyle({ maxHeight: "calc(100vh - 290px)" });

    // Filter and select Windows peer -> auto-advances to Stage 3
    fireEvent.change(screen.getByLabelText("Filter devices"), { target: { value: "win-lab" } });
    fireEvent.click(screen.getByText("win-lab"));
    await screen.findByRole("heading", { name: /Connect & Verify: win-lab/i });
    expect(screen.getByText(/Windows target selected: OpenSSH Server/i)).toBeInTheDocument();

    // Primary action is Verify Connection (Save & Continue not shown yet)
    const verifyBtn = screen.getByRole("button", { name: "Verify Connection" });
    expect(verifyBtn).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save & Continue" })).toBeNull();

    // Enter username -> check human-readable consent (no raw SSH flags)
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "alice" } });
    expect(screen.queryByText(/BatchMode/i)).toBeNull();
    expect(verifyBtn).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(verifyBtn).not.toBeDisabled();

    // Changing username resets consent
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "alice2" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("checkbox"));

    // Verify Connection -> transitions primary CTA to Save & Continue (does not auto-save)
    fireEvent.click(screen.getByRole("button", { name: "Verify Connection" }));
    const saveContinueBtn = await screen.findByRole("button", { name: "Save & Continue" });
    expect(sshSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();

    // Repeated clicks on Save & Continue only save once
    fireEvent.click(saveContinueBtn);
    fireEvent.click(saveContinueBtn);
    await screen.findByRole("heading", { name: "Connected / Ready to Use" });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("handles Tailscale missing, signed out, service stopped, unknown, and Manual SSH path", async () => {
    setupBaseMocks();
    vi.spyOn(jackApi, "getTailscaleState")
      .mockResolvedValueOnce({
        cli_installed: false,
        running: false,
        authenticated: false,
        service_running: false,
        signed_in: false,
        connected: false,
        status_category: "NOT_INSTALLED",
        backend_state: "NotInstalled",
        os_family: "linux",
        install_url: "https://tailscale.com/download/linux",
        message: "Not installed",
      })
      .mockResolvedValueOnce({
        cli_installed: true,
        running: true,
        authenticated: false,
        service_running: true,
        signed_in: false,
        connected: false,
        status_category: "SIGNED_OUT",
        backend_state: "NeedsLogin",
        os_family: "linux",
        install_url: "https://tailscale.com/download/linux",
        message: "Signed out",
      })
      .mockResolvedValueOnce({
        cli_installed: true,
        running: false,
        authenticated: false,
        service_running: false,
        signed_in: false,
        connected: false,
        status_category: "SERVICE_STOPPED",
        backend_state: "ServiceStopped",
        os_family: "linux",
        install_url: "https://tailscale.com/download/linux",
        message: "Service stopped",
      })
      .mockResolvedValueOnce({
        cli_installed: true,
        running: false,
        authenticated: false,
        service_running: false,
        signed_in: false,
        connected: false,
        status_category: "UNKNOWN",
        backend_state: "Unknown",
        os_family: "linux",
        install_url: "https://tailscale.com/download/linux",
        message: "Unknown state",
      });

    render(<App />);

    // 1. Not installed -> official link
    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    await screen.findByText("Tailscale is not installed");
    expect(screen.getByRole("link", { name: "Download Tailscale for your OS" })).toHaveAttribute(
      "href",
      "https://tailscale.com/download/linux",
    );

    // 2. Signed out
    fireEvent.click(screen.getByRole("button", { name: "Retry Check" }));
    await screen.findByText("Sign in to Tailscale");

    // 3. Service stopped
    fireEvent.click(screen.getByRole("button", { name: "Retry Check" }));
    await screen.findByText("Tailscale service is stopped");

    // 4. Unknown -> never reports Connected
    fireEvent.click(screen.getByRole("button", { name: "Retry Check" }));
    await screen.findByText("Tailscale is not connected");
    expect(screen.queryByText("Connected")).toBeNull();

    // 5. Manual SSH path
    fireEvent.click(screen.getByRole("button", { name: "Use Manual SSH Instead" }));
    await screen.findByRole("heading", { name: "Manual SSH Target" });
  });

  it("displays actionable preflight FAIL remediation, handles host-key failure, save failure, and dry-run", async () => {
    setupBaseMocks();
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: false,
      running: false,
      authenticated: false,
      service_running: false,
      signed_in: false,
      connected: false,
      status_category: "NOT_INSTALLED",
      backend_state: "NotInstalled",
      os_family: "linux",
      install_url: "https://tailscale.com/download/linux",
      message: "Not installed",
    });
    const preflightSpy = vi
      .spyOn(jackApi, "runPreflight")
      .mockResolvedValueOnce({
        overall: "FAIL",
        can_save: false,
        checks: [
          {
            name: "OpenSSH client",
            status: "FAIL",
            detail: "OpenSSH client (`ssh`) was not found in PATH.",
            remediation: "Install OpenSSH client.",
          },
        ],
      })
      .mockResolvedValue({
        overall: "PASS",
        can_save: true,
        checks: [{ name: "OpenSSH client", status: "PASS", detail: "Available", remediation: null }],
      });
    vi.spyOn(jackApi, "checkNetworkReachability").mockResolvedValue({
      status: "NOT_TESTED",
      detail: "Dry-run mode active.",
    });
    vi.spyOn(jackApi, "testSshAuthentication")
      .mockResolvedValueOnce({
        status: "FAILED",
        host_key_checked: true,
        failure_category: "host_key_issue",
        recovery_hint: "Verify host fingerprint out-of-band before retrying.",
        detail: "Host key verification failed.",
      })
      .mockResolvedValueOnce({
        status: "NOT_TESTED",
        host_key_checked: false,
        detail: "Dry-run mode active: SSH authentication was not tested.",
      });
    vi.spyOn(jackApi, "saveWizardConfig")
      .mockRejectedValueOnce(new Error("Disk write failed"))
      .mockResolvedValueOnce({
        saved: true,
        devices: [{ alias: "manual-box", user: "bob", host: "10.0.0.5", source: "device", complete: true }],
        message: "Saved",
      });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Manual SSH Instead" }));
    fireEvent.change(screen.getByLabelText("IPv4 address or hostname"), { target: { value: "10.0.0.5" } });
    fireEvent.change(screen.getByLabelText("Device alias"), { target: { value: "manual-box" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Actionable preflight FAIL shown with remediation
    await screen.findByText("Install OpenSSH client.");
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "bob" } });
    await waitFor(() => expect(preflightSpy).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("checkbox"));

    // Host-key failure -> Retry Verification
    fireEvent.click(screen.getByRole("button", { name: "Verify Connection" }));
    await screen.findByText("Verify host fingerprint out-of-band before retrying.");

    // Dry-run NOT_TESTED -> Save & Continue -> Save failure -> Retry -> Simulation / Not Tested
    fireEvent.click(screen.getByRole("button", { name: "Retry Verification" }));
    await screen.findByText(/Dry-run mode is active/i);
    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    await screen.findByText("Disk write failed");
    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    await screen.findByRole("heading", { name: "Simulation / Not Tested" });
  });

  it("keeps Dashboard frozen and handles Add Device cancellation", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([
      { alias: "workstation", user: "bob", host: "100.64.0.22", source: "legacy_workstation", complete: true },
    ]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux",
    });
    vi.spyOn(jackApi, "getDeviceStatus").mockResolvedValue({
      status: "HEALTHY",
      device: { alias: "workstation", reachability: "reachable", ssh: "available" },
    });
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: false,
      running: false,
      authenticated: false,
      service_running: false,
      signed_in: false,
      connected: false,
      status_category: "NOT_INSTALLED",
      backend_state: "NotInstalled",
      os_family: "linux",
      install_url: "https://tailscale.com/download/linux",
      message: "Not installed",
    });

    render(<App />);

    await screen.findByText("My Devices");
    expect(screen.getByText("Configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check Status" }));
    await screen.findByText("Online");

    fireEvent.click(screen.getByRole("button", { name: /\+ Add Device/i }));
    await screen.findByRole("heading", { name: "Check Tailscale" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("My Devices");
  });
});
