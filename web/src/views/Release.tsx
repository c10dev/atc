import { useCallback, useEffect, useState } from "react";
import { OpenFlight } from "../FlightLink.tsx";
import { apiGet, apiSend } from "../api.ts";
import { PriorityMark } from "../badges.tsx";
import "./Release.css";
import "./ReleaseTree.css";
import { Empty } from "../kit/Empty.tsx";
import { Fold } from "../kit/Fold.tsx";
import { Loading } from "../kit/Loading.tsx";

// RELEASE 화면(ATC-376, docs/layout.md Y1): SUPERVISOR가 화살을 쏘는 한 곳(`#release`).
// 후보(READY Backlog, 에이전트 제안) · 발권 없는 Todo · 최근 발권. 발권 기록은 ATC-362의 길 그대로이고, 이 화면의 클릭만 screen 발권을 만든다(서버가 Origin을 검사한다).
// 클릭 전에 FLIGHT가 선언한 K 효과를 같은 줄에 보인다.

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
interface Row {
  k3?: K3Status | null;
  key: string;
  title: string;
  hash: string | null;
  priority: number;
  kEffects: string | null;
  state: "ready" | "unreleased" | "stale";
  why?: string | null; // 발권을 거둔 이유(마이그레이션 리허설이 멈춤 등)
}
interface Proposal {
  id: string;
  title: string;
  reason: string;
  status: string;
  kEffects: string | null;
  priority: number;
}
// attested 발권에 K 효과가 선언돼 있고 SUPERVISOR 확인이 아직 없는 것(ATC-391): 누르면 K 권한이 착륙까지 간다
interface KPending {
  key: string;
  title: string | null;
  hash: string;
  at: string;
  session: string | null;
  words: string | null;
  kEffects: string | null;
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
// atc가 Backlog에 올린 제안(ATC-401): DUTY REVIEW·SCHEDULE NEW. 쏘거나 버릴 때까지 여기 있다
interface Filed {
  k3?: K3Status | null;
  key: string;
  title: string;
  hash: string | null;
  priority: number;
  kEffects: string | null;
  by: string;
  at: string;
}
// 발권 순서의 나무(ATC-456, server/release-tree.ts): 상위 이슈마다 그룹, 막는 이슈 밑에 막힌 이슈
type StateWord = { kind: "ready" } | { kind: "todo" } | { kind: "waiting"; on: string[] } | { kind: "stage"; word: string };
interface TreeRow {
  key: string;
  title: string;
  priority: number;
  state: StateWord;
  fire: "fire" | "release" | null;
  released: boolean;
  after: { key: string; reason: string; known: boolean } | null;
  sequenceProblem: string | null;
  sameFiles: string[];
  children: TreeRow[];
  hash: string | null;
  kEffects: string | null;
  k3: K3Status | null;
  filed: { by: string; at: string } | null;
  why: string | null;
  stale: boolean;
}
interface TreeGroup {
  key: string | null;
  title: string;
  done: number;
  total: number;
  next: string | null;
  rows: TreeRow[];
}
interface ReleaseData {
  tree?: TreeGroup[];
  k3Hold?: { mode: "on" | "off"; nuisance: string[]; miss: { flight: string; aircraft: string; t: string }[] };
  gate: { mode: "auto" | "on" | "off"; on: boolean; armedAt: string | null };
  ready: Row[];
  filed: Filed[];
  proposals: Proposal[];
  unreleased: Row[];
  kPending?: KPending[];
  recent: Recent[];
  channels: Record<Channel, number>;
  attested: Record<string, number>;
}

const CHANNEL_LABEL: Record<Channel, string> = { screen: "화면", "duty-chat": "DUTY 채팅", attested: "attested" };

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

// 선언한 K 효과: 없으면 없다고 적는다(빈 칸이 "효과 없음"으로 읽히지 않게)
// K3 줄의 상태 한 줄: 읽히나 · 지금 발권이 allow를 주나(ATC-398). 줄이 없으면 아무것도 보이지 않는다
function k3Text(k3: K3Status): string {
  if (!k3.parses) return `K3 줄 ${k3.lines}개 중 ${k3.unparsed || k3.lines}개가 선언으로 읽히지 않음(not a declaration) — DISPATCH가 보내지 않습니다. 줄을 \`K3[<라벨>]: <통제> | files: <경로>\`로 고칩니다`;
  const what = `선언 ${k3.declared}개 읽힘(${k3.labels.join(", ")})`;
  return k3.grants ? `${what} · 지금 발권이 allow를 줍니다` : `${what} · 이 화면에서 발권하면 allow를 줍니다(세션이 증언한 발권은 주지 않습니다)`;
}
function KEffects({ text, k3 }: { text: string | null; k3?: K3Status | null }) {
  const line = k3 ? (
    <span className={k3.parses ? "rl-k3" : "rl-k3 is-bad"}>
      <b>K3</b> {k3Text(k3)}
    </span>
  ) : null;
  return text ? (
    <span className="rl-k" title="이슈 본문 `## K effects` 절. 발권은 이 선언을 승인하는 것입니다">
      <b>K</b> {text}
      {line}
    </span>
  ) : (
    <span className="rl-k">
      <b>K</b> 선언 없음
      {line}
    </span>
  );
}

export function Release({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<ReleaseData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/releases");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null); // 서버에 발권 기록이 없으면(옛 서버) 안내만 그린다
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
  // 나무 줄의 단추: READY Backlog와 제안은 Todo로 옮기며 발권(fire), 이미 Todo인 줄은 발권(release). 길은 이전과 같다
  const fireRow = (r: TreeRow) => run(r.key, () => send(r.fire === "release" ? "/api/releases" : "/api/releases/fire", { flight: r.key, hash: r.hash }));
  const discardRow = (r: TreeRow) =>
    run(r.key, async () => {
      await send("/api/releases/discard", { flight: r.key, hash: r.hash, reason });
      setDiscarding(null);
      setReason("");
    });
  const confirmK = (r: KPending) => run(`k-${r.key}`, () => send("/api/releases/k-confirm", { flight: r.key, hash: r.hash }));
  const releaseAll = () => run("all", () => send("/api/releases/bulk", { flights: data.unreleased.map((r) => ({ key: r.key, hash: r.hash })) }));

  // gate가 아직 꺼져 있으면(일괄 확인 전) 안내만: 지금은 발권 없이도 배정한다
  const gateNote = data.gate.on
    ? "발권한 FLIGHT만 배정합니다"
    : data.gate.mode === "off"
      ? "발권 gate 꺼짐(dispatch.json releaseGate) — 발권 없이도 배정합니다"
      : "일괄 확인을 하면 이때부터 발권한 FLIGHT만 배정합니다. 그 전까지는 발권 없이도 배정합니다";
  const k3Hold = data.k3Hold;
  const attested = Object.entries(data.attested);
  const candidates = data.filed.length + data.ready.length + data.proposals.length + data.unreleased.length;

  return (
    <div className="rl-screen">
      <h2 className="label">
        RELEASE <em>{gateNote}</em>
      </h2>
      {error && <p className="rl-error" role="alert">{error}</p>}
      {k3Hold && (
        <p className="faint rl-none" title="DISPATCH가 K3 줄이 있는 FLIGHT를 allow 없이 보내지 않는 장치(설정 창 K3 HOLD). 오작동: nuisance = 효과 없는 K3 줄에 걸려 hold됨, miss = allow 없이 떠난 K3 FLIGHT가 classifier 거부로 멈춤">
          K3 HOLD {k3Hold.mode} · 오작동 nuisance {k3Hold.nuisance.length} · miss {k3Hold.miss.length}
          {k3Hold.miss.length > 0 && ` (${k3Hold.miss.map((m) => `${m.flight}@${m.aircraft}`).join(", ")})`}
        </p>
      )}

      <section className="rl" aria-label="발권 순서">
        <h3 className="label">
          발권 순서 <em>{candidates ? `발권할 수 있는 ${candidates}건` : "발권할 것 없음"}</em>
        </h3>
        {candidates === 0 && <p className="faint rl-none">발권할 후보 없음 — DUTY REVIEW·SCHEDULE NEW가 올린 Backlog 제안, 막는 FLIGHT가 모두 끝난 Backlog 이슈, 발권 전 Todo가 여기 옵니다</p>}
        {data.unreleased.length > 0 && (
          <div className="rl-bar">
            <span className="faint">Todo {data.unreleased.length}건은 발권해야 DISPATCH가 배정합니다</span>
            {confirm ? (
              <span className="rl-confirm">
                <span>Todo {data.unreleased.length}개의 목표·완료 기준·K 효과를 승인하고 DISPATCH가 배정하게 합니다. 이 승인은 한 번이고 이후 사람 단계는 없습니다.</span>
                <button type="button" className="btn" disabled={busy !== null} onClick={releaseAll}>
                  {data.gate.on ? `${data.unreleased.length}개 발권` : `${data.unreleased.length}개 발권하고 gate 켜기`}
                </button>
                <button type="button" className="btn is-quiet" disabled={busy !== null} onClick={() => setConfirm(false)}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirm(true)}>
                모두 발권…
              </button>
            )}
          </div>
        )}
        {data.proposals.length > 0 && (
          <ul className="rl-list" aria-label="에이전트 제안">
            {data.proposals.map((p) => (
              <li key={p.id}>
                <b className="mono">{p.id}</b>
                <PriorityMark priority={p.priority} />
                <span className="rl-title" title={p.reason}>{p.title}</span>
                <span className="faint rl-kind">SCHEDULE NEW</span>
                <KEffects text={p.kEffects} />
                <a className="btn is-link" href="#home" title="아직 이슈가 아닙니다. HOME의 QUEUE에서 승인하면 Backlog 이슈가 생기고(SCHEDULE AUTO가 켜져 있으면 서버가 승인합니다), 그 뒤 이 화면의 제안 줄로 올라와 한 번의 클릭으로 발권합니다">
                  HOME에서 승인
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(data.tree ?? []).map((g) => (
        <Fold key={g.key ?? "other"} title={g.key ? `${g.key} ${g.title}` : g.title} label={g.key ? `${g.key} 그룹` : "상위 이슈 없는 이슈"} summary={`끝남 ${g.done}/${g.total}${g.next ? ` · 다음 발권: ${g.next}` : ""}`}>
          <ul className="rl-tree" aria-label={g.key ? `${g.key} 아래 이슈` : "상위 이슈 없는 이슈"}>
            {g.rows.map((r) => (
              <TreeNode key={r.key} row={r} busy={busy} discarding={discarding} reason={reason} setReason={setReason} setDiscarding={setDiscarding} fire={fireRow} discard={discardRow} />
            ))}
          </ul>
        </Fold>
      ))}

      {(data.kPending ?? []).length > 0 && (
        <section className="rl" aria-label="K 효과 확인">
          <h3 className="label">
            K 효과 확인 <em>{(data.kPending ?? []).length}건 — attested 발권만으로는 K 권한이 착륙까지 가지 않습니다</em>
          </h3>
          <ul className="rl-list">
            {(data.kPending ?? []).map((r) => (
              <li key={r.key}>
                <b>
                  <OpenFlight k={r.key} />
                </b>
                <span className="rl-title">{r.title ?? "—"}</span>
                <span className="faint rl-kind">
                  attested{r.session ? ` · ${r.session}` : ""}
                  {r.words ? ` · “${r.words.slice(0, 80)}”` : ""}
                </span>
                <KEffects text={r.kEffects} />
                <button type="button" className="btn" disabled={busy !== null} onClick={() => confirmK(r)} aria-label={`${r.key} K 효과 확인`}>
                  K 효과 확인
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rl" aria-label="최근 발권">
        <h3 className="label">
          최근 발권{" "}
          <em>
            7일 {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => `${CHANNEL_LABEL[c]} ${data.channels[c]}`).join(" · ")}
          </em>
        </h3>
        {data.recent.length === 0 ? (
          <p className="faint rl-none">발권 기록 없음</p>
        ) : (
          <ul className="rl-recent">
            {data.recent.map((r) => (
              <li key={`${r.key}-${r.at}`}>
                <b>
                  <OpenFlight k={r.key} />
                </b>
                <span className="rl-title">{r.title ?? "—"}</span>
                <span className="faint">
                  {CHANNEL_LABEL[r.channel]}
                  {r.via === "bulk" ? " · 일괄" : ""}
                  {r.session ? ` · ${r.session}` : ""}
                </span>
                <span className="faint mono">{clock(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {attested.length > 0 && (
          <p className="faint rl-attested" title="다른 세션이 SUPERVISOR의 말을 증언한 발권. 서버는 그 말을 확인할 수 없어 표본으로 확인한다">
            attested 발권(세션별): {attested.map(([s, n]) => `${s} ${n}`).join(" · ")}
          </p>
        )}
      </section>
    </div>
  );
}

// 상태 낱말: READY · Todo · 대기: ATC-n(흐리게) · FLIGHT 단계
function stateText(r: TreeRow): string {
  switch (r.state.kind) {
    case "ready":
      return "READY";
    case "todo":
      return r.released ? "Todo · 발권됨" : r.stale ? "Todo · 발권 뒤 내용이 바뀜" : r.why ? `Todo · 발권 거둠 — ${r.why}` : "Todo";
    case "waiting":
      return `대기: ${r.state.on.join(", ")}`;
    case "stage":
      return r.state.word;
  }
}

// 나무의 줄 하나와 그 밑의 막힌 이슈들(진짜 중첩 목록). 단추는 발권할 수 있는 줄에만
function TreeNode({ row: r, busy, discarding, reason, setReason, setDiscarding, fire, discard }: { row: TreeRow; busy: string | null; discarding: string | null; reason: string; setReason: (v: string) => void; setDiscarding: (k: string | null) => void; fire: (r: TreeRow) => void; discard: (r: TreeRow) => void }) {
  const faint = r.state.kind === "waiting" || r.state.kind === "stage";
  const noPriority = r.fire === "fire" && r.priority <= 0;
  return (
    <li className="rl-node">
      <div className={faint ? "rl-row is-faint" : "rl-row"}>
        <b>
          <OpenFlight k={r.key} />
        </b>
        <PriorityMark priority={r.priority} />
        <span className="rl-title">{r.title}</span>
        <span className={faint ? "faint rl-kind" : "rl-kind rl-state"}>{stateText(r)}</span>
        <span className="rl-sub">
          {r.filed && (
            <span className="rl-who" title="누가 언제 제안했나">
              제안 · {r.filed.by} · <span className="mono">{clock(r.filed.at)}</span>
            </span>
          )}
          {r.after && (
            <span className="rl-after" title="작업 지시서 `Sequence:` 줄: 순서의 선호이고 막지 않습니다. 발권할 수 있습니다">
              after <b className="mono">{r.after.key}</b>: {r.after.reason}
              {!r.after.known && " (알 수 없는 이슈, 순서에 쓰지 않음)"}
            </span>
          )}
          {r.sequenceProblem && !r.after && <span className="rl-warn">{r.sequenceProblem}</span>}
          {r.sameFiles.length > 0 && (
            <span className="rl-files" title="DISPATCH의 파일 겹침 자료: 날고 있거나 앞에 놓인 이슈가 같은 파일을 고칩니다">
              같은 파일: {r.sameFiles.join(", ")}
            </span>
          )}
          {r.fire && <KEffects text={r.kEffects} k3={r.k3} />}
          {noPriority && <span className="rl-warn">우선순위가 없어 Todo로 옮기지 않습니다(DISPATCH가 건너뜁니다). 먼저 정합니다</span>}
        </span>
        <span className="rl-acts">
          {r.fire && discarding === r.key ? (
            <>
              <input className="rl-reason" aria-label={`${r.key}를 버리는 사유`} placeholder="버리는 사유(선택)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy !== null} />
              <button type="button" className="btn" disabled={busy !== null} onClick={() => discard(r)}>
                버리기
              </button>
              <button type="button" className="btn is-quiet" disabled={busy !== null} onClick={() => { setDiscarding(null); setReason(""); }}>
                취소
              </button>
            </>
          ) : (
            r.fire && (
              <>
                {noPriority ? (
                  <a className="btn is-link" href={`#flight/${r.key}`} title="우선순위가 없으면 DISPATCH가 배정하지 않습니다. FLIGHT 서랍에서 먼저 정합니다">
                    우선순위 먼저
                  </a>
                ) : (
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => fire(r)} aria-label={`${r.key} 발권${r.fire === "fire" ? ": Todo로 옮기고 발권" : ""}`}>
                    발권
                  </button>
                )}
                {r.filed && (
                  <button type="button" className="btn is-quiet" disabled={busy !== null} onClick={() => { setDiscarding(r.key); setReason(""); }} aria-label={`${r.key} 버리기`} title="Canceled로 옮기고 사유를 이슈에 남깁니다">
                    버림…
                  </button>
                )}
              </>
            )
          )}
        </span>
      </div>
      {r.children.length > 0 && (
        <ul className="rl-tree" aria-label={`${r.key}가 막고 있는 이슈`}>
          {r.children.map((c) => (
            <TreeNode key={c.key} row={c} busy={busy} discarding={discarding} reason={reason} setReason={setReason} setDiscarding={setDiscarding} fire={fire} discard={discard} />
          ))}
        </ul>
      )}
    </li>
  );
}
