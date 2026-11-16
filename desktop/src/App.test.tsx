import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { isValidAlias, isValidHost, isValidUser } from "./api/jack";

describe("JACK Desktop V0.1 validation & 7-screen wizard", () => {
  it("rejects shell injection and invalid inputs", () => {
    expect(isValidAlias("win-lab")).toBe(true);
    expect(isValidAlias("workstation")).toBe(false);
    expect(isValidAlias("bad;rm")).toBe(false);

    expect(isValidUser("mike")).toBe(true);
    expect(isValidUser("-oProxyCommand=id")).toBe(false);

    expect(isValidHost("100.64.0.10")).toBe(true);
    expect(isValidHost("999.0.0.1")).toBe(false);
    expect(isValidHost("host$(id)")).toBe(false);
  });

  it("starts with empty fields for first-time users and renders both targets on Review", async () => {
    render(<App />);

    // Screen 01: Welcome
    fireEvent.click(screen.getByText(/Configurar dispositivos/i));

    // Screen 02: Target choice (default: both)
    expect(screen.getByText(/¿Qué deseas configurar\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Siguiente/i));

    // Screen 03: Discovery - fields start empty (no demo defaults)
    await waitFor(() => expect(screen.getByText(/DESKTOP-79SGUPL/i)).toBeInTheDocument());
    const wsInput = screen.getByLabelText(/Dirección IPv4 o hostname \(Estación de trabajo\)/i) as HTMLInputElement;
    const macInput = screen.getByLabelText(/Dirección IPv4 o hostname \(Mac/i) as HTMLInputElement;
    expect(wsInput.value).toBe("");
    expect(macInput.value).toBe("");

    // Negative: advancing with empty host fails validation
    fireEvent.click(screen.getByText(/Siguiente/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/válido/i);

    // Fill both targets
    fireEvent.change(wsInput, { target: { value: "100.64.0.10" } });
    fireEvent.change(macInput, { target: { value: "mac.example.ts.net" } });
    fireEvent.click(screen.getByText(/Siguiente/i));

    // Screen 04: SSH User - fields start empty
    const wsUserInput = screen.getByLabelText(/Usuario SSH \(Estación de trabajo\)/i) as HTMLInputElement;
    const macUserInput = screen.getByLabelText(/Usuario SSH \(Mac\)/i) as HTMLInputElement;
    expect(wsUserInput.value).toBe("");
    expect(macUserInput.value).toBe("");

    // Negative: invalid username rejected
    fireEvent.change(wsUserInput, { target: { value: "-baduser" } });
    fireEvent.click(screen.getByText(/Siguiente/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/inválido/i);

    fireEvent.change(wsUserInput, { target: { value: "alex" } });
    fireEvent.change(macUserInput, { target: { value: "sam" } });
    fireEvent.click(screen.getByText(/Siguiente/i));

    // Screen 05: Review shows BOTH Workstation and Mac
    expect(screen.getByText(/Confirma la configuración/i)).toBeInTheDocument();
    expect(screen.getByText("100.64.0.10")).toBeInTheDocument();
    expect(screen.getByText("alex")).toBeInTheDocument();
    expect(screen.getByText("mac.example.ts.net")).toBeInTheDocument();
    expect(screen.getByText("sam")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Guardar y configurar/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/confirmación explícita/i);

    fireEvent.click(screen.getByLabelText(/Confirmo guardar/i));
    fireEvent.click(screen.getByText(/Guardar y configurar/i));

    // Screen 06: Success
    await waitFor(() => expect(screen.getByText(/¡Listo!/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Ir al panel/i));

    // Screen 07: Dashboard
    await waitFor(() => expect(screen.getByText(/Mis dispositivos/i)).toBeInTheDocument());
    expect(screen.getByText("workstation")).toBeInTheDocument();
    expect(screen.getByText("mac")).toBeInTheDocument();
  });
});
