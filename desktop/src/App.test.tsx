import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { jackApi } from "./api/jack";

describe("JACK Desktop V0.1", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders English-only Welcome onboarding when no devices are configured", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux (Arch/CachyOS and Ubuntu): supported.",
    });

    const { container } = render(<App />);

    await screen.findByText("Start Setup");
    expect(screen.getByText("View Diagnostics")).toBeInTheDocument();
    expect(container.querySelector(".banner-info")).toBeNull();
    expect(container.textContent).not.toMatch(/Configurar|Diagnóstico|Estación de trabajo|Atrás/);
  });

  it("completes 7-step guided onboarding, preserves values on Back, and enforces preflight + honesty", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux (Arch/CachyOS and Ubuntu): supported.",
    });
    vi.spyOn(jackApi, "runDoctor").mockResolvedValue({
      overall_status: "FAIL",
      checks: {
        platform: { os: "Linux", runtime: "native", supported: true },
        tailscale: { cli_available: true, daemon_connected: true, required: false },
        ssh: { client_available: true },
        configuration: { file_exists: false, valid: false },
      },
    });
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: true,
      backend_state: "Running",
      peers: [
        { id: "p1", name: "alpha-box", address: "100.64.0.10", os: "Linux", online: true, is_windows: false },
      ],
      message: "ok",
    });
    const preflightSpy = vi.spyOn(jackApi, "runPreflight").mockResolvedValue({
      overall: "WARNING",
      can_save: true,
      checks: [
        { name: "JACK CLI", status: "PASS", detail: "jack CLI binary is available." },
        { name: "SSH Authentication", status: "WARNING", detail: "SSH authentication not tested." },
      ],
    });
    const saveSpy = vi.spyOn(jackApi, "saveWizardConfig").mockResolvedValue({
      saved: true,
      devices: [
        {
          alias: "workstation",
          user: "alice",
          host: "100.64.0.10",
          source: "legacy_workstation",
          complete: true,
        },
      ],
      message: "Configuration saved.",
    });

    const { container } = render(<App />);

    // Step 01 Welcome
    fireEvent.click(await screen.findByText("Start Setup"));

    // Step 02 Environment Check
    await screen.findByText("Environment Check");
    expect(container.querySelector(".banner-info")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 03 Choose Device — Continue disabled until host chosen
    await screen.findByText("Choose Device Setup");
    const step3Continue = screen.getByRole("button", { name: "Continue" });
    expect(step3Continue).toBeDisabled();
    fireEvent.click(screen.getByText("alpha-box"));
    expect(step3Continue).not.toBeDisabled();
    fireEvent.click(step3Continue);

    // Step 04 SSH User — Continue disabled until valid user entered
    await screen.findByRole("heading", { name: "SSH User" });
    const step4Continue = screen.getByRole("button", { name: "Continue" });
    expect(step4Continue).toBeDisabled();
    const userInput = screen.getByLabelText(/SSH User \(Workstation\)/i) as HTMLInputElement;
    fireEvent.change(userInput, { target: { value: "alice" } });
    expect(step4Continue).not.toBeDisabled();

    // Navigate Back -> Continue and confirm value preserved
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Choose Device Setup" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "SSH User" });
    expect((screen.getByLabelText(/SSH User \(Workstation\)/i) as HTMLInputElement).value).toBe("alice");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 05 Preflight Check
    await screen.findByText("Preflight Check");
    await waitFor(() => expect(preflightSpy).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/SSH authentication not tested\./i).length).toBeGreaterThan(0);
    expect(container.querySelector(".banner-info")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Step 06 Review & Save
    await screen.findByText("Review & Save");
    expect(screen.getByText("alice@100.64.0.10")).toBeInTheDocument();
    expect(container.querySelector(".banner-info")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    // Step 07 Success
    await screen.findByText("Setup Complete");
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "workstation",
        workstation_user: "alice",
        workstation_host: "100.64.0.10",
        confirmed: true,
      }),
    );

    // Go to Dashboard and verify truthful initial status ("Configured", not "Ready")
    fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }));
    await screen.findByText("My Devices");
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("blocks preflight Continue when preflight returns FAIL", async () => {
    vi.spyOn(jackApi, "listDevices").mockResolvedValue([]);
    vi.spyOn(jackApi, "getCliVersion").mockResolvedValue("jack 0.1.1");
    vi.spyOn(jackApi, "getPlatformInfo").mockResolvedValue({
      os: "linux",
      is_wsl2: false,
      supported_note: "Linux",
    });
    vi.spyOn(jackApi, "runDoctor").mockResolvedValue({
      overall_status: "PASS",
      checks: {
        platform: { os: "Linux", supported: true },
        tailscale: { cli_available: true, daemon_connected: false },
        ssh: { client_available: true },
        configuration: { file_exists: false, valid: false },
      },
    });
    vi.spyOn(jackApi, "discoverTailscalePeers").mockResolvedValue({
      available: false,
      backend_state: "Stopped",
      peers: [],
      message: "none",
    });
    vi.spyOn(jackApi, "runPreflight").mockResolvedValue({
      overall: "FAIL",
      can_save: false,
      checks: [{ name: "JACK CLI", status: "FAIL", detail: "jack CLI binary not found." }],
    });

    window.history.replaceState({}, "", "/?step=05");
    render(<App />);

    await screen.findByText("Preflight Check");
    await screen.findByText("jack CLI binary not found.");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("renders Dashboard for existing config, supports Add Device Cancel, and handles Settings Reset", async () => {
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
    vi.spyOn(jackApi, "previewResetConfig").mockResolvedValue({
      config_path: "/tmp/iso/.config/jack/config",
      config_exists: true,
      backup_dir: "/tmp/iso/.config/jack",
      preserved_items: ["~/.ssh (SSH keys & config)", "~/.ssh/known_hosts", "Tailscale state & daemon"],
    });
    const resetSpy = vi.spyOn(jackApi, "resetJackConfig").mockResolvedValue({
      reset: true,
      backup_path: "/tmp/iso/.config/jack/config.bak.123",
      affected_files: ["/tmp/iso/.config/jack/config"],
      message: "JACK configuration backed up and reset.",
    });

    render(<App />);

    await screen.findByText("My Devices");
    expect(screen.getByText("Configured")).toBeInTheDocument();

    // Check Status updates to Online
    fireEvent.click(screen.getByRole("button", { name: "Check Status" }));
    await screen.findByText("Online");

    // Add Device -> Cancel returns to Dashboard
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Device/i }));
    await screen.findByText("Choose Device Setup");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("My Devices");

    // Settings -> Reset preview -> Cancel -> Confirm -> Welcome
    fireEvent.click(screen.getByRole("button", { name: /Settings/i }));
    await screen.findByText("Reset JACK Configuration");
    fireEvent.click(screen.getByRole("button", { name: "Reset Configuration" }));
    await screen.findByText("Confirm Configuration Reset");
    fireEvent.click(screen.getByRole("button", { name: "Back Up & Reset" }));

    await screen.findByText("Start Setup");
    expect(resetSpy).toHaveBeenCalledWith(true);
  });
});
