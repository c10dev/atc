import { type FormEvent, useState } from "react";
import type { FleetBrief } from "./shared.ts";
import "./EntryForm.css";

// ENTRY INTO SERVICE: 새 AIRCRAFT를 등록번호·CONFIGURATION·AIRPORT로 들인다
export function EntryForm({ brief, onEnter }: { brief: FleetBrief; onEnter: (input: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [registration, setRegistration] = useState(brief.nextRegistration ?? "");
  const [configuration, setConfiguration] = useState("general");
  const [base, setBase] = useState(brief.defaultBase ?? brief.airports[0] ?? "");
  const cfg = brief.configurations.find((c) => c.id === configuration);

  if (!open) {
    return (
      <div className="fl-entry-toggle">
        <button className="btn is-primary" onClick={() => (setRegistration(brief.nextRegistration ?? ""), setOpen(true))}>
          ENTRY INTO SERVICE — 새 AIRCRAFT 들이기
        </button>
      </div>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onEnter({ registration: registration.trim(), configuration, base: base || null })) setOpen(false);
  };
  return (
    <form className="fl-entry" onSubmit={submit}>
      <h2 className="label">ENTRY INTO SERVICE</h2>
      <label>
        등록번호{" "}
        <input
          className="fl-input fl-reg"
          value={registration}
          onChange={(e) => setRegistration(e.target.value.toUpperCase())}
          aria-label="등록번호"
          required
        />
      </label>
      <label>
        CONFIGURATION{" "}
        <select className="fl-input" value={configuration} onChange={(e) => setConfiguration(e.target.value)} aria-label="CONFIGURATION">
          {brief.configurations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        AIRPORT{" "}
        <select className="fl-input" value={base} onChange={(e) => setBase(e.target.value)} aria-label="AIRPORT">
          {brief.airports.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {cfg && (
        <p className="fl-entry-preview faint">
          CREW {cfg.complement.map((m) => `${m.position}(${m.agent})`).join(", ")} · TYPE RATING {cfg.ratings.join(", ")}
        </p>
      )}
      <div className="fl-actions">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          취소
        </button>
        <button type="submit" className="btn is-primary">
          들이기
        </button>
      </div>
    </form>
  );
}
