import { type ReactNode, useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "../api.ts";
import "./Release.css";
import { timeAgo } from "../derive.ts";
import { Empty } from "../kit/Empty.tsx";
import { Fold } from "../kit/Fold.tsx";
import { Loading } from "../kit/Loading.tsx";
import { SectionHead, TodoGroupedList, TodoRow } from "../kit/TodoRow.tsx";
import type { GroupSpec } from "../kit/todo-group.ts";
import { releaseSectionOf } from "../sidebar-rows.ts";

// RELEASE 화면(ATC-376, docs/layout.md Y1): SUPERVISOR가 화살을 쏘는 한 곳(`#release`).
// 위에서 아래로: 초점(발권 가능 n) · 모두 발권 · 발권 대기열(AIRPORT마다, 발권 단추는 여기에만) · 순서 지도(상위 이슈·사슬마다 한 줄의 칩) · PARKED · 최근 발권 · 장치.
// 대기열의 순서·출처·K 수준·풀리는 이슈와 지도는 서버가 정한다(GET /api/releases의 queue, server/release-queue.ts). 이 화면은 그리기만 한다.
// 발권 기록은 ATC-362의 길 그대로이고, 이 화면의 클릭만 screen 발권을 만든다(서버가 Origin을 검사한다).
// 사이드바는 구역 색인이다(발권 대기 · 순서 지도 · PARKED · 최근 발권): 고르면 `#release/<구역>`이 되고 이 화면이 그 구역으로 스크롤한다(ATC-423).

// K3 줄이 있는 FLIGHT의 상태(ATC-398, server/k3-allow.ts K3Status): 선언이 읽히나, 지금 발권이 allow를 주나
interface K3Status {
  lines: number;
  declared: number;
  unparsed: number;
  labels: string[];
  parses: boolean;
  grants: boolean;
  willGrant: boolean;
  hold: "not-declaration" | "release-on-screen" | null;
}
type KLevel = "none" | "K1" | "K2" | "K3" | "declared" | "undeclared";
type Source = "ready" | "filed" | "todo" | "k-confirm" | "proposal" | "parked";
type Action = "fire" | "release" | "priority" | "k-confirm" | "home";
// 대기열 한 줄(server/release-queue.ts QueueRow). PARKED 줄도 같은 꼴로 그린다(source parked)
interface QRow {
  key: string;
  title: string;
  airport: string;
  source: Source;
  action: Action;
  priority: number;
  kLevel: KLevel;
  kEffects: string | null;
  k3: K3Status | null;
  hash: string | null;
  parent: { key: string; title: string } | null;
  unlocks: string[];
  after: { key: string; reason: string; known: boolean } | null;
  sequenceProblem: string | null;
  sameFiles: string[];
  filed: { by: string; at: string } | null;
  problem: string | null;
  why: string | null;
  stale: boolean;
  waitingOn: string[];
  kConfirm: { at: string; session: string | null; words: string | null } | null;
  proposal: { reason: string; status: string } | null;
  parked?: { by: string | null; createdAt: string | null; duplicateOf: string | null };
}
interface MissingBlocker {
  key: string;
  why: string;
  text: string;
  href: string | null;
}
interface MapNode {
  key: string;
  title: string;
  kind: "fire" | "waiting" | "stage" | "released";
  word: string;
  missing: MissingBlocker[];
}
interface MapLane {
  id: string;
  airport: string;
  parent: { key: string; title: string } | null;
  done: number;
  total: number;
  chains: MapNode[][];
  fire: number;
}
interface Queue {
  rows: QRow[];
  map: MapLane[];
  counts: { fire: number; byAirport: { airport: string; fire: number }[]; unlocks: number; waiting: number; flying: number };
  days: { day: string; screen: number; "duty-chat": number; attested: number }[];
}
// PARKED(ATC-487): 막는 이슈 없이 손으로 올린 Backlog 이슈. 접힌 절에 보이고 발권 단추는 READY와 같다
interface ParkedRow {
  key: string;
  title: string;
  priority: number;
  createdAt: string | null;
  by: string | null;
  hash: string | null;
  kEffects: string | null;
  k3: K3Status | null;
  sequence: { after: string; reason: string } | null;
  duplicateOf?: string | null;
  kLevel?: KLevel;
}
interface Recent {
  key: string;
  title: string | null;
  channel: Channel;
  at: string;
  via: "click" | "bulk" | null;
  session: string | null;
}
type Channel = "screen" | "duty-chat" | "attested";
interface ReleaseData {
  queue: Queue;
  k3Relaunch?: { mode: "on" | "off"; approved: number; expired: number; rejected: number; stopOnly: { aircraft: string; proposal: string; t: string }[] };
  k3Hold?: { mode: "on" | "off"; nuisance: string[]; miss: { flight: string; aircraft: string; t: string }[]; waits?: { flight: string; id: string; t: string }[] };
  gate: { mode: "auto" | "on" | "off"; on: boolean; armedAt: string | null };
  parked?: { on: boolean; rows: ParkedRow[]; fired: number; misfires: string[]; duplicate?: { on: boolean; refused: number; overrides: number; bothFired: number } };
  unreleased: { key: string; hash: string | null }[];
  recent: Recent[];
  attested: Record<string, number>;
}

// AIRPORT가 없는 이슈의 묶음 이름(DISPATCH도 배정하지 않는다)
const NO_AIRPORT = "AIRPORT 없음";
const CHANNEL_LABEL: Record<Channel, string> = { screen: "화면", "duty-chat": "DUTY 채팅", attested: "attested" };
const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];

async function send(path: string, body: unknown) {
  const res = await apiSend("POST", path, body);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// K3 줄의 상태 한 줄: 읽히나 · 지금 발권이 allow를 주나(ATC-398). 줄이 없으면 아무것도 보이지 않는다
function k3Text(k3: K3Status): string {
  if (!k3.parses) return `K3 줄 ${k3.lines}개 중 ${k3.unparsed || k3.lines}개가 선언으로 읽히지 않음(not a declaration) — DISPATCH가 보내지 않습니다. 줄을 \`K3[<라벨>]: <통제> | files: <경로>\`로 고칩니다`;
  const what = `선언 ${k3.declared}개 읽힘(${k3.labels.join(", ")})`;
  return k3.grants ? `${what} · 지금 발권이 allow를 줍니다` : `${what} · 이 화면에서 발권하면 allow를 줍니다(세션이 증언한 발권은 주지 않습니다)`;
}

// 펼침 안쪽의 한 항목: 이름과 값
function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <p className="rls-fact">
      <span className="rls-name">{name}</span>
      <span>{children}</span>
    </p>
  );
}

// 줄 끝 칸: 우선순위 코드(Linear 1 긴급 … 4 낮음)를 글로. 색 칠한 배지는 쓰지 않는다(Craft 3.5). 없으면 "—"
const PRIO_CODE = ["—", "URG", "HIGH", "MED", "LOW"];
const prioOf = (p: number) => PRIO_CODE[p] ?? "—";

// 줄의 종류 태그: 이 줄이 어디서 와서 발권을 기다리나
const TAG: Record<Source, string> = { ready: "READY", filed: "제안", todo: "TODO", "k-confirm": "K 확인", proposal: "SCHEDULE NEW", parked: "PARKED" };
// K 태그: 실제로 선언한 효과만(None은 태그가 없다). 이름 없는 선언은 K, 선언 없음은 줄에 말하지 않고 펼침에서 말한다
const kTagOf = (k: KLevel) => (k === "K1" || k === "K2" || k === "K3" ? k : k === "declared" ? "K" : null);

// 상태를 한 문장으로(줄에서는 태그로만 말한 것)
function stateText(r: QRow): string {
  switch (r.source) {
    case "ready":
      return "Backlog이고 막는 이슈가 모두 끝났습니다. 발권하면 Todo로 옮기고 발권을 기록합니다";
    case "filed":
      return r.waitingOn.length
        ? `atc가 올린 제안이고 ${r.waitingOn.join(", ")}가 아직 끝나지 않았습니다. 발권하면 Todo로 옮기고, DISPATCH는 막는 이슈가 끝난 뒤 배정합니다`
        : "atc가 올린 제안입니다. 발권하면 Todo로 옮기고 발권을 기록합니다. 하지 않을 일이면 버립니다";
    case "todo":
      return r.stale ? "Todo · 발권 뒤 내용이 바뀌어 다시 발권해야 합니다" : r.why ? `Todo · 발권을 거뒀습니다 — ${r.why}` : "Todo · 발권 전";
    case "k-confirm":
      return "attested 발권만으로는 K 권한이 착륙까지 가지 않습니다. 확인하면 이 발권의 K 효과를 SUPERVISOR가 승인한 것으로 적습니다";
    case "proposal":
      return "아직 이슈가 아닙니다. HOME의 할 일에서 승인하면 Backlog 이슈가 생기고(SCHEDULE AUTO가 켜져 있으면 서버가 승인합니다), 그 뒤 이 대기열에서 한 번의 클릭으로 발권합니다";
    case "parked":
      return "Backlog이고 막는 이슈가 없습니다. 발권하면 Todo로 옮기고 발권을 기록합니다. 두고 싶으면 그대로 둡니다(이 절은 아무것도 스스로 옮기지 않습니다)";
  }
}

// 묶음 규칙(ATC-504): PARKED 절은 같은 태그에 같은 필요인 줄을 한 줄로 묶는다. 나이는 PARKED의 createdAt
function parkedSpec(r: QRow): GroupSpec {
  const need = r.action === "priority" ? "우선순위 먼저 정해야 발권" : r.problem ? `${r.problem} — 다시 확인하고 발권` : "발권 필요";
  const created = r.parked?.createdAt ? Date.parse(r.parked.createdAt) : NaN;
  return { kind: TAG.parked, need, tone: r.problem ? "caution" : null, ageMin: Number.isNaN(created) ? null : Math.max(0, (Date.now() - created) / 60_000) };
}

interface Acts {
  busy: string | null;
  discarding: string | null;
  reason: string;
  setReason: (v: string) => void;
  setDiscarding: (k: string | null) => void;
  fire: (r: QRow) => void;
  discard: (r: QRow) => void;
  confirmK: (r: QRow) => void;
}

// 줄의 단추 하나: 발권 · 우선순위 먼저 · K 효과 확인 · HOME에서 승인. 하루에 여러 번 누르는 단추라 강조색을 쓰지 않는다(Craft 3.5 색 예산)
function ActionButton({ r, acts }: { r: QRow; acts: Acts }) {
  switch (r.action) {
    case "fire":
    case "release":
      return (
        <button type="button" className="btn" disabled={acts.busy !== null} onClick={() => acts.fire(r)} aria-label={`${r.key} 발권${r.action === "fire" ? ": Todo로 옮기고 발권" : ""}`}>
          발권
        </button>
      );
    case "priority":
      return (
        <a className="btn" href={`#flight/${r.key}`} title="우선순위가 없으면 DISPATCH가 배정하지 않습니다. FLIGHT 서랍에서 먼저 정합니다">
          우선순위 먼저
        </a>
      );
    case "k-confirm":
      return (
        <button type="button" className="btn" disabled={acts.busy !== null} onClick={() => acts.confirmK(r)} aria-label={`${r.key} K 효과 확인`}>
          K 효과 확인
        </button>
      );
    case "home":
      return (
        <a className="btn" href="#home">
          HOME에서 승인
        </a>
      );
  }
}

// 줄의 둘째 줄: 풀리는 이슈, 상위 이슈, 순서, 같은 파일, 올린 곳, 기다리는 이슈. 전문은 펼침에
function Meta({ r }: { r: QRow }) {
  const bits: ReactNode[] = [];
  if (r.unlocks.length)
    bits.push(
      <span key="u" className="rls-unlock">
        풀림 {r.unlocks.length}{" "}
        <span className="mono">
          {r.unlocks.slice(0, 3).join(" › ")}
          {r.unlocks.length > 3 ? " …" : ""}
        </span>
      </span>,
    );
  if (r.parent)
    bits.push(
      <span key="p" className="rls-parent">
        <span className="mono">{r.parent.key}</span>
        {r.parent.title !== r.parent.key && ` ${r.parent.title}`}
      </span>,
    );
  if (r.waitingOn.length) bits.push(<span key="w">대기 {r.waitingOn.join(", ")}</span>);
  if (r.after)
    bits.push(
      <span key="a">
        after <span className="mono">{r.after.key}</span>
        {!r.after.known && " (알 수 없는 이슈)"}
      </span>,
    );
  if (r.sequenceProblem && !r.after) bits.push(<span key="sp">{r.sequenceProblem}</span>);
  if (r.sameFiles.length) bits.push(<span key="f">같은 파일: {r.sameFiles.join(", ")}</span>);
  if (r.filed) bits.push(<span key="by">{`${r.filed.by} · ${timeAgo(r.filed.at, Date.now())}`}</span>);
  if (r.kConfirm) bits.push(<span key="kc">{`${r.kConfirm.session ?? "—"} · ${timeAgo(r.kConfirm.at, Date.now())}`}</span>);
  if (r.parked?.duplicateOf)
    bits.push(
      <span key="d" className="rls-problem" title="제목이 비슷한 이슈가 있습니다. 정보일 뿐이고 아무것도 숨기거나 합치거나 취소하지 않습니다">
        possible duplicate of <a href={`#flight/${r.parked.duplicateOf}`}>{r.parked.duplicateOf}</a>
      </span>,
    );
  if (bits.length === 0) return null;
  return <span className="rls-meta">{bits.flatMap((b, i) => (i ? [<span key={`s${i}`} className="rls-dot" aria-hidden="true">·</span>, b] : [b]))}</span>;
}

// 대기열(그리고 PARKED)의 한 줄: kit TodoRow 한 줄과 펼침. 펼침은 줄이 말하지 않은 것만(원칙 6)
function QueueRow({ r, open, toggle, acts }: { r: QRow; open: boolean; toggle: () => void; acts: Acts }) {
  const { busy, discarding, reason, setReason, setDiscarding, discard } = acts;
  const kTag = kTagOf(r.kLevel);
  const age = r.parked?.createdAt ? `${prioOf(r.priority)} · ${timeAgo(r.parked.createdAt, Date.now())}` : prioOf(r.priority);
  const discardable = r.source === "filed";
  return (
    <TodoRow
      domId={`rls-q-${r.key}`}
      tag={TAG[r.source]}
      tone={r.problem || r.source === "k-confirm" ? "caution" : null}
      subject={r.key}
      need={
        <>
          <span className="rls-title">
            {kTag && (
              <span className="tag rls-k" title="이슈 본문 `## K effects`: 발권은 이 선언을 승인하는 것입니다">
                {kTag}
              </span>
            )}
            {r.title}
            {r.problem && <span className="rls-problem"> — {r.problem}</span>}
          </span>
          <Meta r={r} />
        </>
      }
      age={age}
      open={open}
      onToggle={toggle}
      action={<ActionButton r={r} acts={acts} />}
      detail={
        <>
          <Fact name="상태">{stateText(r)}</Fact>
          {r.source !== "proposal" && (
            <Fact name="K 효과">
              {r.kEffects ?? "선언 없음"}
              {r.k3 && ` · ${k3Text(r.k3)}`}
            </Fact>
          )}
          {r.source === "proposal" && <Fact name="K 효과">{r.kEffects ?? "선언 없음"}</Fact>}
          {r.proposal && <Fact name="이유">{r.proposal.reason}</Fact>}
          {r.kConfirm?.words && <Fact name="증언">{`“${r.kConfirm.words.slice(0, 120)}”`}</Fact>}
          {r.parent && r.parent.title.length > 40 && (
            <Fact name="상위 이슈">
              <span className="mono">{r.parent.key}</span> {r.parent.title}
            </Fact>
          )}
          {r.unlocks.length > 3 && <Fact name="풀리는 것">{r.unlocks.join(" › ")}</Fact>}
          {r.after && (
            <Fact name="순서">
              <span title="작업 지시서 `Sequence:` 줄: 순서의 선호이고 막지 않습니다. 발권할 수 있습니다">
                after <span className="mono">{r.after.key}</span>: {r.after.reason}
                {!r.after.known && " (알 수 없는 이슈, 순서에 쓰지 않음)"}
              </span>
            </Fact>
          )}
          {r.sameFiles.length > 0 && <Fact name="같은 파일">날고 있거나 앞에 놓인 이슈가 같은 파일을 고칩니다</Fact>}
          {r.action === "priority" && <Fact name="우선순위">없어서 Todo로 옮기지 않습니다(DISPATCH가 건너뜁니다). 먼저 정합니다</Fact>}
          {r.filed && (
            <Fact name="제안">
              {r.filed.by} · <span className="mono">{clock(r.filed.at)}</span>
            </Fact>
          )}
          {r.parked && <Fact name="올린 사람">{r.parked.by ?? "알 수 없음"}</Fact>}
          {r.source !== "proposal" && (
            <div className="rls-acts">
              <a className="btn" href={`#flight/${r.key}`}>
                FLIGHT 열기
              </a>
              {discardable && discarding !== r.key && (
                <button type="button" className="btn" disabled={busy !== null} onClick={() => { setDiscarding(r.key); setReason(""); }} aria-label={`${r.key} 버리기`} title="Canceled로 옮기고 사유를 이슈에 남깁니다">
                  버림…
                </button>
              )}
              {discardable && discarding === r.key && (
                <>
                  <input className="rls-reason" aria-label={`${r.key}를 버리는 사유`} placeholder="버리는 사유(선택)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy !== null} />
                  <button type="button" className="btn is-danger" disabled={busy !== null} onClick={() => discard(r)}>
                    버리기
                  </button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => { setDiscarding(null); setReason(""); }}>
                    취소
                  </button>
                </>
              )}
            </div>
          )}
        </>
      }
    />
  );
}

// 초점: 발권할 것이 몇 개고, 쏘면 무엇이 풀리나. 보통 상태는 무채색(원칙 1). gate 줄은 꺼졌을 때만 호박색
function Focal({ q, data, parked }: { q: Queue; data: ReleaseData; parked: number | null }) {
  const n = q.counts.fire;
  const gate = data.gate;
  return (
    <header className="rls-focal">
      <h2 className="rls-focal-title">{n > 0 ? `발권 가능 ${n}` : "발권할 것 없음"}</h2>
      <p className="rls-focal-rest">
        {n > 0 &&
          q.counts.byAirport.map((a) => (
            <span key={a.airport}>
              <b className={a.airport ? "mono" : undefined}>{a.airport || NO_AIRPORT}</b> {a.fire}
            </span>
          ))}
        {q.counts.unlocks > 0 && <span>쏘면 풀리는 이슈 {q.counts.unlocks}</span>}
        <span>
          기다림 {q.counts.waiting} · 비행 중 {q.counts.flying}
        </span>
        {parked !== null && (
          <a className="rls-focal-link" href="#release/parked">
            PARKED {parked} ↓
          </a>
        )}
      </p>
      {!gate.on && (
        <p className={`rls-focal-note${gate.mode === "off" ? " is-off" : ""}`}>
          {gate.mode === "off" ? "발권 gate 꺼짐(dispatch.json releaseGate) — 발권 없이도 배정합니다" : "일괄 확인을 하면 이때부터 발권한 FLIGHT만 배정합니다. 그 전까지는 발권 없이도 배정합니다"}
        </p>
      )}
    </header>
  );
}

// 순서 지도: 상위 이슈와 사슬마다 한 줄. ▶ 발권 가능(누르면 대기열의 그 줄), ○ 기다림, ◐ 비행 중, ✓ 발권됨. 모양으로 가르고 색만으로 가르지 않는다(원칙 2)
const GLYPH: Record<MapNode["kind"], string> = { fire: "▶", waiting: "○", stage: "◐", released: "✓" };
function OrderMap({ lanes, onPick }: { lanes: MapLane[]; onPick: (key: string) => void }) {
  return (
    <section id="rls-map" className="rls-section" aria-label="순서 지도">
      <div className="rls-map-head">
        <SectionHead count={lanes.length}>순서 지도</SectionHead>
        <p className="rls-map-key" aria-hidden="true">
          <span>▶ 발권 가능</span>
          <span>○ 기다림</span>
          <span>◐ 비행 중</span>
          <span>✓ 발권됨</span>
          <span>→ 끝나면 풀림</span>
        </p>
      </div>
      {lanes.length === 0 ? (
        <Empty>상위 이슈와 사슬 없음 — 남은 이슈가 모두 홀로 있습니다</Empty>
      ) : (
        <ul className="rls-map">
          {lanes.map((l) => (
            <li key={l.id} className="rls-lane">
              <div className="rls-lane-label">
                {l.airport && <span className="mono rls-lane-ap">{l.airport}</span>}
                {l.parent ? (
                  <a className="mono rls-lane-key" href={`#flight/${l.parent.key}`}>
                    {l.parent.key}
                  </a>
                ) : (
                  <span className="rls-lane-chain">사슬</span>
                )}
                {l.parent?.title !== l.parent?.key && (
                  <span className="rls-lane-title" title={l.parent?.title}>
                    {l.parent ? l.parent.title : `${l.total}개`}
                  </span>
                )}
                {l.parent && (
                  <span className="rls-lane-prog" aria-label={`끝남 ${l.done}/${l.total}`}>
                    <span className="rls-prog-bar" aria-hidden="true">
                      <span style={{ width: `${l.total ? Math.round((l.done / l.total) * 100) : 0}%` }} />
                    </span>
                    <span className="mono">
                      {l.done}/{l.total}
                    </span>
                  </span>
                )}
              </div>
              <div className="rls-lane-chips">
                {l.chains.map((ch) => (
                  <ol key={ch[0]!.key} className="rls-chain" aria-label={`${ch[0]!.key}부터 순서`}>
                    {ch.map((n) => {
                      const label = `${n.key} ${n.kind === "fire" ? "발권 가능" : n.word}: ${n.title}`;
                      return (
                        <li key={n.key} className="rls-chain-item">
                          {n.kind === "fire" ? (
                            <button type="button" className="rls-chip is-fire" onClick={() => onPick(n.key)} aria-label={`${label} — 대기열의 줄 열기`} title={label}>
                              <span aria-hidden="true">{GLYPH.fire}</span> {n.key}
                            </button>
                          ) : (
                            <a className={`rls-chip is-${n.kind}`} href={`#flight/${n.key}`} aria-label={label} title={label}>
                              <span aria-hidden="true">{GLYPH[n.kind]}</span> {n.key}
                              {n.kind === "stage" && <span className="rls-chip-word">{n.word}</span>}
                            </a>
                          )}
                          {/* 막는 이슈가 이 화면의 줄이 아니면 어디 있는지(ATC-488): PARKED에 있으면 거기서 쏠 수 있다 */}
                          {n.missing.map((m) =>
                            m.href ? (
                              <a key={m.key} className="rls-missing" href={m.href} {...(m.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                                ← <span className="mono">{m.key}</span> {m.text}
                              </a>
                            ) : (
                              <span key={m.key} className="rls-missing">
                                ← <span className="mono">{m.key}</span> {m.text}
                              </span>
                            ),
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// 최근 발권: 7일 막대(상태 페이지 모양, design-taste 4)와 최근 줄. 막대와 합계는 같은 수(서버 queue.days)
function RecentSection({ data }: { data: ReleaseData }) {
  const days = data.queue.days;
  const sum = (d: (typeof days)[number]) => d.screen + d["duty-chat"] + d.attested;
  const max = Math.max(1, ...days.map(sum));
  const total = days.reduce((n, d) => n + sum(d), 0);
  const byChannel = (c: Channel) => days.reduce((n, d) => n + d[c], 0);
  const attested = Object.entries(data.attested);
  const now = Date.now();
  const line = (r: Recent) => (
    <li key={`${r.key}-${r.at}`} className="rls-recent-row">
      <a className="mono" href={`#flight/${r.key}`}>
        {r.key}
      </a>
      <span className="rls-recent-title">{r.title ?? "—"}</span>
      <span className="rls-recent-ch">
        {CHANNEL_LABEL[r.channel]}
        {r.via === "bulk" ? " · 일괄" : ""}
      </span>
      <span className="mono rls-recent-age" title={clock(r.at)}>
        {timeAgo(r.at, now)}
      </span>
    </li>
  );
  return (
    <section id="rls-recent" className="rls-section" aria-label="최근 발권">
      <SectionHead count={data.recent.length}>최근 발권</SectionHead>
      <div className="rls-days" role="img" aria-label={`7일 발권 ${total}: ${days.map((d) => `${d.day.slice(5)} ${sum(d)}`).join(", ")}`}>
        {days.map((d) => (
          <div key={d.day} className="rls-day" title={`${d.day} · ${CHANNELS.map((c) => `${CHANNEL_LABEL[c]} ${d[c]}`).join(" · ")}`}>
            <div className="rls-day-stack" style={{ height: `${(sum(d) / max) * 100}%` }}>
              <span className="is-attested" style={{ flexGrow: d.attested }} />
              <span className="is-duty" style={{ flexGrow: d["duty-chat"] }} />
              <span className="is-screen" style={{ flexGrow: d.screen }} />
            </div>
            <span className="mono rls-day-n">{sum(d)}</span>
            <span className="mono rls-day-label">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>
      <p className="rls-legend">
        <span>7일(UTC) {total}</span>
        <span>
          <span className="rls-sw is-screen" aria-hidden="true" /> 화면 {byChannel("screen")}
        </span>
        <span>
          <span className="rls-sw is-duty" aria-hidden="true" /> DUTY 채팅 {byChannel("duty-chat")}
        </span>
        <span>
          <span className="rls-sw is-attested" aria-hidden="true" /> attested {byChannel("attested")}
        </span>
      </p>
      {data.recent.length === 0 ? (
        <Empty>발권 기록 없음</Empty>
      ) : (
        <>
          <ul className="rls-recent">{data.recent.slice(0, 5).map(line)}</ul>
          {data.recent.length > 5 && (
            <Fold title="더 보기" count={data.recent.length - 5} defaultOpen={false} level={3}>
              <ul className="rls-recent">{data.recent.slice(5).map(line)}</ul>
            </Fold>
          )}
        </>
      )}
      {attested.length > 0 && (
        <p className="rls-note" title="다른 세션이 SUPERVISOR의 말을 증언한 발권. 서버는 그 말을 확인할 수 없어 표본으로 확인한다">
          attested 발권(세션별): {attested.map(([s, n]) => `${s} ${n}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

// 장치: 발권에 걸린 스위치와 오작동 수. 접혀 있고, 볼 것이 있으면 열려 있고 요약이 그 이름을 말한다
function Devices({ data }: { data: ReleaseData }) {
  const h = data.k3Hold;
  const re = data.k3Relaunch;
  const waits = h?.waits ?? [];
  const lines: { name: string; text: string; look: boolean; title: string }[] = [
    {
      name: "GATE",
      text: data.gate.on ? `on · ${data.gate.armedAt ? `${clock(data.gate.armedAt)}부터` : ""}` : data.gate.mode === "off" ? "off · 발권 없이도 배정" : "auto · 아직 켜지지 않음(첫 일괄 발권에 켜짐)",
      look: data.gate.mode === "off",
      title: "발권한 FLIGHT만 배정하는 문(dispatch.json releaseGate)",
    },
  ];
  if (h)
    lines.push({
      name: "K3 HOLD",
      text: `${h.mode} · nuisance ${h.nuisance.length} · miss ${h.miss.length}${h.miss.length ? ` (${h.miss.map((m) => `${m.flight}@${m.aircraft}`).join(", ")})` : ""} · wait ${waits.length}${waits.length ? ` (${waits.map((w) => w.flight).join(", ")})` : ""}`,
      look: h.mode !== "on" || h.nuisance.length > 0 || h.miss.length > 0 || waits.length > 0,
      title: "DISPATCH가 K3 줄이 있는 FLIGHT를 allow 없이 보내지 않는 장치(설정 창 K3 HOLD). 오작동: nuisance = 효과 없는 K3 줄에 걸려 hold됨, miss = allow 없이 떠난 K3 FLIGHT가 classifier 거부로 멈춤, wait = LAUNCH 직전에 K3 entries를 못 만들어 기다린 launch 카드(ATC-506)",
    });
  if (re)
    lines.push({
      name: "K3 RELAUNCH",
      text: `${re.mode} · 7일 승인 ${re.approved} · 만료 ${re.expired} · 반대 ${re.rejected} · STOP만 ${re.stopOnly.length}${re.stopOnly.length ? ` (${re.stopOnly.map((m) => `${m.aircraft}·${m.proposal}`).join(", ")})` : ""}`,
      look: re.stopOnly.length > 0,
      title: "K3 FLIGHT를 받을 ABSENT AIRCRAFT가 없을 때 쉬는 AIRCRAFT를 멈추고 새로 띄우는 FLEET PLAN 카드(설정 창 K3 RELAUNCH). 7일: 승인 = 승인한 카드, 만료·반대 = 아무도 쓰지 않고 닫힌·반대한 카드, STOP만 = 멈췄는데 launch 카드 시한 안에 LAUNCH가 없음",
    });
  const look = lines.filter((l) => l.look).map((l) => l.name);
  return (
    <Fold title="장치" summary={look.length ? `볼 것 ${look.join(", ")}` : `${lines.length}개 · 오작동 없음`} defaultOpen={look.length > 0} level={2}>
      <dl className="rls-dev">
        {lines.map((l) => (
          <div key={l.name} className={l.look ? "is-look" : undefined} title={l.title}>
            <dt className="mono">{l.name}</dt>
            <dd>{l.text}</dd>
          </div>
        ))}
      </dl>
    </Fold>
  );
}

// 지금 주소의 구역으로 스크롤한다(#release/queue …, 옛 #release/order는 발권 대기). 사이드바가 주소를 정한다
function useScrollToSection(ready: boolean, openParked: () => void) {
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const s = releaseSectionOf(location.hash);
      if (!s) return;
      if (s === "parked") openParked();
      setTimeout(() => document.getElementById(`rls-${s}`)?.scrollIntoView({ block: "start" }), 0);
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, [ready, openParked]);
}

export function Release({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<ReleaseData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [parkedSignal, setParkedSignal] = useState(0);
  // `#release/parked`(초점의 PARKED 링크, 지도의 "← PARKED", ATC-488): 접힌 PARKED 절을 연다
  const openParked = useCallback(() => setParkedSignal((n) => n + 1), []);
  useScrollToSection(loaded && data !== null, openParked);

  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/releases");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setData(j && j.queue ? j : null); // queue가 없으면 옛 서버: 안내만 그린다
    } catch {
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!loaded) return <Loading>발권 후보 불러오는 중…</Loading>;
  if (!data) return <Empty>발권 기록을 읽지 못했습니다. 서버를 새 버전으로 올린 뒤 다시 엽니다.</Empty>;

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setConfirm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // READY·제안·PARKED는 Todo로 옮기며 발권(fire), 이미 Todo인 줄은 발권(release). 길은 이전과 같다
  const fireRow = (r: QRow) => run(r.key, () => send(r.action === "release" ? "/api/releases" : "/api/releases/fire", { flight: r.key, hash: r.hash }));
  const discardRow = (r: QRow) =>
    run(r.key, async () => {
      await send("/api/releases/discard", { flight: r.key, hash: r.hash, reason });
      setDiscarding(null);
      setReason("");
    });
  const confirmK = (r: QRow) => run(`k-${r.key}`, () => send("/api/releases/k-confirm", { flight: r.key, hash: r.hash }));
  const releaseAll = () => run("all", () => send("/api/releases/bulk", { flights: data.unreleased.map((r) => ({ key: r.key, hash: r.hash })) }));
  const acts: Acts = { busy, discarding, reason, setReason, setDiscarding, fire: fireRow, discard: discardRow, confirmK };

  const q = data.queue;
  // 대기열을 AIRPORT마다 가른다(서버 순서 그대로). SCHEDULE NEW 제안은 아직 이슈가 아니라 AIRPORT가 없고 맨 뒤 묶음이다
  const groups: { name: string; rows: QRow[] }[] = [];
  for (const r of q.rows) {
    const name = r.source === "proposal" ? "SCHEDULE NEW" : r.airport || NO_AIRPORT;
    const g = groups.find((x) => x.name === name);
    if (g) g.rows.push(r);
    else groups.push({ name, rows: [r] });
  }
  const last = (n: string) => (n === "SCHEDULE NEW" ? 2 : n === NO_AIRPORT ? 1 : 0);
  groups.sort((a, b) => last(a.name) - last(b.name));
  const toggle = (id: string) => () => setOpenKey(openKey === id ? null : id);
  // 지도의 ▶ 칩: 대기열의 그 줄을 열고 그리로 스크롤해 초점을 준다
  const pick = (key: string) => {
    setOpenKey(`q/${key}`);
    requestAnimationFrame(() => {
      const el = document.getElementById(`rls-q-${key}`);
      el?.scrollIntoView({ block: "center" });
      el?.querySelector<HTMLButtonElement>(".kit-todo-main")?.focus({ preventScroll: true });
    });
  };
  const parked = data.parked?.on ? data.parked : null;
  const parkedRows: QRow[] = (parked?.rows ?? []).map((p) => ({
    key: p.key,
    title: p.title,
    airport: "",
    source: "parked",
    action: p.priority <= 0 ? "priority" : "fire",
    priority: p.priority,
    kLevel: p.kLevel ?? "undeclared",
    kEffects: p.kEffects,
    k3: p.k3,
    hash: p.hash,
    parent: null,
    unlocks: [],
    after: p.sequence ? { key: p.sequence.after, reason: p.sequence.reason, known: true } : null,
    sequenceProblem: null,
    sameFiles: [],
    filed: null,
    problem: p.priority <= 0 ? "우선순위 없음" : p.k3 && !p.k3.parses ? "K3 줄이 읽히지 않음" : null,
    why: null,
    stale: false,
    waitingOn: [],
    kConfirm: null,
    proposal: null,
    parked: { by: p.by, createdAt: p.createdAt, duplicateOf: p.duplicateOf ?? null },
  }));
  const unreleased = data.unreleased.length;

  return (
    <div className="rls-screen">
      <Focal q={q} data={data} parked={parked ? parkedRows.length : null} />
      {error && (
        <p className="rls-error" role="alert">
          {error}
        </p>
      )}
      {unreleased > 0 && (
        <div className="rls-bar">
          {confirm ? (
            <>
              <span className="rls-confirm">Todo {unreleased}개의 목표·완료 기준·K 효과를 승인하고 DISPATCH가 배정하게 합니다. 이 승인은 한 번이고 이후 사람 단계는 없습니다.</span>
              <button type="button" className="btn is-primary" disabled={busy !== null} onClick={releaseAll}>
                {data.gate.on ? `${unreleased}개 발권` : `${unreleased}개 발권하고 gate 켜기`}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirm(false)}>
                취소
              </button>
            </>
          ) : (
            <>
              <span>
                발권 전 Todo {unreleased}
                {!data.gate.on && " · 모두 발권하면 gate가 켜집니다"}
              </span>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirm(true)}>
                모두 발권…
              </button>
            </>
          )}
        </div>
      )}

      <section id="rls-queue" className="rls-section" aria-label="발권 대기">
        <SectionHead count={q.rows.length}>발권 대기</SectionHead>
        {q.rows.length === 0 && <Empty>발권할 것 없음 — DUTY REVIEW·SCHEDULE NEW가 올린 제안과 막는 이슈가 끝난 Backlog 이슈가 여기 옵니다. 기다리는 이슈는 아래 순서 지도에 있습니다</Empty>}
        {groups.map((g) => (
          <div key={g.name} className="rls-group">
            {groups.length > 1 && (
              <h3 className="rls-group-head">
                <span className={g.name === NO_AIRPORT ? undefined : "mono"}>{g.name}</span> <em>{g.rows.length}</em>
              </h3>
            )}
            <ul className="rls-rows" aria-label={`${g.name} 발권 대기`}>
              {g.rows.map((r) => (
                <QueueRow key={r.key} r={r} open={openKey === `q/${r.key}`} toggle={toggle(`q/${r.key}`)} acts={acts} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <OrderMap lanes={q.map} onPick={pick} />

      {parked && (
        <div id="rls-parked" className="rls-section">
          <Fold title="PARKED" count={parkedRows.length} summary="손으로 올린 Backlog · 스스로 옮기지 않음" defaultOpen={false} openSignal={parkedSignal}>
            <p className="rls-note" title="막는 이슈 없이 손으로 올린 Backlog 이슈(상위 이슈 제외). 이 절은 아무것도 스스로 발권하거나 옮기지 않습니다. 오작동: 이 절에서 발권한 이슈가 24시간 안에 Canceled·Duplicate가 됨(설정 창 PARKED로 끕니다)">
              7일 이 절에서 발권 {parked.fired} · 24시간 안에 취소·중복 {parked.misfires.length}
              {parked.misfires.length > 0 && ` (${parked.misfires.join(", ")})`}
            </p>
            {parked.duplicate?.on && (parked.duplicate.overrides > 0 || parked.duplicate.bothFired > 0) && (
              <p className="rls-note" title="비슷한 제목 검사(설정 창 DUPLICATE TITLE). 넘김 = `--same-title-ok`로 거절을 뒤집은 수, 둘 다 발권 = 중복 표시가 있는 이슈를 쏘았는데 쌍도 이미 발권돼 있던 수">
                7일 중복 표시 · 거절 {parked.duplicate.refused} · 넘김 {parked.duplicate.overrides} · 둘 다 발권 {parked.duplicate.bothFired}
              </p>
            )}
            {parkedRows.length === 0 ? (
              <Empty>PARKED 이슈 없음</Empty>
            ) : (
              <TodoGroupedList
                className="rls-rows"
                label="PARKED"
                items={parkedRows}
                keyOf={(r) => r.key}
                specOf={parkedSpec}
                render={(r) => <QueueRow key={`p/${r.key}`} r={r} open={openKey === `p/${r.key}`} toggle={toggle(`p/${r.key}`)} acts={acts} />}
              />
            )}
          </Fold>
        </div>
      )}

      <RecentSection data={data} />
      <Devices data={data} />
    </div>
  );
}
