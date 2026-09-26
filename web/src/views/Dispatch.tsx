import { useCallback, useEffect, useState } from "react";
import type { DispatchConfig, Plan } from "../../../server/dispatch.ts";
import type { Proposal } from "../../../server/proposals.ts";
import { flightNumber } from "../aviation.ts";
import { timeAgo } from "../derive.ts";
import { PriorityMark } from "../ui.tsx";
import "./Dispatch.css";

// 2단계 DISPATCH. shadow(2a): 제안은 화면에만 보이고 아무에게도 보내지 않는다.
// approval(2b): SUPERVISOR가 승인하면 OCC 세션(DISPATCH)이 FLIGHT PLAN을 CAPTAIN에게 보낸다.

interface FlightInfo {
  title: string;
  state: string;
  priority: number;
  project: string | null;
  url: string | null;
  cls?: string; // "BUILD · M · SEC" (docs/fleet.md 4장)
  clsDefault?: boolean; // 라벨이 없어 기본값으로 본 분류
  tails?: string[]; // TAIL ASSIGNMENT
}

// CROSSCHECK: 다른 모델(CROSSCHECK 세션)이 열린 제안에 남긴 임시 판정. 사람 판정을 대신하지 않는다.
interface Crosscheck {
  by: string;
  verdict: "agree" | "disagree";
  reason: string;
  at: string;
}
// 서버 타입에 아직 없을 수 있어 따로 읽는다(옛 서버면 null)
const markOf = (p: Proposal): Crosscheck | null => (p as unknown as { crosscheck?: Crosscheck | null }).crosscheck ?? null;

interface Brief {
  mode: DispatchConfig["mode"];
  at: string;
  plan: Plan;
  open: Proposal[];
  held: Proposal[];
  inFlight: Proposal[];
  overdue: string[];
  recent: Proposal[];
  flights: Record<string, FlightInfo>;
  gate: {
    decided: number;
    agreed: number;
    agreement: number | null;
    target: { decided: number; agreement: number };
    ready: boolean;
    crosscheck?: { marked: number; matched: number; rate: number | null }; // 참고용, 게이트 기준 아님
  };
  gate3: {
    dispatched: number;
    readBack: number;
    departed: number;
    declined: number;
    readbackRate: number | null;
    readbackMedianMin: number | null;
    departedRate: number | null;
    target: { dispatched: number; readback: number; departed: number };
    ready: boolean;
  };
  config: DispatchConfig;
}

// 거절 사유 칩. 고른 라벨 뒤에 선택 메모를 붙여 "라벨 — 메모"로 기록한다.
const REJECT_REASONS = [
  "상위 이슈 — 하위 이슈를 묶는 컨테이너",
  "본문에 선행 작업이 있음(blocks 아님)",
  "사람 결정·외부 입력 대기",
  "이미 다른 세션이 진행 중",
  "우선순위 낮음",
  "AIRBORNE — 지금은 슬롯 없음",
  "다른 팀이 더 적합",
  "이미 완료됨 — Linear 이슈만 열려 있음",
];

const statusText: Record<Proposal["status"], string> = {
  proposed: "PROPOSED",
  agreed: "승인했을 것",
  disagreed: "거절했을 것",
  approved: "APPROVED",
  rejected: "REJECTED",
  sent: "SENT · READBACK 대기",
  accepted: "READBACK",
  declined: "DECLINED",
  departed: "DEPARTED",
  superseded: "SUPERSEDED",
  expired: "EXPIRED",
};

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function Dispatch({ refreshKey, now }: { refreshKey: string; now: number }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ p: Proposal; resolve: (reason: string | null) => void } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dispatch/brief");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBrief(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // 거절 사유 칩. [취소]면 null(거절하지 않음), [거절 기록]이면 사유 문자열(비어 있으면 사유 없이 거절).
  // 창이 닫히거나 사유가 정해지는 순간 resolve되므로 verdict가 그대로 이어서 기록할 수 있다.
  const askReason = (p: Proposal) =>
    new Promise<string | null>((resolve) => setRejecting({ p, resolve }));

  const answerReason = (raw: { p: Proposal; resolve: (reason: string | null) => void } | null, value: string | null) => {
    setRejecting(null);
    raw?.resolve(value);
  };

  // shadow: 그림자 판정(verdict), approval: 실제 승인·거절
  const verdict = async (p: Proposal, v: "agree" | "disagree") => {
    let reason: string | null = null;
    if (v === "disagree") {
      reason = await askReason(p);
      if (reason === null) return;
    }
    await submit(p, v, reason);
  };

  // CROSSCHECK 판정을 그대로 기록한다. disagree면 CROSSCHECK 사유를 거절 사유로 쓴다.
  const acceptCrosscheck = (p: Proposal, m: Crosscheck) => submit(p, m.verdict, m.verdict === "disagree" ? m.reason : null);

  const submit = async (p: Proposal, v: "agree" | "disagree", reason: string | null) => {
    if (v === "agree" && brief?.mode === "approval" && p.kind === "ASSIGN" && !confirm(`${p.id}를 승인하면 DISPATCH가 ${p.aircraftName}에게 FLIGHT PLAN을 보냅니다. 승인할까요?`)) return;
    const payload = { reason };
    try {
      if (brief?.mode === "approval") await post(`/api/dispatch/proposals/${p.id}/${v === "agree" ? "approve" : "reject"}`, payload);
      else await post(`/api/dispatch/proposals/${p.id}/verdict`, { verdict: v, reason });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // SUPERVISOR가 HOLD를 푼다: 제안은 닫히고 FLIGHT는 다음 계획에서 다시 후보가 된다
  const unhold = async (p: Proposal) => {
    if (!confirm(`${p.id}의 HOLD를 풀까요? 제안은 닫히고 ${flightNumber(p.flight)}는 다음 계획에서 다시 후보가 됩니다.`)) return;
    try {
      await post(`/api/dispatch/proposals/${p.id}/unhold`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const switchMode = async () => {
    if (!brief) return;
    const next = brief.mode === "shadow" ? "approval" : "shadow";
    const text =
      next === "approval"
        ? `2b(승인 운용)를 켤까요?\n\n켜면 승인한 제안이 OCC 세션을 거쳐 CAPTAIN(팀 세션)에게 FLIGHT PLAN으로 나갑니다.\n2b 진입 점검: 판정 ${brief.gate.decided}/${brief.gate.target.decided}건, 합의율 ${pct(brief.gate.agreement)} (기준 ${brief.gate.target.agreement * 100}%) — ${brief.gate.ready ? "충족" : "아직 미달"}\n팀 세션의 CLAUDE.md에 [DISPATCH D-xxxx] READBACK 규칙이 있는지도 확인하세요.`
        : "2a(그림자 운용)로 돌아갈까요? 이미 보낸 FLIGHT PLAN은 그대로 두고, 새로 보내지는 않습니다.";
    if (!confirm(text)) return;
    try {
      await post("/api/dispatch/mode", { mode: next });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!brief) return <p className="empty">{error ? `불러오지 못함: ${error}` : "불러오는 중…"}</p>;
  const { plan, gate, flights } = brief;
  const assign = brief.open.filter((p) => p.kind === "ASSIGN");
  const release = brief.open.filter((p) => p.kind === "RELEASE");

  return (
    <section className="dispatch">
      <div className="toolbar">
        <span className="muted">
          <span className={`dp-mode m-${brief.mode}`}>{brief.mode === "shadow" ? "SHADOW" : "APPROVAL"}</span> 5분마다 계획
          {brief.mode === "shadow" ? " · 아무에게도 보내지 않음" : " · 승인한 제안은 CAPTAIN에게 FLIGHT PLAN으로 나감"} · 계산 {timeAgo(brief.at, now)}
        </span>
        <button className={`dp-btn dp-mode-switch${brief.mode === "shadow" ? "" : " back"}`} onClick={switchMode}>
          {brief.mode === "shadow" ? "2b 승인 운용 켜기" : "2a 그림자 운용으로"}
        </button>
      </div>
      {error && (
        <p className="dp-error" role="alert">
          {error}
        </p>
      )}

      <Gate gate={gate} />
      {(brief.mode === "approval" || brief.gate3.dispatched > 0) && <Gate3 gate={brief.gate3} />}

      {brief.inFlight.length > 0 && (
        <>
          <h2 className="label">
            IN FLIGHT <em>승인 뒤 진행 중</em>
          </h2>
          <table className="dp-table dp-inflight">
            <thead>
              <tr>
                <th>ID</th>
                <th>FLIGHT</th>
                <th>AIRCRAFT</th>
                <th>상태</th>
                <th>언제부터</th>
              </tr>
            </thead>
            <tbody>
              {brief.inFlight.map((p) => (
                <tr key={p.id} className={`s-${p.status}${brief.overdue.includes(p.id) ? " is-overdue" : ""}`}>
                  <td className="mono">{p.id}</td>
                  <td className="mono" title={flights[p.flight]?.title}>
                    {flightNumber(p.flight)}
                  </td>
                  <td>{p.aircraftName}</td>
                  <td className="dp-result">
                    {statusText[p.status]}
                    {brief.overdue.includes(p.id) && <span className="dp-overdue">{p.status === "sent" ? "NO READBACK" : "NO DEPARTURE"}</span>}
                  </td>
                  <td className="faint">{timeAgo(p.statusAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="dp-slots" aria-label="슬롯">
        {plan.slots.map((s) => (
          <span key={s.airport} className="dp-slot">
            <b>{s.airport}</b> AIRBORNE {s.airborne} + 계획 {s.planned} / {s.limit}
          </span>
        ))}
        <span className="dp-slot">
          열린 ASSIGN {assign.length} / {brief.config.slots.openProposals}
        </span>
        <span className="dp-slot">
          열린 RELEASE {release.length} / {brief.config.slots.openReleases}
        </span>
      </div>

      <h2 className="label">
        ASSIGN <em>FLIGHT → AIRCRAFT</em>
      </h2>
      {assign.length ? (
        <div className="dp-cards">
          {assign.map((p) => (
            <Card key={p.id} p={p} flight={flights[p.flight]} now={now} onVerdict={verdict} onAccept={acceptCrosscheck} mode={brief.mode} />
          ))}
        </div>
      ) : (
        <p className="empty">열린 ASSIGN 제안 없음 — 배정할 수 있는 AIRCRAFT나 FLIGHT가 없거나 슬롯이 찼다.</p>
      )}

      {brief.held.length > 0 && (
        <>
          <h2 className="label">
            HELD <em>DISPATCH가 잡아 둠 — 선행 FLIGHT 또는 사람 결정 대기</em>
          </h2>
          <div className="dp-cards">
            {brief.held.map((p) => (
              <Card key={p.id} p={p} flight={flights[p.flight]} now={now} onVerdict={verdict} onUnhold={unhold} mode={brief.mode} held />
            ))}
          </div>
        </>
      )}

      <h2 className="label">
        RELEASE <em>STAND 없이 {brief.config.releaseDays}일 넘게 ENROUTE</em>
      </h2>
      {release.length ? (
        <div className="dp-cards">
          {release.map((p) => (
            <Card key={p.id} p={p} flight={flights[p.flight]} now={now} onVerdict={verdict} onAccept={acceptCrosscheck} mode={brief.mode} />
          ))}
        </div>
      ) : (
        <p className="empty">열린 RELEASE 제안 없음</p>
      )}

      <div className="dp-grid">
        <div>
          <h2 className="label">AIRCRAFT</h2>
          <ul className="dp-list">
            {[...plan.aircraft].sort((a, b) => Number(b.available && !b.reserved) - Number(a.available && !a.reserved) || a.callsign.localeCompare(b.callsign)).map((a) => (
              <li key={a.id} className={a.available && !a.reserved ? "is-available" : ""}>
                <b>{a.callsign}</b> <span className="faint">{a.name}</span>
                <span className="dp-list-note">{a.reserved ? `진행 중인 제안 ${a.reserved}` : a.available ? `가능 · ${a.reason}` : a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="label">HOLD_DEPARTURE · 제외</h2>
          <ul className="dp-list">
            {plan.hold.map((h) => (
              <li key={h.flight}>
                <b>{flightNumber(h.flight)}</b>
                <span className="dp-list-note">HOLD_DEPARTURE — {h.blockedBy.map(flightNumber).join(", ")}에 막힘</span>
              </li>
            ))}
            {plan.excluded.map((e) => (
              <li key={e.flight}>
                <b>{flightNumber(e.flight)}</b>
                <span className="dp-list-note">{e.reason}</span>
              </li>
            ))}
            {!plan.hold.length && !plan.excluded.length && <li className="faint">없음</li>}
          </ul>
        </div>
      </div>

      <h2 className="label">
        RECENT <em>최근 7일</em>
      </h2>
      {brief.recent.length ? (
        <table className="dp-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>종류</th>
              <th>FLIGHT</th>
              <th>AIRCRAFT</th>
              <th>결과</th>
              <th>사유</th>
              <th>언제</th>
            </tr>
          </thead>
          <tbody>
            {brief.recent.map((p) => (
              <tr key={p.id} className={`s-${p.status}`}>
                <td className="mono">{p.id}</td>
                <td className="mono">{p.kind}</td>
                <td className="mono">{flightNumber(p.flight)}</td>
                <td>{p.aircraftName ?? "—"}</td>
                <td className="dp-result">{statusText[p.status]}</td>
                <td className="dp-reason">
                  {p.reason ?? "—"}
                  <CrosscheckMini m={markOf(p)} />
                </td>
                <td className="faint">{timeAgo(p.statusAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">아직 결정된 제안 없음</p>
      )}

      {rejecting && (
        <RejectDialog
          p={rejecting.p}
          onCancel={() => answerReason(rejecting, null)}
          onSubmit={(chip, memo) => answerReason(rejecting, [chip, memo.trim()].filter(Boolean).join(" — "))}
        />
      )}
    </section>
  );
}

function RejectDialog({
  p,
  onCancel,
  onSubmit,
}: {
  p: Proposal;
  onCancel: () => void;
  onSubmit: (chip: string, memo: string) => void;
}) {
  const [chip, setChip] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  return (
    <div className="dp-dialog" role="dialog" aria-modal="true" aria-label={`${p.id} 거절 사유`}>
      <div className="dp-dialog-box">
        <h3 className="label">
          {p.id} 거절 <em>{flightNumber(p.flight)} → {p.aircraftName ?? "—"}</em>
        </h3>
        <div className="dp-chips" role="group" aria-label="거절 사유">
          {REJECT_REASONS.map((r) => (
            <button key={r} className={`dp-chip${chip === r ? " is-on" : ""}`} onClick={() => setChip(chip === r ? null : r)}>
              {r}
            </button>
          ))}
        </div>
        <input
          className="dp-dialog-memo"
          value={memo}
          autoFocus
          placeholder="메모(선택) — 칩 뒤에 붙습니다"
          onChange={(e) => setMemo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(chip ?? "", memo)}
        />
        <div className="dp-actions">
          <button className="dp-btn" onClick={onCancel}>
            취소
          </button>
          <button className="dp-btn disagree" disabled={!chip && !memo.trim()} onClick={() => onSubmit(chip ?? "", memo)}>
            거절 기록
          </button>
        </div>
        <p className="faint dp-dialog-note">
          기록되는 사유: <code>{[chip, memo.trim()].filter(Boolean).join(" — ") || "없음"}</code>
        </p>
      </div>
    </div>
  );
}

// 닫힌 제안에 남은 CROSSCHECK 표시(흐리게)
function CrosscheckMini({ m }: { m: Crosscheck | null }) {
  if (!m) return null;
  return (
    <span className={`dp-xc-mini v-${m.verdict}`} title={`CROSSCHECK ${m.verdict} (${m.by}) — ${m.reason}`}>
      CROSSCHECK {m.verdict}
    </span>
  );
}

// 열린 제안의 CROSSCHECK 칩: "CROSSCHECK agree · 사유"(길면 두 줄에서 자르고 전체는 title)
function CrosscheckChip({ m, now }: { m: Crosscheck; now: number }) {
  return (
    <p className={`dp-xc v-${m.verdict}`} title={`CROSSCHECK ${m.verdict} · ${m.by} · ${m.at}\n${m.reason}`}>
      <span className="dp-xc-mark">CROSSCHECK</span>
      <b className="dp-xc-verdict">{m.verdict}</b>
      <span className="dp-xc-reason">· {m.reason}</span>
      <time className="dp-xc-at" dateTime={m.at}>
        {timeAgo(m.at, now)}
      </time>
    </p>
  );
}

function Gate({ gate }: { gate: Brief["gate"] }) {
  const enough = gate.decided >= gate.target.decided;
  const rateOk = gate.agreement !== null && gate.agreement >= gate.target.agreement;
  const rows = [
    {
      label: "결정한 제안",
      value: `${gate.decided}건`,
      target: `≥ ${gate.target.decided}건`,
      state: enough ? "pass" : "fail",
    },
    {
      label: "합의율(승인했을 것 비율)",
      value: gate.agreement === null ? "—" : `${Math.round(gate.agreement * 100)}%`,
      target: `≥ ${gate.target.agreement * 100}%`,
      state: gate.decided < 5 ? "insufficient" : rateOk ? "pass" : "fail",
    },
  ] as const;
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  const xc = gate.crosscheck; // 옛 서버면 없음
  return (
    <div className="dp-gate">
      <h2 className="label">
        STAGE 2b <em>승인 운용 진입 점검 · {gate.ready ? "준비됨" : "아직"}</em>
      </h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`s-${r.state}`}>
            <span className="dp-gate-label">{r.label}</span>
            <span className="dp-gate-value">{r.value}</span>
            <span className="dp-gate-target">기준 {r.target}</span>
            <span className="dp-gate-state">{mark[r.state]}</span>
          </li>
        ))}
        {xc && (
          <li className="s-info dp-gate-xc">
            <span className="dp-gate-label">
              CROSSCHECK 일치 {xc.matched}/{xc.marked}
            </span>
            <span className="dp-gate-value">{pct(xc.rate)}</span>
            <span className="dp-gate-target">기준 없음</span>
            <span className="dp-gate-state">참고</span>
          </li>
        )}
      </ul>
      {xc && <p className="dp-gate-note faint">CROSSCHECK 일치는 참고용이다 — 게이트에는 사람 판정만 셈.</p>}
    </div>
  );
}

function Gate3({ gate }: { gate: Brief["gate3"] }) {
  const mark = { pass: "✓ 충족", fail: "✗ 미달", insufficient: "○ 데이터 부족" } as const;
  const few = gate.dispatched < 3;
  const rows = [
    { label: "보낸 FLIGHT PLAN", value: `${gate.dispatched}건`, target: `≥ ${gate.target.dispatched}건`, state: gate.dispatched >= gate.target.dispatched ? "pass" : "fail" },
    {
      label: `READBACK 비율 · 중앙값 ${gate.readbackMedianMin === null ? "—" : `${gate.readbackMedianMin}분`}`,
      value: pct(gate.readbackRate),
      target: `≥ ${gate.target.readback * 100}%`,
      state: few ? "insufficient" : gate.readbackRate !== null && gate.readbackRate >= gate.target.readback ? "pass" : "fail",
    },
    {
      label: "READBACK 뒤 DEPARTED 비율",
      value: pct(gate.departedRate),
      target: `≥ ${gate.target.departed * 100}%`,
      state: few ? "insufficient" : gate.departedRate !== null && gate.departedRate >= gate.target.departed ? "pass" : "fail",
    },
  ] as const;
  return (
    <div className="dp-gate">
      <h2 className="label">
        STAGE 3 <em>ATFM 진입 점검 · DECLINED {gate.declined} · {gate.ready ? "준비됨" : "아직"}</em>
      </h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label} className={`s-${r.state}`}>
            <span className="dp-gate-label">{r.label}</span>
            <span className="dp-gate-value">{r.value}</span>
            <span className="dp-gate-target">기준 {r.target}</span>
            <span className="dp-gate-state">{mark[r.state]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({
  p,
  flight,
  now,
  onVerdict,
  onAccept,
  mode,
  held,
  onUnhold,
}: {
  p: Proposal;
  flight: FlightInfo | undefined;
  now: number;
  onVerdict: (p: Proposal, v: "agree" | "disagree") => void;
  onAccept?: (p: Proposal, m: Crosscheck) => void; // HELD 카드에는 없음
  mode: DispatchConfig["mode"];
  held?: boolean;
  onUnhold?: (p: Proposal) => void;
}) {
  const max = Math.max(1, ...p.factors.map((f) => Math.abs(f.points)));
  const xc = held ? null : markOf(p);
  return (
    <article className={`dp-card k-${p.kind}${p.caution ? " is-caution" : ""}${held ? " is-held" : ""}`}>
      <header className="dp-card-head">
        <span className="dp-kind">{p.kind}</span>
        <span className="mono faint">{p.id}</span>
        <span className="faint dp-age">{timeAgo(p.at, now)}</span>
      </header>
      <div className="dp-flight">
        <a className="mono dp-fn" href={flight?.url ?? undefined} target="_blank" rel="noreferrer" title={p.flight}>
          {flightNumber(p.flight)}
        </a>
        {flight && <PriorityMark priority={flight.priority} />}
        <span className="dp-title">{flight?.title ?? p.flight}</span>
      </div>
      {flight?.cls && (
        <p className={`dp-class${flight.clsDefault ? " is-default" : ""}`} title={flight.clsDefault ? "type:·wake: 라벨이 없어 기본값(BUILD · M)으로 봄" : "FLIGHT TYPE · WAKE · 필요한 TYPE RATING"}>
          {flight.cls}
          {flight.tails?.length ? ` · ${flight.tails.map((n) => `tail:${n}`).join(", ")}` : ""}
          {flight.clsDefault && <span className="faint"> (기본값)</span>}
        </p>
      )}
      <div className="dp-target">
        {p.kind === "ASSIGN" ? (
          <>
            → <b>{p.aircraftName}</b> <span className="apt">{p.airport}</span>
          </>
        ) : (
          <>Todo로 되돌릴지 확인 {flight && <span className="faint">· 지금 {flight.state}</span>}</>
        )}
        <span className="dp-score" title="점수">
          {p.score}
        </span>
      </div>
      {p.holdAt && (
        <p className="dp-hold">
          <span className="dp-hold-mark">HOLD</span>
          {p.hold.length ? `선행 FLIGHT ${p.hold.map(flightNumber).join(", ")}가 끝난 뒤` : "사람 결정·외부 입력 대기 — 사유는 메모, FLIGHT가 수정되면 다시 검토"}
        </p>
      )}
      <table className="dp-factors">
        <tbody>
          {p.factors.map((f) => (
            <tr key={f.id}>
              <td>{f.label}</td>
              <td className="dp-factor-detail">{f.detail}</td>
              <td className="dp-factor-bar" aria-hidden>
                <span className={f.points < 0 ? "neg" : ""} style={{ width: `${(Math.abs(f.points) / max) * 100}%` }} />
              </td>
              <td className="num">{f.points > 0 ? `+${f.points}` : f.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(p.note || p.caution) && (
        <p className="dp-note">
          {p.caution && <span className="dp-caution">CAUTION</span>} {p.note}
        </p>
      )}
      {xc && <CrosscheckChip m={xc} now={now} />}
      <div className="dp-actions">
        <button className="dp-btn agree" onClick={() => onVerdict(p, "agree")}>
          {mode === "approval" ? "승인" : "승인했을 것"}
        </button>
        <button className="dp-btn disagree" onClick={() => onVerdict(p, "disagree")}>
          {mode === "approval" ? "거절" : "거절했을 것"}
        </button>
        {xc && onAccept && (
          <button
            className={`dp-btn dp-xc-accept v-${xc.verdict}`}
            title={`CROSSCHECK 판정(${xc.verdict})대로 ${xc.verdict === "agree" ? (mode === "approval" ? "승인" : "승인했을 것") : mode === "approval" ? "거절" : "거절했을 것"} 기록${xc.verdict === "disagree" ? " — 사유는 CROSSCHECK 사유" : ""}`}
            onClick={() => onAccept(p, xc)}
          >
            CROSSCHECK에 동의
          </button>
        )}
        {held && onUnhold && (
          <button className="dp-btn unhold" onClick={() => onUnhold(p)}>
            HOLD 풀기
          </button>
        )}
      </div>
    </article>
  );
}
