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

describe("JACK Desktop Zero-Friction 3-Moment Onboarding", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("auto-advances on peer selection, filters many devices, and reaches Connected / Ready to Use on verified SSH", async () => {
    setupBaseMocks();
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: true,
      running: true,
      authenticated: true,
      backend_state: "Running",
      tailnet_name: "lab.ts.net",
      self_name: "cachy",
      message: "Connected",
    });
    const manyPeers = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      name: i === 15 ? "target-gamma" : `node-${i}`,
      address: `100.64.0.${10 + i}`,
      os: i % 2 === 0 ? "Linux" : "macOS",
      online: true,
      is_windows: false,
    }));
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: true,
      backend_state: "Running",
      peers: manyPeers,
      message: "ok",
    });
    vi.spyOn(jackApi, "runPreflight").mockImplementation(async (req) => ({
      overall: req.device_user ? "PASS" : "FAIL",
      can_save: Boolean(req.device_user),
      checks: [{ name: "JACK CLI", status: req.device_user ? "PASS" : "FAIL", detail: "ok" }],
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
      devices: [{ alias: "target-gamma", user: "alice", host: "100.64.0.25", source: "device", complete: true }],
      message: "Saved",
    });

    const { container } = render(<App />);

    // Welcome -> Moment 1 (no intermediate Tailscale screen when connected)
    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    await screen.findByRole("heading", { name: "Choose a Device" });
    const listEl = screen.getByRole("list", { name: "Discovered Tailscale devices" });
    expect(listEl).toHaveStyle({ maxHeight: "260px", overflowY: "auto" });

    // Filter many devices
    fireEvent.change(screen.getByLabelText("Filter devices"), { target: { value: "gamma" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    // Clicking peer immediately advances to Moment 2 (no Continue button)
    fireEvent.click(screen.getByText("target-gamma"));
    await screen.findByRole("heading", { name: /Connect & Verify: target-gamma/i });
    expect(container.querySelector(".banner-info")).toBeNull();

    // Missing username keeps buttons disabled
    const verifyBtn = screen.getByRole("button", { name: "Verify & Save" });
    const saveUnverifiedBtn = screen.getByRole("button", { name: "Save Without Verifying" });
    expect(verifyBtn).toBeDisabled();
    expect(saveUnverifiedBtn).toBeDisabled();

    // Enter username, verify consent required
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "alice" } });
    expect(saveUnverifiedBtn).not.toBeDisabled();
    expect(verifyBtn).toBeDisabled();

    // Authorize and test repeated clicks (idempotent single save)
    fireEvent.click(screen.getByRole("checkbox"));
    expect(verifyBtn).not.toBeDisabled();
    fireEvent.click(verifyBtn);
    fireEvent.click(verifyBtn);

    await screen.findByRole("heading", { name: "Connected / Ready to Use" });
    expect(sshSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("handles Tailscale unavailable, manual host, network failure, host-key/auth failure, retry, and save failure", async () => {
    setupBaseMocks();
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: false,
      running: false,
      authenticated: false,
      backend_state: "NotInstalled",
      message: "Not installed",
    });
    vi.spyOn(jackApi, "runPreflight").mockImplementation(async (req) => ({
      overall: req.device_user ? "PASS" : "FAIL",
      can_save: Boolean(req.device_user),
      checks: [{ name: "JACK CLI", status: req.device_user ? "PASS" : "FAIL", detail: "ok" }],
    }));
    vi.spyOn(jackApi, "checkNetworkReachability").mockResolvedValue({
      status: "UNREACHABLE",
      detail: "TCP port 22 did not respond.",
    });
    const sshSpy = vi
      .spyOn(jackApi, "testSshAuthentication")
      .mockResolvedValueOnce({
        status: "FAILED",
        host_key_checked: true,
        failure_category: "host_key_issue",
        recovery_hint: "Verify the host fingerprint out-of-band and update ~/.ssh/known_hosts before retrying.",
        detail: "Host key verification failed.",
      })
      .mockResolvedValueOnce({
        status: "FAILED",
        host_key_checked: true,
        failure_category: "auth_rejected",
        recovery_hint: "Ensure your public key is in ~/.ssh/authorized_keys.",
        detail: "Permission denied (publickey).",
      })
      .mockResolvedValueOnce({
        status: "VERIFIED",
        host_key_checked: true,
        detail: "SSH authentication succeeded.",
      })
      .mockResolvedValueOnce({
        status: "VERIFIED",
        host_key_checked: true,
        detail: "SSH authentication succeeded.",
      });
    const saveSpy = vi
      .spyOn(jackApi, "saveWizardConfig")
      .mockRejectedValueOnce(new Error("Disk write failed"))
      .mockResolvedValueOnce({
        saved: true,
        devices: [{ alias: "manual-box", user: "bob", host: "10.0.0.5", source: "device", complete: true }],
        message: "Saved",
      });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    await screen.findByText(/Tailscale is not connected/i);

    // Manual host entry
    fireEvent.change(screen.getByLabelText("IPv4 address or hostname"), { target: { value: "10.0.0.5" } });
    fireEvent.change(screen.getByLabelText("Device alias"), { target: { value: "manual-box" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: /Connect & Verify: 10\.0\.0\.5/i });
    await screen.findByText("UNREACHABLE");

    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("checkbox"));

    // 1st attempt: host-key failure
    fireEvent.click(screen.getByRole("button", { name: "Verify & Save" }));
    await screen.findByText(/Verify the host fingerprint out-of-band/i);

    // 2nd attempt (retry without restarting): auth failure
    fireEvent.click(screen.getByRole("button", { name: "Verify & Save" }));
    await screen.findByText(/Ensure your public key is in ~\/\.ssh\/authorized_keys/i);

    // 3rd attempt: SSH verified, save fails -> stays on Moment 2 for retry
    fireEvent.click(screen.getByRole("button", { name: "Verify & Save" }));
    await screen.findByText("Disk write failed");

    // 4th attempt: retry succeeds -> Moment 3 Connected
    fireEvent.click(screen.getByRole("button", { name: "Verify & Save" }));
    await screen.findByRole("heading", { name: "Connected / Ready to Use" });
    expect(sshSpy).toHaveBeenCalledTimes(4);
    expect(saveSpy).toHaveBeenCalledTimes(2);
  });

  it("reports Simulation / Not Tested honestly in dry-run mode and supports unverified save", async () => {
    setupBaseMocks();
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: true,
      running: true,
      authenticated: true,
      backend_state: "Running",
      message: "Connected",
    });
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: true,
      backend_state: "Running",
      peers: [{ id: "p1", name: "sim-box", address: "100.64.0.99", os: "Linux", online: true, is_windows: false }],
      message: "ok",
    });
    vi.spyOn(jackApi, "runPreflight").mockImplementation(async (req) => ({
      overall: req.device_user ? "PASS" : "FAIL",
      can_save: Boolean(req.device_user),
      checks: [{ name: "JACK CLI", status: req.device_user ? "PASS" : "FAIL", detail: "ok" }],
    }));
    vi.spyOn(jackApi, "checkNetworkReachability").mockResolvedValue({
      status: "NOT_TESTED",
      detail: "Dry-run mode active.",
    });
    vi.spyOn(jackApi, "testSshAuthentication").mockResolvedValue({
      status: "NOT_TESTED",
      host_key_checked: false,
      detail: "Dry-run mode active: SSH authentication was not tested.",
    });
    vi.spyOn(jackApi, "saveWizardConfig").mockResolvedValue({
      saved: true,
      devices: [{ alias: "sim-box", user: "carol", host: "100.64.0.99", source: "device", complete: true }],
      message: "Saved",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    fireEvent.click(await screen.findByText("sim-box"));

    await screen.findByRole("heading", { name: /Connect & Verify: sim-box/i });
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "carol" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify & Save" }));

    await screen.findByRole("heading", { name: "Simulation / Not Tested" });

    // Retry -> Save Without Verifying -> Needs Setup
    fireEvent.click(screen.getByRole("button", { name: "Retry Verification" }));
    await screen.findByRole("heading", { name: /Connect & Verify: sim-box/i });
    fireEvent.click(screen.getByRole("button", { name: "Save Without Verifying" }));
    await screen.findByRole("heading", { name: "Needs Setup" });
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
      cli_installed: true,
      running: true,
      authenticated: true,
      backend_state: "Running",
      message: "Connected",
    });
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: true,
      backend_state: "Running",
      peers: [],
      message: "ok",
    });

    render(<App />);

    await screen.findByText("My Devices");
    expect(screen.getByText("Configured")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check Status" }));
    await screen.findByText("Online");

    fireEvent.click(screen.getByRole("button", { name: /\+ Add Device/i }));
    await screen.findByRole("heading", { name: "Choose a Device" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("My Devices");
    await waitFor(() => expect(screen.getByText("Online")).toBeInTheDocument());
  });
});
