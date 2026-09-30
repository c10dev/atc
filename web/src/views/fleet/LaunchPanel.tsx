import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AircraftView } from "../../../../server/fleet.ts";
import type { SessionBrief } from "./shared.ts";
import { usePanelFocus } from "./usePanelFocus.ts";

// LAUNCH: 그 AIRCRAFT의 세션을 `claude --bg`로 띄우는 패널(docs/fleet.md 8.5). 카드 바로 아래에 열린다
export function LaunchPanel({
  a,
  control,
  opener,
  onCancel,
  onLaunch,
}: {
  a: AircraftView;
  control: SessionBrief;
  opener: HTMLElement | null;
  onCancel: () => void;
  onLaunch: (input: { permissionMode: string; model: string; account?: string }) => Promise<string | null>;
}) {
  // ACCOUNT 고르개(ATC-147): 등록부가 있을 때만. 거절 사유가 있는 ACCOUNT는 고를 수 없고 사유를 보인다
  const [accounts, setAccounts] = useState<{ label: string; refused: string | null; running: number; maxLaunched: number | null }[]>([]);
  const [account, setAccount] = useState<string | null>(null); // null = 기본(home)
  useEffect(() => {
    let alive = true;
    fetch("/api/fleet/launch-accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setAccounts(d.accounts ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const homeLabel = (accounts.find((x) => x.label === a.account) ?? accounts[0])?.label ?? null; // home 라벨이 등록부에 없으면 서버도 ~/.claude로 가므로 첫 줄로 보인다
  const chosen = account ?? homeLabel;
  const chosenRefused = accounts.find((x) => x.label === chosen)?.refused ?? null;
  const [permissionMode, setPermissionMode] = useState(control.permissionModes[0] ?? "auto");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ref, close, onKeyDown } = usePanelFocus<HTMLFormElement>(opener, onCancel);
  const submitRef = useRef<HTMLButtonElement>(null);
  // 실패 사유가 붙으면 패널이 길어진다. 다시 보이게 하고, 누르는 동안 막혔던 LAUNCH로 초점을 되돌린다
  useEffect(() => {
    if (!error) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    submitRef.current?.focus({ preventScroll: true });
  }, [error, ref]);
  const launched = control.sessions.filter((x) => x.kind === "background" && !x.stale).length; // STALE은 상한에 세지 않는다(ATC-93)
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await onLaunch({ permissionMode, model: model.trim(), ...(account ? { account } : {}) });
    // 성공하면 패널이 닫힌다(언마운트). 실패일 때만 사유를 보인다
    if (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form ref={ref} className="fl-entry fl-launch fl-panel" onSubmit={submit} onKeyDown={onKeyDown} aria-label={`${a.registration} LAUNCH`}>
      <h2 className="label">
        LAUNCH <em>{a.callsign} ({a.registration}) · AIRPORT {a.base ?? "—"}</em>
      </h2>
      <p className="fl-entry-preview faint">
        그 AIRPORT 저장소에서 백그라운드 세션을 띄우고 CREW BRIEFING을 첫 지시로 넣는다. 세션은 사용량 한도를 쓴다. 지금 백그라운드 세션 {control.launched ?? launched}/
        {control.max}{control.holders ? ` — ${control.holders}` : ""}.
      </p>
      <label>
        permission mode{" "}
        <select className="fl-input" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} aria-label="permission mode">
          {control.permissionModes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        모델{" "}
        <input className="fl-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="기본값" aria-label="모델" />
      </label>
      {accounts.length > 0 && (
        <label>
          ACCOUNT{" "}
          <select className="fl-input" value={chosen ?? ""} onChange={(e) => setAccount(e.target.value === homeLabel ? null : e.target.value)} aria-label="ACCOUNT">
            {accounts.map((x) => (
              <option key={x.label} value={x.label} disabled={x.refused !== null}>
                {x.label}
                {x.label === a.account ? " (home)" : ""}
                {x.refused ? ` — ${x.refused}` : ""}
              </option>
            ))}
          </select>
          {chosenRefused && <span className="fl-error"> {chosenRefused}</span>}
        </label>
      )}
      {error && (
        <p className="fl-error fl-panel-error" role="alert">
          LAUNCH 못 함: {error}
        </p>
      )}
      <div className="fl-actions">
        <button type="button" className="fl-btn" onClick={close}>
          취소
        </button>
        <button ref={submitRef} type="submit" className="fl-btn primary" disabled={busy || Boolean(chosenRefused)}>
          {busy ? "띄우는 중…" : "LAUNCH"}
        </button>
      </div>
    </form>
  );
}
