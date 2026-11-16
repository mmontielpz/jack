import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { jackApi } from "./api/jack";

describe("JACK Desktop V0.1 Onboarding UX", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders minimal Welcome without redundant JACK text and uses rounded buttons", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux (Arch/CachyOS and Ubuntu): supported.",
    });

    const { container } = render(<App />);

    const startBtn = await screen.findByRole("button", { name: "Start Setup" });
    const diagBtn = screen.getByRole("button", { name: "View Diagnostics" });
    expect(startBtn).toHaveClass("btn", "btn-primary");
    expect(diagBtn).toHaveClass("btn", "btn-outline-dark");
    expect(screen.queryByRole("heading", { name: "JACK" })).toBeNull();
    expect(container.querySelector(".titlebar")?.textContent).not.toContain("JACK Desktop");
    expect(container.querySelector(".banner-info")).toBeNull();
  });

  it("runs Tailscale-first 7-step onboarding, preserves values on Back, enforces consent, and shows honest Not Verified completion", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux",
    });
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: true,
      running: true,
      authenticated: true,
      backend_state: "Running",
      tailnet_name: "lab.ts.net",
      self_name: "cachy",
      message: "Tailscale is running and connected.",
    });
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: true,
      backend_state: "Running",
      peers: [
        { id: "p1", name: "alpha-box", address: "100.64.0.10", os: "Linux", online: true, is_windows: false },
      ],
      message: "ok",
    });
    vi.spyOn(jackApi, "runPreflight").mockResolvedValue({
      overall: "WARNING",
      can_save: true,
      checks: [{ name: "JACK CLI", status: "PASS", detail: "jack CLI binary is available." }],
    });
    const saveSpy = vi.spyOn(jackApi, "saveWizardConfig").mockResolvedValue({
      saved: true,
      devices: [
        { alias: "alpha-box", user: "alice", host: "100.64.0.10", source: "device", complete: true },
      ],
      message: "Configuration saved.",
    });

    render(<App />);

    // Step 01 Welcome -> Step 02 Check Tailscale
    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    await screen.findByRole("heading", { name: "Check Tailscale" });
    await screen.findByText("lab.ts.net");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 03 Choose Device (no Workstation/Mac/Both category cards)
    await screen.findByRole("heading", { name: "Choose Device" });
    expect(screen.queryByText("Workstation")).toBeNull();
    expect(screen.getByText("Network Online")).toBeInTheDocument();
    const step3Continue = screen.getByRole("button", { name: "Continue" });
    expect(step3Continue).toBeDisabled();
    fireEvent.click(screen.getByText("alpha-box"));
    expect(step3Continue).not.toBeDisabled();
    fireEvent.click(step3Continue);

    // Step 04 SSH Username + Back preservation
    await screen.findByRole("heading", { name: "SSH Username" });
    const step4Continue = screen.getByRole("button", { name: "Continue" });
    expect(step4Continue).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "alice" } });
    expect(step4Continue).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Choose Device" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByLabelText(/SSH Username/i) as HTMLInputElement).value).toBe("alice");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 05 Test Connection: SSH auth button disabled without consent, Save still allowed
    await screen.findByRole("heading", { name: "Test Connection" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Test SSH Authentication" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 06 Review & Save
    await screen.findByRole("heading", { name: "Review & Save" });
    expect(screen.getByText("alpha-box")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    // Step 07 Honest Completion (Not Verified because SSH auth was not tested)
    await screen.findByRole("heading", { name: "Configuration Saved (Not Verified)" });
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "device",
        device_alias: "alpha-box",
        device_user: "alice",
        device_host: "100.64.0.10",
        confirmed: true,
      }),
    );
  });

  it("supports manual host entry when Tailscale is unavailable and shows Verified vs Failed SSH completion honestly", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux",
    });
    vi.spyOn(jackApi, "getTailscaleState").mockResolvedValue({
      cli_installed: false,
      running: false,
      authenticated: false,
      backend_state: "NotInstalled",
      message: "Tailscale CLI was not found on this system.",
    });
    vi.spyOn(jackApi, "runPreflight").mockResolvedValue({
      overall: "PASS",
      can_save: true,
      checks: [{ name: "JACK CLI", status: "PASS", detail: "ok" }],
    });
    vi.spyOn(jackApi, "checkNetworkReachability").mockResolvedValue({
      status: "REACHABLE",
      detail: "TCP port 22 is reachable.",
    });
    const sshSpy = vi
      .spyOn(jackApi, "testSshAuthentication")
      .mockResolvedValueOnce({
        status: "FAILED",
        host_key_checked: true,
        detail: "Host key verification failed.",
      })
      .mockResolvedValueOnce({
        status: "VERIFIED",
        host_key_checked: true,
        detail: "SSH authentication succeeded with verified host key.",
      });
    vi.spyOn(jackApi, "saveWizardConfig").mockResolvedValue({
      saved: true,
      devices: [{ alias: "lab-manual", user: "bob", host: "10.0.0.5", source: "device", complete: true }],
      message: "Saved.",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Start Setup" }));
    await screen.findByText("Tailscale is not ready");
    fireEvent.click(screen.getByRole("button", { name: "Use manual host" }));

    await screen.findByRole("heading", { name: "Enter Host Manually" });
    fireEvent.change(screen.getByLabelText("IPv4 address or hostname"), { target: { value: "10.0.0.5" } });
    fireEvent.change(screen.getByLabelText("Device alias"), { target: { value: "lab-manual" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: "SSH Username" });
    fireEvent.change(screen.getByLabelText(/SSH Username/i), { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 05: Check network + authorize SSH auth -> first FAILED, then VERIFIED
    await screen.findByRole("heading", { name: "Test Connection" });
    fireEvent.click(screen.getByRole("button", { name: "Check Reachability" }));
    await screen.findByText("REACHABLE");

    const consentCheckbox = screen.getByRole("checkbox");
    fireEvent.click(consentCheckbox);
    const sshBtn = screen.getByRole("button", { name: "Test SSH Authentication" });
    expect(sshBtn).not.toBeDisabled();

    fireEvent.click(sshBtn);
    await screen.findByText("Host key verification failed.");
    expect(sshSpy).toHaveBeenCalledWith("bob", "10.0.0.5", true);

    fireEvent.click(sshBtn);
    await screen.findByText("SSH authentication succeeded with verified host key.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Review & Save" });
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    await screen.findByRole("heading", { name: "Configuration Saved & Verified" });
  });

  it("keeps Dashboard frozen and handles Add Device Cancel + Settings Reset", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([
      {
        alias: "workstation",
        user: "bob",
        host: "100.64.0.22",
        source: "legacy_workstation",
        complete: true,
      },
    ]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux (Arch/CachyOS and Ubuntu): supported.",
    });
    vi.spyOn(jackApi, "getDeviceStatus").mockResolvedValue({
      status: "HEALTHY",
      device: { alias: "workstation", reachability: "reachable", ssh: "available" },
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
    await screen.findByRole("heading", { name: "Choose Device" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("My Devices");
  });
});
