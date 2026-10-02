import { useEffect, useMemo, useState } from "react";
import { CONTROL_POLL_MS, type ControlList } from "../../server/control-view.ts";
import { controlStripOf, controlStripSummary, type StripChip, type StripState } from "../../server/control-strip.ts";
import type { Snapshot } from "../../server/model.ts";
import { allControlDown } from "../../server/control-bulk.ts";
import { controlMemo, fetchControlList } from "./controlData.ts";
import { timeAgo } from "./derive.ts";
import "./ControlStrip.css";

// 헤더 CONTROL 띠(ATC-127): 관제 세션마다 칩 하나. 계산은 server/control-strip.ts(순수), 여기는 그리기만 한다. 표시 전용 — LAUNCH·STOP은 FLEET의 CONTROL SESSIONS.
// 클릭하면 CONTROL SESSIONS 구역을 연다. 대상은 이 상수 하나(ATC-130이 구역을 FLEET 탭으로 옮겼다).
export const CONTROL_TARGET = "fleet/control";

const TAG: Record<StripState, string> = { ok: "", working: "", needs: "NEEDS", late: "LATE", down: "DOWN" };

function open() {
  if (location.hash === `#${CONTROL_TARGET}`) dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = CONTROL_TARGET;
}

// `MCC ● 5m · 2분 전`. 색만으로 알리지 않게 needs·late·down은 글자도 붙는다
function Chip({ chip, now }: { chip: StripChip; now: number }) {
  const ago = chip.lastTickAt ? timeAgo(chip.lastTickAt, now) : null;
  return (
    <button type="button" className={`cs-chip cs-${chip.state}`} title={chip.title} aria-label={`${chip.name} ${chip.state}\n${chip.title}`} onClick={open}>
      <b>{chip.code}</b>
      <i className="cs-dot" aria-hidden="true" />
      {chip.state === "down" ? (
        <span className="cs-tag">DOWN</span>
      ) : (
        <>
          {chip.intervalMin !== null && <span>{chip.intervalMin}m</span>}
          {ago && chip.intervalMin !== null && <span className="cs-sep">·</span>}
          {ago && <span>{ago}</span>}
          {TAG[chip.state] && <span className="cs-tag">{TAG[chip.state]}</span>}
        </>
      )}
    </button>
  );
}

export function ControlStrip({ snapshot, now }: { snapshot: Snapshot | null; now: number }) {
  const [list, setList] = useState<ControlList | null>(controlMemo.list);
  // 처음과 60초마다(숨겨진 탭은 건너뛴다). FLEET의 CONTROL SESSIONS와 같은 값·같은 60초 규칙(controlData.ts)
  useEffect(() => {
    let live = true;
    const go = () => void fetchControlList().then((l) => live && l && setList(l));
    go();
    const t = setInterval(() => {
      if (!document.hidden) go();
    }, CONTROL_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const chips = useMemo(() => controlStripOf(list?.sessions, snapshot?.sessions, now), [list, snapshot, now]);
  // 아직 못 읽었거나 옛 서버라 응답이 없으면 그리지 않는다
  if (chips.length === 0) return null;
  const sum = controlStripSummary(chips);
  return (
    <div className="control-strip" role="group" aria-label="CONTROL 세션">
      <span className="cs-label">CONTROL</span>
      <div className="cs-chips">
        {chips.map((c) => (
          <Chip key={c.name} chip={c} now={now} />
        ))}
      </div>
      {allControlDown(list?.sessions) && (
        <button type="button" className="cs-recovery" onClick={open}>
          모두 내려감 · LAUNCH ALL
        </button>
      )}
      <button type="button" className={`cs-fold cs-tone-${sum.tone}`} title={chips.map((c) => `${c.code} ${c.state}`).join(" · ")} onClick={open}>
        <b>CTRL</b>
        <i className="cs-dot" aria-hidden="true" />
        <span>
          {sum.ok}/{sum.total}
        </span>
        {sum.tone !== "ok" && <span className="cs-tag">{sum.tone === "down" ? "DOWN" : "CHECK"}</span>}
      </button>
    </div>
  );
}
