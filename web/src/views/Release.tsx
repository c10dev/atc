import { type ReactNode, useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "../api.ts";
import "./Release.css";
import { timeAgo } from "../derive.ts";
import { Empty } from "../kit/Empty.tsx";
import { Fold } from "../kit/Fold.tsx";
import { Loading } from "../kit/Loading.tsx";
import { SectionHead, TodoRow } from "../kit/TodoRow.tsx";
import { partitionRelease, RELEASE_SECTIONS } from "../sidebar-rows.ts";

// RELEASE 화면(ATC-376, docs/layout.md Y1): SUPERVISOR가 화살을 쏘는 한 곳(`#release`).
// 후보(READY Backlog, 에이전트 제안) · 발권 없는 Todo · 최근 발권. 발권 기록은 ATC-362의 길 그대로이고, 이 화면의 클릭만 screen 발권을 만든다(서버가 Origin을 검사한다).
// 줄은 한 줄이다(design-language 4.1): 상태 태그 · FLIGHT · 제목(선언한 K 효과가 있으면 K 태그, 문제가 있으면 그 말) · 우선순위 · 단추. 줄을 열면 줄이 말하지 않은 것(K 효과 전문, 순서, 파일 겹침, 버리기)이 보인다.
// 사이드바는 구역 색인이다(후보 · Todo 발권 전 · 최근 발권): 고르면 `#release/<구역>`이 되고 이 화면이 그 구역으로 스크롤한다(ATC-423).

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
type StateWord = { kind: "ready" } | { kind: "parked" } | { kind: "todo" } | { kind: "waiting"; on: string[] } | { kind: "stage"; word: string };
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
  parked?: { by: string | null; createdAt: string | null; duplicateOf: string | null }; // PARKED 줄(ATC-487, duplicateOf: 비슷한 제목의 다른 이슈, ATC-488)
  missing?: { key: string; why: string; text: string; href: string | null }[]; // 기다리는 줄에서 이 화면의 줄이 아닌 막는 이슈(ATC-488)
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
  k3Relaunch?: { mode: "on" | "off"; approved: number; expired: number; rejected: number; stopOnly: { aircraft: string; proposal: string; t: string }[] };
  k3Hold?: { mode: "on" | "off"; nuisance: string[]; miss: { flight: string; aircraft: string; t: string }[]; waits?: { flight: string; id: string; t: string }[] };
  gate: { mode: "auto" | "on" | "off"; on: boolean; armedAt: string | null };
  ready: Row[];
  filed: Filed[];
  parked?: { on: boolean; rows: ParkedRow[]; fired: number; misfires: string[]; duplicate?: { on: boolean; refused: number; overrides: number; bothFired: number } };
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

// 선언한 K 효과: 없으면 없다고 적는다(빈 칸이 "효과 없음"으로 읽히지 않게)
function KFact({ text, k3 }: { text: string | null; k3?: K3Status | null }) {
  return (
    <>
      <Fact name="K 효과">{text ?? "선언 없음"}</Fact>
      {k3 && <Fact name="K3">{k3Text(k3)}</Fact>}
    </>
  );
}

// 줄 끝 칸: 우선순위 코드(Linear 1 긴급 … 4 낮음)를 글로. 색 칠한 배지는 쓰지 않는다(Craft 3.5). 없으면 "—"
const PRIO_CODE = ["—", "URG", "HIGH", "MED", "LOW"];
const prioOf = (p: number) => PRIO_CODE[p] ?? "—";

const STATE_TAG = { ready: "READY", parked: "PARKED", todo: "TODO", waiting: "대기" } as const;
const tagOf = (r: TreeRow) => (r.state.kind === "stage" ? r.state.word : STATE_TAG[r.state.kind]);

// 줄에서 한 마디로 말하는 문제("괜찮은가"에 아니오인 것). 없으면 null
function problemOf(r: TreeRow): string | null {
  if (r.fire === "fire" && r.priority <= 0) return "우선순위 없음";
  if (r.k3 && !r.k3.parses) return "K3 줄이 읽히지 않음";
  if (r.stale) return "발권 뒤 내용이 바뀜";
  if (r.why) return "발권을 거둠";
  return null;
}
// 상태를 한 문장으로(줄에서는 태그로만 말한 것)
function stateText(r: TreeRow): string {
  switch (r.state.kind) {
    case "ready":
      return "Backlog이고 막는 이슈가 모두 끝났습니다. 발권하면 Todo로 옮기고 발권을 기록합니다";
    case "todo":
      return r.released ? "Todo · 발권됨" : r.stale ? "Todo · 발권 뒤 내용이 바뀌어 다시 발권해야 합니다" : r.why ? `Todo · 발권을 거뒀습니다 — ${r.why}` : "Todo · 발권 전";
    case "parked":
      return "Backlog이고 막는 이슈가 없습니다. 발권하면 Todo로 옮기고 발권을 기록합니다. 두고 싶으면 그대로 둡니다(이 절은 아무것도 스스로 옮기지 않습니다)";
    case "waiting":
      return `${r.state.on.join(", ")}가 끝나야 풀립니다`;
    case "stage":
      return r.state.word;
  }
}

type FlatRow = TreeRow & { group: string | null };
const flatten = (rows: TreeRow[], group: string | null): FlatRow[] => rows.flatMap((r) => [{ ...r, group }, ...flatten(r.children, group)]);

interface Acts {
  busy: string | null;
  discarding: string | null;
  reason: string;
  setReason: (v: string) => void;
  setDiscarding: (k: string | null) => void;
  fire: (r: TreeRow) => void;
  discard: (r: TreeRow) => void;
}

// FLIGHT 줄 하나: 한 줄과 펼침. 단추는 발권할 수 있는 줄에만
function FlightRow({ row: r, open, toggle, acts }: { row: FlatRow; open: boolean; toggle: () => void; acts: Acts }) {
  const { busy, discarding, reason, setReason, setDiscarding, fire, discard } = acts;
  const problem = problemOf(r);
  const noPriority = r.fire === "fire" && r.priority <= 0;
  const action = r.fire ? (
    noPriority ? (
      <a className="btn" href={`#flight/${r.key}`} title="우선순위가 없으면 DISPATCH가 배정하지 않습니다. FLIGHT 서랍에서 먼저 정합니다">
        우선순위 먼저
      </a>
    ) : (
      <button type="button" className="btn is-primary" disabled={busy !== null} onClick={() => fire(r)} aria-label={`${r.key} 발권${r.fire === "fire" ? ": Todo로 옮기고 발권" : ""}`}>
        발권
      </button>
    )
  ) : null;
  return (
    <TodoRow
      tag={tagOf(r)}
      tone={problem ? "caution" : null}
      subject={r.key}
      need={
        <>
          {r.kEffects && (
            <span className="tag rls-k" title="이슈 본문 `## K effects`: 발권은 이 선언을 승인하는 것입니다">
              K
            </span>
          )}
          {r.title}
          {problem && <span className="rls-problem"> — {problem}</span>}
          {/* 기다리는 줄: 막는 이슈가 이 화면의 줄이 아니면 왜 없고 어디 있는지(ATC-488) */}
          {r.missing?.map((m) => (
            <span key={m.key} className="rls-missing faint">
              {" "}
              ·{" "}
              {m.href ? (
                <a href={m.href} {...(m.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} aria-label={`${m.key}: ${m.text}`}>
                  <span className="mono">{m.key}</span> {m.text}
                </a>
              ) : (
                <>
                  <span className="mono">{m.key}</span> {m.text}
                </>
              )}
            </span>
          ))}
          {r.parked?.duplicateOf && (
            <span className="rls-problem" title="제목이 비슷한 이슈가 있습니다. 정보일 뿐이고 아무것도 숨기거나 합치거나 취소하지 않습니다">
              {" "}
              — possible duplicate of <a href={`#flight/${r.parked.duplicateOf}`}>{r.parked.duplicateOf}</a>
            </span>
          )}
        </>
      }
      age={r.parked?.createdAt ? `${prioOf(r.priority)} · ${timeAgo(r.parked.createdAt, Date.now())}` : prioOf(r.priority)}
      open={open}
      onToggle={toggle}
      action={action}
      detail={
        <>
          <Fact name="상태">{stateText(r)}</Fact>
          {r.group && <Fact name="상위 이슈">{r.group}</Fact>}
          {r.fire && <KFact text={r.kEffects} k3={r.k3} />}
          {r.parked && <Fact name="올린 사람">{r.parked.by ?? "알 수 없음"}</Fact>}
          {r.filed && (
            <Fact name="제안">
              {r.filed.by} · <span className="mono">{clock(r.filed.at)}</span>
            </Fact>
          )}
          {r.after && (
            <Fact name="순서">
              <span title="작업 지시서 `Sequence:` 줄: 순서의 선호이고 막지 않습니다. 발권할 수 있습니다">
                after <span className="mono">{r.after.key}</span>: {r.after.reason}
                {!r.after.known && " (알 수 없는 이슈, 순서에 쓰지 않음)"}
              </span>
            </Fact>
          )}
          {r.sequenceProblem && !r.after && <Fact name="순서">{r.sequenceProblem}</Fact>}
          {r.sameFiles.length > 0 && <Fact name="같은 파일">{r.sameFiles.join(", ")}: 날고 있거나 앞에 놓인 이슈가 같은 파일을 고칩니다</Fact>}
          {noPriority && <Fact name="우선순위">없어서 Todo로 옮기지 않습니다(DISPATCH가 건너뜁니다). 먼저 정합니다</Fact>}
          <div className="rls-acts">
            <a className="btn" href={`#flight/${r.key}`}>
              FLIGHT 열기
            </a>
            {r.fire && r.filed && discarding !== r.key && (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => { setDiscarding(r.key); setReason(""); }} aria-label={`${r.key} 버리기`} title="Canceled로 옮기고 사유를 이슈에 남깁니다">
                버림…
              </button>
            )}
            {r.fire && discarding === r.key && (
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
        </>
      }
    />
  );
}

// 지금 주소의 구역으로 스크롤한다(#release/candidates …). 사이드바가 주소를 정한다
function useScrollToSection(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const sub = location.hash.replace(/^#/, "").split("/")[1] ?? "";
      if (!RELEASE_SECTIONS.some((s) => s.id === sub)) return;
      document.getElementById(`rls-${sub}`)?.scrollIntoView({ block: "start" });
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, [ready]);
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
  // `#release/parked` 링크(기다리는 줄의 "PARKED"): 접힌 PARKED 절을 열고 그리로 스크롤한다(ATC-488)
  useEffect(() => {
    const go = () => {
      if (location.hash !== "#release/parked") return;
      setParkedSignal((n) => n + 1);
      setTimeout(() => document.getElementById("rls-parked")?.scrollIntoView({ block: "start" }), 0);
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, []);
  useScrollToSection(loaded && data !== null);

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
  // READY Backlog와 제안은 Todo로 옮기며 발권(fire), 이미 Todo인 줄은 발권(release). 길은 이전과 같다
  const fireRow = (r: TreeRow) => run(r.key, () => send(r.fire === "release" ? "/api/releases" : "/api/releases/fire", { flight: r.key, hash: r.hash }));
  const discardRow = (r: TreeRow) =>
    run(r.key, async () => {
      await send("/api/releases/discard", { flight: r.key, hash: r.hash, reason });
      setDiscarding(null);
      setReason("");
    });
  const confirmK = (r: KPending) => run(`k-${r.key}`, () => send("/api/releases/k-confirm", { flight: r.key, hash: r.hash }));
  const releaseAll = () => run("all", () => send("/api/releases/bulk", { flights: data.unreleased.map((r) => ({ key: r.key, hash: r.hash })) }));
  const acts: Acts = { busy, discarding, reason, setReason, setDiscarding, fire: fireRow, discard: discardRow };

  // gate가 아직 꺼져 있으면(일괄 확인 전) 안내만: 지금은 발권 없이도 배정한다. 켜져 있으면(보통 상태) 줄을 두지 않는다(원칙 1·7)
  const gateNote =
    data.gate.mode === "off"
      ? "발권 gate 꺼짐(dispatch.json releaseGate) — 발권 없이도 배정합니다"
      : "일괄 확인을 하면 이때부터 발권한 FLIGHT만 배정합니다. 그 전까지는 발권 없이도 배정합니다";
  // K3 HOLD는 꺼졌거나 오작동이 센 때만 보인다(켜져 있고 0이면 보통 상태)
  const k3Hold = data.k3Hold && (data.k3Hold.mode !== "on" || data.k3Hold.nuisance.length > 0 || data.k3Hold.miss.length > 0 || (data.k3Hold.waits?.length ?? 0) > 0) ? data.k3Hold : null;
  // K3 RELAUNCH(ATC-509)는 켜졌거나 센 기록이 있는 때만 보인다(꺼져 있고 0이면 보통 상태)
  const k3Re = data.k3Relaunch && (data.k3Relaunch.mode === "on" || data.k3Relaunch.approved + data.k3Relaunch.expired + data.k3Relaunch.rejected + data.k3Relaunch.stopOnly.length > 0) ? data.k3Relaunch : null;
  const attested = Object.entries(data.attested);
  // 나무를 구역으로 가른다(사이드바 색인과 같은 함수). 나무의 그룹 이름은 줄의 펼침에서 말한다
  const part = partitionRelease((data.tree ?? []).map((g) => ({ rows: g.rows })));
  const groupOf = new Map<string, string | null>();
  for (const g of data.tree ?? []) for (const r of flatten(g.rows, g.key ? `${g.key} ${g.title}` : null)) groupOf.set(r.key, r.group);
  const withGroup = (r: TreeRow): FlatRow => ({ ...r, group: groupOf.get(r.key) ?? null });
  const candidates = part.candidates.map(withGroup);
  const unreleased = part.unreleased.map(withGroup);
  const rest = part.rest.map(withGroup);
  const row = (section: string, r: FlatRow) => {
    const id = `${section}/${r.key}`;
    const open = openKey === id;
    return <FlightRow key={id} row={r} open={open} toggle={() => setOpenKey(open ? null : id)} acts={acts} />;
  };
  const parked = data.parked?.on ? data.parked : null;
  const parkedRows: FlatRow[] = (parked?.rows ?? []).map((p) => ({
    key: p.key,
    title: p.title,
    priority: p.priority,
    state: { kind: "parked" },
    fire: "fire",
    released: false,
    after: p.sequence ? { key: p.sequence.after, reason: p.sequence.reason, known: true } : null,
    sequenceProblem: null,
    sameFiles: [],
    children: [],
    hash: p.hash,
    kEffects: p.kEffects,
    k3: p.k3,
    filed: null,
    why: null,
    stale: false,
    parked: { by: p.by, createdAt: p.createdAt, duplicateOf: p.duplicateOf ?? null },
    group: null,
  }));
  const kPending = data.kPending ?? [];
  const now = Date.now();
  const candidateCount = candidates.length + data.proposals.length;

  return (
    <div className="rls-screen">
      {!data.gate.on && <p className="rls-note faint">{gateNote}</p>}
      {error && <p className="rls-error" role="alert">{error}</p>}
      {k3Hold && (
        <p className="rls-note faint" title="DISPATCH가 K3 줄이 있는 FLIGHT를 allow 없이 보내지 않는 장치(설정 창 K3 HOLD). 오작동: nuisance = 효과 없는 K3 줄에 걸려 hold됨, miss = allow 없이 떠난 K3 FLIGHT가 classifier 거부로 멈춤, wait = LAUNCH 직전에 K3 entries를 못 만들어 기다린 launch 카드(ATC-506)">
          K3 HOLD {k3Hold.mode} · 오작동 nuisance {k3Hold.nuisance.length} · miss {k3Hold.miss.length} · wait {k3Hold.waits?.length ?? 0}
          {k3Hold.miss.length > 0 && ` (${k3Hold.miss.map((m) => `${m.flight}@${m.aircraft}`).join(", ")})`}
        </p>
      )}

      {k3Re && (
        <p className="rls-note faint" title="K3 FLIGHT를 받을 ABSENT AIRCRAFT가 없을 때 쉬는 AIRCRAFT를 멈추고 새로 띄우는 FLEET PLAN 카드(설정 창 K3 RELAUNCH). 7일: 승인 = 승인한 카드, 만료·반대 = 아무도 쓰지 않고 닫힌·반대한 카드, STOP만 = 멈췄는데 launch 카드 시한 안에 LAUNCH가 없음">
          K3 RELAUNCH {k3Re.mode} · 7일 승인 {k3Re.approved} · 만료 {k3Re.expired} · 반대 {k3Re.rejected} · STOP만 {k3Re.stopOnly.length}
          {k3Re.stopOnly.length > 0 && ` (${k3Re.stopOnly.map((m) => `${m.aircraft}·${m.proposal}`).join(", ")})`}
        </p>
      )}

      <section id="rls-candidates" className="rls-section" aria-label="후보">
        <SectionHead count={candidateCount}>후보</SectionHead>
        {candidateCount === 0 ? (
          <Empty>발권할 후보 없음 — DUTY REVIEW·SCHEDULE NEW가 올린 Backlog 제안, 막는 FLIGHT가 모두 끝난 Backlog 이슈가 여기 옵니다</Empty>
        ) : (
          <ul className="rls-rows" aria-label="후보">
            {candidates.map((r) => row("candidates", r))}
            {data.proposals.map((p) => {
              const id = `proposal/${p.id}`;
              const open = openKey === id;
              return (
                <TodoRow
                  key={id}
                  tag="SCHEDULE NEW"
                  subject={p.id}
                  need={
                    <>
                      {p.kEffects && <span className="tag rls-k">K</span>}
                      {p.title}
                    </>
                  }
                  age={prioOf(p.priority)}
                  open={open}
                  onToggle={() => setOpenKey(open ? null : id)}
                  action={
                    <a className="btn" href="#home">
                      HOME에서 승인
                    </a>
                  }
                  detail={
                    <>
                      <Fact name="상태">아직 이슈가 아닙니다. HOME의 QUEUE에서 승인하면 Backlog 이슈가 생기고(SCHEDULE AUTO가 켜져 있으면 서버가 승인합니다), 그 뒤 이 구역의 줄로 올라와 한 번의 클릭으로 발권합니다</Fact>
                      <Fact name="이유">{p.reason}</Fact>
                      <Fact name="K 효과">{p.kEffects ?? "선언 없음"}</Fact>
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
      </section>

      <section id="rls-unreleased" className="rls-section" aria-label="Todo 발권 전">
        <SectionHead count={unreleased.length}>Todo 발권 전</SectionHead>
        {unreleased.length === 0 ? (
          <Empty>발권 전 Todo 없음</Empty>
        ) : (
          <>
            <div className="rls-bar">
              {confirm ? (
                <>
                  <span className="rls-confirm">Todo {data.unreleased.length}개의 목표·완료 기준·K 효과를 승인하고 DISPATCH가 배정하게 합니다. 이 승인은 한 번이고 이후 사람 단계는 없습니다.</span>
                  <button type="button" className="btn is-primary" disabled={busy !== null} onClick={releaseAll}>
                    {data.gate.on ? `${data.unreleased.length}개 발권` : `${data.unreleased.length}개 발권하고 gate 켜기`}
                  </button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirm(false)}>
                    취소
                  </button>
                </>
              ) : (
                <>
                  <span />
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirm(true)}>
                    모두 발권…
                  </button>
                </>
              )}
            </div>
            <ul className="rls-rows" aria-label="Todo 발권 전">
              {unreleased.map((r) => row("unreleased", r))}
            </ul>
          </>
        )}
      </section>

      {kPending.length > 0 && (
        <section className="rls-section" aria-label="K 효과 확인">
          <SectionHead count={kPending.length}>K 효과 확인</SectionHead>
          <ul className="rls-rows" aria-label="K 효과 확인">
            {kPending.map((r) => {
              const id = `kpending/${r.key}`;
              const open = openKey === id;
              return (
                <TodoRow
                  key={id}
                  tag="K 확인"
                  tone="caution"
                  subject={r.key}
                  need={r.title ?? "—"}
                  age={timeAgo(r.at, now)}
                  open={open}
                  onToggle={() => setOpenKey(open ? null : id)}
                  action={
                    <button type="button" className="btn is-primary" disabled={busy !== null} onClick={() => confirmK(r)} aria-label={`${r.key} K 효과 확인`}>
                      K 효과 확인
                    </button>
                  }
                  detail={
                    <>
                      <Fact name="상태">attested 발권만으로는 K 권한이 착륙까지 가지 않습니다</Fact>
                      <Fact name="증언">
                        {r.session ?? "—"}
                        {r.words ? ` · “${r.words.slice(0, 80)}”` : ""}
                      </Fact>
                      <KFact text={r.kEffects} />
                      <div className="rls-acts">
                        <a className="btn" href={`#flight/${r.key}`}>
                          FLIGHT 열기
                        </a>
                      </div>
                    </>
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      <section id="rls-recent" className="rls-section" aria-label="최근 발권">
        <SectionHead count={data.recent.length}>최근 발권</SectionHead>
        <p className="rls-note faint">7일 {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => `${CHANNEL_LABEL[c]} ${data.channels[c]}`).join(" · ")}</p>
        {data.recent.length === 0 ? (
          <Empty>발권 기록 없음</Empty>
        ) : (
          <ul className="rls-rows" aria-label="최근 발권">
            {data.recent.map((r) => {
              const id = `recent/${r.key}-${r.at}`;
              const open = openKey === id;
              return (
                <TodoRow
                  key={id}
                  tag={CHANNEL_LABEL[r.channel]}
                  subject={r.key}
                  need={r.title ?? "—"}
                  age={timeAgo(r.at, now)}
                  open={open}
                  onToggle={() => setOpenKey(open ? null : id)}
                  action={
                    <a className="btn" href={`#flight/${r.key}`}>
                      FLIGHT 열기
                    </a>
                  }
                  detail={
                    <>
                      <Fact name="시각">
                        <span className="mono">{clock(r.at)}</span>
                        {r.via === "bulk" ? " · 일괄 발권" : ""}
                      </Fact>
                      {r.session && <Fact name="세션">{r.session}</Fact>}
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
        {attested.length > 0 && (
          <p className="rls-note faint" title="다른 세션이 SUPERVISOR의 말을 증언한 발권. 서버는 그 말을 확인할 수 없어 표본으로 확인한다">
            attested 발권(세션별): {attested.map(([s, n]) => `${s} ${n}`).join(" · ")}
          </p>
        )}
      </section>

      {parked && (
        <div id="rls-parked">
        <Fold title="PARKED" count={parkedRows.length} defaultOpen={false} openSignal={parkedSignal}>
          <p className="rls-note faint" title="막는 이슈 없이 손으로 올린 Backlog 이슈(상위 이슈 제외). 이 절은 아무것도 스스로 발권하거나 옮기지 않습니다. 오작동: 이 절에서 발권한 이슈가 24시간 안에 Canceled·Duplicate가 됨(설정 창 PARKED로 끕니다)">
            7일 이 절에서 발권 {parked.fired} · 24시간 안에 취소·중복 {parked.misfires.length}
            {parked.misfires.length > 0 && ` (${parked.misfires.join(", ")})`}
          </p>
          {parked.duplicate?.on && (parked.duplicate.overrides > 0 || parked.duplicate.bothFired > 0) && (
            <p className="rls-note faint" title="비슷한 제목 검사(설정 창 DUPLICATE TITLE). 넘김 = `--same-title-ok`로 거절을 뒤집은 수, 둘 다 발권 = 중복 표시가 있는 이슈를 쏘았는데 쌍도 이미 발권돼 있던 수">
              7일 중복 표시 · 거절 {parked.duplicate.refused} · 넘김 {parked.duplicate.overrides} · 둘 다 발권 {parked.duplicate.bothFired}
            </p>
          )}
          {parkedRows.length === 0 ? (
            <Empty>PARKED 이슈 없음</Empty>
          ) : (
            <ul className="rls-rows" aria-label="PARKED">
              {parkedRows.map((r) => row("parked", r))}
            </ul>
          )}
        </Fold>
        </div>
      )}

      {rest.length > 0 && (
        <Fold title="대기·진행 중" count={rest.length} defaultOpen={false}>
          <ul className="rls-rows" aria-label="대기·진행 중">
            {rest.map((r) => row("rest", r))}
          </ul>
        </Fold>
      )}
    </div>
  );
}
