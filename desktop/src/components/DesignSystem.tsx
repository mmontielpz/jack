import React from "react";
import logoUrl from "../assets-logo.svg";
import { EN } from "../i18n/en";

export const JackMark: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <img src={logoUrl} alt="JACK" style={{ height: size, width: "auto", display: "block" }} />
);

export const TitleBar: React.FC<{ subtitle?: string; showBrandText?: boolean }> = ({
  subtitle,
  showBrandText = true,
}) => (
  <header className="titlebar">
    <div className="titlebar-brand">
      <JackMark size={20} />
      {showBrandText ? <span>{EN.appTitle}</span> : null}
    </div>
    {subtitle ? <span className="titlebar-meta">{subtitle}</span> : null}
  </header>
);

export type BadgeKind = "ready" | "configured" | "warn" | "error";

export const StatusBadge: React.FC<{ kind: BadgeKind; label: string }> = ({ kind, label }) => (
  <span className={`badge badge-${kind}`}>
    <span className="badge-dot" aria-hidden="true" />
    {label}
  </span>
);

export const OsIcon: React.FC<{ os?: string; role?: string }> = ({ os = "", role = "" }) => {
  const low = os.toLowerCase();
  if (low.includes("windows")) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="#181A1D" aria-hidden="true">
        <path d="M2 3.5L11 2.2v9H2v-7.7zm10-1.4L22 0.7v10.5H12V2.1zM2 12.2h9v9L2 19.9v-7.7zm10 0h10v10.6l-10-1.4v-9.2z" />
      </svg>
    );
  }
  if (low.includes("mac") || low.includes("darwin") || role === "mac") {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#181A1D" strokeWidth="1.8" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#181A1D" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
};

export const UserIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
);

export const GearIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const WizardSidebar: React.FC<{ activeStep: number }> = ({ activeStep }) => {
  const steps = [
    EN.moments.chooseDevice,
    EN.moments.connectVerify,
    EN.moments.ready,
  ];
  return (
    <aside className="sidebar" aria-label="Setup steps">
      {steps.map((label, idx) => {
        const num = idx + 1;
        const done = num < activeStep;
        const active = num === activeStep;
        return (
          <div key={label} className={`step-item ${active ? "active" : ""} ${done ? "done" : ""}`}>
            <span className="step-badge">{done ? "✓" : num}</span>
            <span>{label}</span>
          </div>
        );
      })}
    </aside>
  );
};
