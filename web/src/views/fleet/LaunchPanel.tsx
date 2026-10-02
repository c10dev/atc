import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { AircraftView } from "../../../../server/fleet.ts";
import { type LaunchModelSetting, launchModelOf } from "../../../../server/launch-model.ts";
import type { SessionBrief } from "./shared.ts";
import { Lights } from "../../kit/Loading.tsx";

// LAUNCH(docs/fleet.md 8.5, ATC-310): 카드의 LAUNCH는 한 번 눌러 기본값으로 띄운다. 옵션은 카드 안의 ▾에서 열린다.
// 기본값은 서버가 정하는 것과 같다: permission mode는 첫 번째(auto), 모델은 LAUNCH MODEL, ACCOUNT는 LAUNCH ACCOUNT(없으면 home)

export interface LaunchAccountRow {
  label: string;
  refused: string | null;
  running: number;
  maxLaunched: number | null;
}
export interface LaunchInfo {
  accounts: LaunchAccountRow[];
  launchAccount: string | null; // LAUNCH ACCOUNT(ATC-239): AIRCRAFT용 설정. 서버가 등록부에 있는 것만 준다
}
export type LaunchInput = { permissionMode: string; model: string; account?: string; flight?: string }; // flight(ATC-73): 첫 프롬프트에 CREW BRIEFING에 이어 그 FLIGHT의 DIRECT 지시서

// 이름 없는 LAUNCH가 쓸 값(서버와 같은 순서). caption은 버튼 옆 흐린 글, refused는 그 ACCOUNT가 거절된 사유
export function launchDefaultsOf(a: AircraftView, info: LaunchInfo | null, control: SessionBrief | null, launchModel?: LaunchModelSetting) {
  const accounts = info?.accounts ?? [];
  const homeLabel = (accounts.find((x) => x.label === a.account) ?? accounts[0])?.label ?? null; // home 라벨이 등록부에 없으면 서버도 ~/.claude로 가므로 첫 줄로 보인다
  const account = info?.launchAccount ?? homeLabel;
  const refused = accounts.find((x) => x.label === account)?.refused ?? null;
  const model = launchModelOf({ registration: a.registration, airport: a.base ?? null, setting: launchModel }).model;
  const permissionMode = control?.permissionModes[0] ?? "auto";
  const caption = [account, model, permissionMode].filter(Boolean).join(" · ");
  const cap = control ? `백그라운드 세션 ${control.launched ?? control.sessions.filter((x) => x.kind === "background" && !x.stale).length}/${control.max}${control.holders ? ` — ${control.holders}` : ""}` : "";
  return { account, refused, model, permissionMode, caption, cap };
}

// ▾로 여는 옵션 블록: 카드 머리 아래 가로로 꽉 차게, 중립 면. 같은 세 칸(permission mode, 모델, ACCOUNT)과 "이 옵션으로 LAUNCH"
export function LaunchOptions({
  a,
  control,
  info,
  launchModel,
  busy,
  onLaunch,
  onClose,
}: {
  a: AircraftView;
  control: SessionBrief;
  info: LaunchInfo | null;
  launchModel?: LaunchModelSetting;
  busy: boolean;
  onLaunch: (input: LaunchInput) => void;
  onClose: () => void; // Esc나 ▾로 닫는다. 초점은 ▾로 돌아간다(부르는 쪽)
}) {
  const accounts = info?.accounts ?? [];
  const d = launchDefaultsOf(a, info, control, launchModel);
  const [account, setAccount] = useState<string | null>(null); // null = 기본
  const chosen = account ?? d.account;
  const chosenRefused = accounts.find((x) => x.label === chosen)?.refused ?? null;
  const [permissionMode, setPermissionMode] = useState(d.permissionMode);
  const [model, setModel] = useState("");
  const [flight, setFlight] = useState("");
  const flightOk = !flight.trim() || /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(flight.trim());
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("select, input")?.focus({ preventScroll: true });
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onLaunch({ permissionMode, model: model.trim(), ...(account ? { account } : {}), ...(flight.trim() ? { flight: flight.trim().toUpperCase() } : {}) });
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onClose();
  };
  return (
    <form ref={ref} className="fl-launch-opts" onSubmit={submit} onKeyDown={key} aria-label={`${a.registration} LAUNCH 옵션`}>
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
        <input className="fl-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={d.model ? `${d.model} (LAUNCH MODEL)` : "폴더 기본"} aria-label="모델" />
      </label>
      {accounts.length > 0 && (
        <label>
          ACCOUNT{" "}
          <select className="fl-input" value={chosen ?? ""} onChange={(e) => setAccount(e.target.value === d.account ? null : e.target.value)} aria-label="ACCOUNT">
            {accounts.map((x) => (
              <option key={x.label} value={x.label} disabled={x.refused !== null}>
                {x.label}
                {x.label === a.account ? " (home)" : ""}
                {x.label === info?.launchAccount ? " (LAUNCH ACCOUNT)" : ""}
                {x.refused ? ` — ${x.refused}` : ""}
              </option>
            ))}
          </select>
          {chosenRefused && <span className="fl-error"> {chosenRefused}</span>}
        </label>
      )}
      <label>
        FLIGHT{" "}
        <input className="fl-input mono" value={flight} onChange={(e) => setFlight(e.target.value)} placeholder="선택 — 예: ATC-73" aria-label="FLIGHT" aria-invalid={!flightOk} />
        <span className="faint fl-hint">적으면 첫 프롬프트가 CREW BRIEFING에 이어 그 FLIGHT의 DIRECT 지시서다</span>
        {!flightOk && <span className="fl-error"> 이슈 키(예: ATC-73)</span>}
      </label>
      {d.cap && <p className="fl-launch-note faint">{d.cap}</p>}
      <div className="fl-actions">
        <button type="submit" className="fl-btn primary" disabled={busy || Boolean(chosenRefused) || !flightOk}>
          {busy ? (
            <>
              <Lights />
              띄우는 중…
            </>
          ) : "이 옵션으로 LAUNCH"}
        </button>
      </div>
    </form>
  );
}
