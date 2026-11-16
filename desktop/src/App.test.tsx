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

  it("navigates all 7 screens with confirmation and dashboard reflection", async () => {
    render(<App />);

    // Screen 01: Welcome
    fireEvent.click(screen.getByText(/Configurar dispositivos/i));

    // Screen 02: Target choice
    expect(screen.getByText(/¿Qué deseas configurar\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Siguiente/i));

    // Screen 03: Discovery
    await waitFor(() => expect(screen.getByText(/DESKTOP-79SGUPL/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Siguiente/i));

    // Screen 04: SSH User
    expect(screen.getByLabelText(/Usuario SSH/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Siguiente/i));

    // Screen 05: Review (requires explicit confirmation)
    expect(screen.getByText(/Confirma la configuración/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Guardar y configurar/i));
    expect(screen.getByRole("alert")).toHaveTextContent(/confirmación explícita/i);

    fireEvent.click(screen.getByLabelText(/Confirmo guardar/i));
    fireEvent.click(screen.getByText(/Guardar y configurar/i));

    // Screen 06: Success
    await waitFor(() => expect(screen.getByText(/¡Listo!/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Ir al panel/i));

    // Screen 07: Dashboard
    await waitFor(() => expect(screen.getByText(/Mis dispositivos/i)).toBeInTheDocument());
    expect(screen.getByText(/workstation/i)).toBeInTheDocument();
  });
});
