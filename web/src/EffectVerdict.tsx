import { useCallback, useEffect, useState } from "react";
import type { EffectVerdict } from "../../server/effect-check.ts";
import { apiGet, apiSend } from "./api.ts";
import { timeAgo } from "./derive.ts";
import "./EffectVerdict.css";

// EFFECT CHECK(ATC-402): 배포한 FLIGHT가 작업 지시서 `## Measure`에 적은 것을 바꿨는지의 평결. FLIGHT 서랍에 한 줄, not improved·worse는 HOME에도.
// 평결이 없으면(None·절 없음·창이 아직 안 지남) 아무것도 그리지 않는다. 틀렸다고 표시하는 것이 오작동 카운터다.
export interface EffectView {
  on: boolean;
  verdicts: EffectVerdict[];
  misfire: { verdicts: number; wrong: number; share: number | null };
  open: string[];
}

export function useEffects(flight: string | null, refreshKey: string) {
  const [view, setView] = useState<EffectView | null>(null);
  const load = useCallback(() => {
    apiGet(`/api/effect${flight ? `?flight=${encodeURIComponent(flight)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setView(d && Array.isArray(d.verdicts) ? d : null))
      .catch(() => setView(null));
  }, [flight]);
  useEffect(load, [load, refreshKey]);
  return { view, reload: load, set: setView };
}

const LABEL: Record<EffectVerdict["verdict"], string> = { improved: "improved", "not improved": "NOT IMPROVED", worse: "WORSE", "too little data": "too little data" };
export const effectBad = (v: Pick<EffectVerdict, "verdict">) => v.verdict === "not improved" || v.verdict === "worse";

async function mark(flight: string, wrong: boolean): Promise<EffectView | string> {
  try {
    const res = await apiSend("POST", "/api/effect/mark", { flight, wrong });
    const body = await res.json().catch(() => ({}));
    return res.ok ? (body as EffectView) : String(body.error ?? `HTTP ${res.status}`);
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

export function EffectRow({ v, now, onView }: { v: EffectVerdict; now: number; onView: (view: EffectView) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setErr(null);
    const r = await mark(v.flight, !v.wrong);
    setBusy(false);
    if (typeof r === "string") setErr(r);
    else onView(r);
  };
  return (
    <div className="ef-row">
      <span className={`ef-verdict mono${effectBad(v) && !v.wrong ? " is-bad" : ""}`}>{LABEL[v.verdict]}</span>
      <span className="ef-what mono">
        {v.metric} {v.direction} {v.windowDays}d · {v.before} → {v.after}
      </span>
      <span className="ef-why faint">
        {v.reason}
        {v.wrong ? " · 틀렸다고 표시함" : ""} · <time dateTime={v.at}>{timeAgo(v.at, now)}</time>
      </span>
      <button type="button" className="ef-btn" disabled={busy} onClick={() => void toggle()} aria-pressed={v.wrong} title="이 평결이 틀렸다고 표시하면 오작동 카운터에 센다. 한 번 더 누르면 거둔다">
        {v.wrong ? "틀림 취소" : "틀림"}
      </button>
      {err && (
        <span className="ef-err" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}

// FLIGHT 서랍: 이 FLIGHT의 평결 한 줄(없으면 아무것도 없다)
export function FlightEffect({ k, now }: { k: string; now: number }) {
  const { view, set } = useEffects(k, "");
  const v = view?.verdicts[0];
  if (!v) return null;
  return (
    <>
      <h3 className="dr-h">EFFECT CHECK</h3>
      <EffectRow v={v} now={now} onView={set} />
    </>
  );
}
