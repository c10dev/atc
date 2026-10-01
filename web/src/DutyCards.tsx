import { ChevronDown, ChevronRight } from "lucide-react";
import { Icon } from "./Icon.tsx";
import { useCallback, useEffect, useState } from "react";
import { type CardAction, actionsOf, cardKey, cardViewOf, queueHeadOf } from "../../server/duty-card.ts";
import type { ChatItem } from "../../server/duty-chat.ts";
import type { FleetProposal } from "../../server/fleet-plan.ts";
import type { QueueItem, SupervisorQueue } from "../../server/supervisor-queue.ts";
import { timeAgo } from "./derive.ts";
import { isManual, WILL_DO } from "./views/FleetPlan.tsx";
import "./Relay.css";

// DUTY 카드와 QUEUE 줄(ATC-230, docs/duty.md 3.2·4·5장 D3). 카드는 큐 줄 자체이고, 버튼은 이 화면이 기존 길을 부르는 것이다.
// DUTY는 버튼을 누르지 못한다. 서버에는 DUTY·atcctl이 부를 수 있는 승인·거절·머지·보내기 길이 없다(인라인 버튼의 길은 모두 Origin 검사).
export type Airports = readonly { name: string; code: string; repo: string }[];

// 지금의 SUPERVISOR QUEUE. 화면이 이미 받는 snapshot이 바뀔 때(refreshKey)와 카드가 생기거나 결정을 눌렀을 때만 다시 읽는다(새 폴링 없음)
export function useQueue(refreshKey: string, enabled: boolean): { queue: SupervisorQueue | null; reload: () => void } {
  const [queue, setQueue] = useState<SupervisorQueue | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/supervisor/queue")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((q: SupervisorQueue) => alive && setQueue(q))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey, enabled, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { queue, reload };
}

// 정해 둔 결정(D4): 켜져 있는 것, 확정한 초안, 버린 초안. 카드가 나올 때·화면 snapshot이 바뀔 때·버튼을 누른 뒤에만 읽는다
export interface DecisionsData {
  active: { id: string; at: string; text: string; until: string | null; from: string }[];
  confirmedDrafts: Record<string, string>;
  dismissed: string[];
}
export function useDecisions(refreshKey: string, enabled: boolean, extra: number): { data: DecisionsData | null; reload: () => void } {
  const [data, setData] = useState<DecisionsData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/duty/decisions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DecisionsData) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey, enabled, extra, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, reload };
}

// CHARTER REQUEST(D5): 줄에 선 요청과 카드에 보일 상태. 같은 시점에 읽는다
export interface ChartersData {
  mode: "off" | "shadow" | "on";
  charters: { id: string; from: string; state: { label: string; tone: "kept" | "queued" | "seen" } | null }[];
}
export function useCharters(refreshKey: string, enabled: boolean, extra: number): { data: ChartersData | null; reload: () => void } {
  const [data, setData] = useState<ChartersData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/duty/charters")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ChartersData) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey, enabled, extra, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, reload };
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = typeof data.error === "string" ? data.error : typeof data.why === "string" ? data.why : undefined;
    return { ok: res.ok && !data.error && data.started !== false, error: error ?? (res.ok ? undefined : `HTTP ${res.status}`), data };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e), data: {} };
  }
}

interface PlanRow extends FleetProposal {
  stale: boolean;
}
interface PlanBrief {
  mode: "shadow" | "approval";
  open: PlanRow[];
}

// FLEET PLAN 줄의 버튼. FLEET 탭과 같은 길(/verdict, /approve)을 부르고, 누르면 카드 안에서 한 번 확인한다
function FleetPlanButtons({ id, onDone }: { id: string; onDone: () => void }) {
  const [brief, setBrief] = useState<PlanBrief | null | "error">(null);
  const [ask, setAsk] = useState<"agree" | "disagree" | "approve" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/fleet/plan")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: PlanBrief) => alive && setBrief(b))
      .catch(() => alive && setBrief("error"));
    return () => {
      alive = false;
    };
  }, [id]);

  if (brief === null) return <span className="du-hint">불러오는 중…</span>;
  const row = brief === "error" ? undefined : brief.open.find((p) => p.id === id);
  if (brief === "error" || !row) return <a className="dr-btn" href="#fleet">FLEET에서 보기</a>;
  const approval = brief.mode === "approval";
  const manual = isManual(row);
  if (approval && manual) return <a className="dr-btn" href="#fleet">FLEET에서 보기</a>; // atc가 실행하지 않는 제안: FLEET 탭의 "했음"

  const run = async () => {
    if (!ask) return;
    setBusy(true);
    setErr(null);
    const r =
      ask === "approve"
        ? await post(`/api/fleet/plan/${encodeURIComponent(id)}/approve`, {})
        : await post(`/api/fleet/plan/${encodeURIComponent(id)}/verdict`, { verdict: ask, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) return void setErr(r.error ?? "실패");
    setAsk(null);
    onDone();
  };

  if (ask) {
    const text =
      ask === "approve"
        ? `${WILL_DO[row.kind](row)}. 기본 설정으로 실행합니다(세부 설정은 FLEET 탭).`
        : `${id} ${row.kind} ${row.aircraft ?? ""}에 ${approval ? "거절" : ask === "agree" ? "동의" : "반대"}합니다.`;
    return (
      <div className="du-confirm" role="group" aria-label={`${id} 확인`}>
        <p className="du-hint">{text}</p>
        {ask === "disagree" && (
          <input className="du-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="이유(선택)" aria-label="이유(선택)" maxLength={500} />
        )}
        <div className="du-actions">
          <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void run()}>
            확인
          </button>
          <button type="button" className="dr-btn" disabled={busy} onClick={() => (setAsk(null), setErr(null))}>
            취소
          </button>
        </div>
        {err && <p className="du-err">{err}</p>}
      </div>
    );
  }
  return (
    <>
      <div className="du-actions">
        <button type="button" className="dr-btn" onClick={() => setAsk("disagree")}>
          {approval ? "거절" : "반대"}
        </button>
        {approval ? (
          <button type="button" className="dr-btn is-primary" disabled={row.stale} title={row.stale ? "조건이 바뀜 — 다음 주기를 기다린다" : undefined} onClick={() => setAsk("approve")}>
            승인(실행)
          </button>
        ) : (
          <button type="button" className="dr-btn is-primary" onClick={() => setAsk("agree")}>
            동의
          </button>
        )}
      </div>
      {err && <p className="du-err">{err}</p>}
    </>
  );
}

// UPDATE: UPDATE 바와 같은 길(/api/update/start). 누르면 카드 안에서 한 번 확인한다
function UpdateButton({ onDone }: { onDone: () => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    const r = await post("/api/update/start", {});
    setBusy(false);
    if (!r.ok) return void setErr(r.error ?? "시작하지 못함");
    setAsk(false);
    onDone();
  };
  return (
    <>
      {ask ? (
        <div className="du-confirm" role="group" aria-label="업데이트 확인">
          <p className="du-hint">서비스를 새 버전으로 배포하고 재시작합니다.</p>
          <div className="du-actions">
            <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void run()}>
              확인
            </button>
            <button type="button" className="dr-btn" disabled={busy} onClick={() => (setAsk(false), setErr(null))}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="du-actions">
          <button type="button" className="dr-btn is-primary" onClick={() => setAsk(true)}>
            업데이트
          </button>
        </div>
      )}
      {err && <p className="du-err">{err}</p>}
    </>
  );
}

// UNDELIVERED(ATC-271): 닿지 못한 글을 손으로 전하는 카드. 글(복사)과 한 걸음(복사할 명령이나 할 일)을 보인다.
// "손으로 전했음"은 RELAY·CLEARANCE에만 있다(FLIGHT PLAN은 세션이 돌아오면 다시 나가고, 그때 큐에서 빠진다)
function CopyButton({ value, label, what }: { value: string; label: string; what: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="dr-btn"
      aria-label={`${what} 복사`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* 클립보드를 못 쓰면 글을 직접 복사한다 */
        }
      }}
    >
      {copied ? "복사됨" : label}
    </button>
  );
}

function HandDelivery({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const h = item.hand;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!h) return null;
  const markable = h.source === "RELAY" || h.source === "CLEARANCE";
  const mark = async () => {
    setBusy(true);
    setErr(null);
    const r = await post(h.source === "RELAY" ? `/api/relay/${encodeURIComponent(h.id)}/hand` : `/api/clearances/${encodeURIComponent(h.id)}/hand`, {});
    setBusy(false);
    if (!r.ok) return void setErr(r.error ?? "실패");
    onDone();
  };
  return (
    <div className="hd" role="group" aria-label={`${h.id} 손으로 전하기`}>
      <p className="hd-title">{h.card.title}</p>
      <p className="hd-how">{h.card.how}{h.text === null ? ". 보낼 글은 FLIGHT 카드의 DIRECT 지시서" : ""}</p>
      {h.card.command && <pre className="hd-cmd mono">{h.card.command}</pre>}
      {h.text && <pre className="hd-cmd mono">{h.text}</pre>}
      {(h.card.jobId || h.card.folder) && (
        <p className="hd-meta mono">
          {h.card.session ?? h.to}
          {h.card.jobId ? ` · job ${h.card.jobId}` : ""}
          {h.card.folder ? ` · ${h.card.folder}` : ""}
        </p>
      )}
      <div className="du-actions">
        {h.card.command && <CopyButton value={h.card.command} label="명령 복사" what="attach 명령" />}
        {h.text && <CopyButton value={h.text} label="글 복사" what="글" />}
        {h.card.step === "launch" && (
          <a className="dr-btn" href="#fleet">
            FLEET에서 LAUNCH
          </a>
        )}
        {markable && (
          <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void mark()}>
            손으로 전했음
          </button>
        )}
      </div>
      {err && <p className="du-err">{err}</p>}
    </div>
  );
}

// 카드와 QUEUE 줄이 같이 쓰는 버튼 칸
function Actions({ item, actions, onDone }: { item: QueueItem; actions: CardAction[]; onDone: () => void }) {
  return (
    <>
      {item.hand && <HandDelivery item={item} onDone={onDone} />}
      {actions.map((a, n) =>
        a.type === "link" ? (
          <div className="du-actions" key={n}>
            <a className="dr-btn" href={a.hash}>
              {a.label}
            </a>
          </div>
        ) : a.op === "fleet-plan" ? (
          <FleetPlanButtons key={n} id={item.key} onDone={onDone} />
        ) : (
          <UpdateButton key={n} onDone={onDone} />
        ),
      )}
    </>
  );
}

export interface CardCtx {
  items: readonly QueueItem[] | null;
  airports: Airports;
  handled: ReadonlySet<string>;
  markHandled: (key: string) => void;
  now: number;
  decisions: DecisionsData | null;
  reloadDecisions: () => void;
  charters: ChartersData | null;
  reloadCharters: () => void;
}

export function DutyCard({ it, ctx }: { it: Extract<ChatItem, { kind: "card" }>; ctx: CardCtx }) {
  const k = cardKey(it);
  const v = cardViewOf(it, ctx.items, ctx.handled.has(k), ctx.airports);
  if (v.state === "unknown") return <div className="du-card is-loading">큐를 읽는 중…</div>;
  if (v.state === "gone") {
    return (
      <div className="du-card is-gone" aria-label={`${it.queueKind} ${it.key} ${v.reason}`}>
        <div className="du-card-head">
          <span className="du-kind">{it.queueKind}</span>
          <span className="du-key mono">{it.key}</span>
        </div>
        <p className="du-gone">{v.reason}</p>
      </div>
    );
  }
  return (
    <div className="du-card" aria-label={`${v.item.kind} ${v.item.key}`}>
      <div className="du-card-head">
        <span className="du-kind">{v.item.kind}</span>
        <span className="du-since">{timeAgo(v.item.since, ctx.now)}</span>
      </div>
      <p className="du-card-title mono">{v.item.title}</p>
      <Actions item={v.item} actions={v.actions} onDone={() => ctx.markHandled(k)} />
    </div>
  );
}

// note·charter 초안. charter는 읽기만 하는 흐린 카드(확정은 D5). note는 SUPERVISOR가 확정하거나 버린다(D4): 확정은 decisions.jsonl에 적고,
// 버림은 초안에 버렸다는 줄만 붙인다. 버튼은 이 화면의 fetch(Origin 검사)이고 DUTY가 누를 수 없다
export function DraftCard({ it, ctx }: { it: Extract<ChatItem, { kind: "draft" }>; ctx: CardCtx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (it.draftKind === "retire") return <DecisionsCard it={it} ctx={ctx} />;
  const label = it.draftKind === "note" ? "NOTE" : "CHARTER REQUEST";
  const isCharter = it.draftKind === "charter";
  const queued = isCharter ? ctx.charters?.charters.find((c) => c.from === it.draft) : undefined;
  const sd = isCharter ? queued?.id : ctx.decisions?.confirmedDrafts[it.draft];
  const dismissed = ctx.decisions?.dismissed.includes(it.draft) ?? false;
  const expired = it.until !== null && Date.parse(it.until) <= ctx.now;
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setErr(null);
    const r = await post(path, body);
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "실패");
    ctx.reloadDecisions();
    ctx.reloadCharters();
  };
  const pending = (it.draftKind === "note" ? ctx.decisions !== null : ctx.decisions !== null && ctx.charters !== null) && !sd && !dismissed && !expired;
  const confirmPath = isCharter ? `/api/duty/charters/${encodeURIComponent(it.draft)}/confirm` : "/api/duty/decisions";
  const dismissPath = isCharter ? `/api/duty/charters/${encodeURIComponent(it.draft)}/dismiss` : `/api/duty/drafts/${encodeURIComponent(it.draft)}/dismiss`;
  return (
    <div className={`du-card is-draft${sd ? " is-confirmed" : ""}${dismissed || expired ? " is-gone" : ""}`} aria-label={`${it.draftKind} 초안 ${it.draft}`}>
      <div className="du-card-head">
        <span className="du-kind">{label}</span>
        <span className="du-key mono">{sd ?? it.draft}</span>
      </div>
      <p className="du-draft-text">{it.text}</p>
      {it.until && <p className="du-hint mono">until {it.until}</p>}
      {sd && !isCharter && <p className="du-hint">확정됨 · 이제 매 턴 맨 위에 실립니다</p>}
      {sd && isCharter && <p className="du-hint">확정됨 · {queued?.state?.label ?? "queued"}</p>}
      {dismissed && <p className="du-hint">버림</p>}
      {!sd && !dismissed && expired && <p className="du-hint">until이 지났습니다</p>}
      {pending && (
        <div className="du-actions">
          <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void act(confirmPath, isCharter ? {} : { draft: it.draft })}>
            확정
          </button>
          <button type="button" className="dr-btn" disabled={busy} onClick={() => void act(dismissPath, {})}>
            버림
          </button>
        </div>
      )}
      {err && <p className="du-err">{err}</p>}
    </div>
  );
}

// 정해 둔 결정의 목록 카드(`duty card DECISIONS retire`): 켜져 있는 결정마다 해제 버튼. 해제는 retire 줄을 적을 뿐이다
function DecisionsCard({ it, ctx }: { it: Extract<ChatItem, { kind: "draft" }>; ctx: CardCtx }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = ctx.decisions?.active ?? null;
  const retire = async (id: string) => {
    setBusy(id);
    setErr(null);
    const r = await post(`/api/duty/decisions/${encodeURIComponent(id)}/retire`, {});
    setBusy(null);
    if (!r.ok) setErr(r.error ?? "실패");
    ctx.reloadDecisions();
  };
  return (
    <div className="du-card is-decisions" aria-label={`정해 둔 결정 ${it.draft}`}>
      <div className="du-card-head">
        <span className="du-kind">STANDING DECISIONS</span>
        <span className="du-key mono">{list ? list.length : "…"}</span>
      </div>
      {list && list.length === 0 && <p className="du-hint">켜져 있는 결정이 없습니다</p>}
      <ul className="du-dec-list">
        {(list ?? []).map((d) => (
          <li key={d.id} className="du-dec">
            <p className="du-draft-text">
              <span className="mono du-key">{d.id}</span> {d.text}
            </p>
            {d.until && <p className="du-hint mono">until {d.until}</p>}
            <div className="du-actions">
              <button type="button" className="dr-btn" disabled={busy === d.id} onClick={() => void retire(d.id)}>
                해제
              </button>
            </div>
          </li>
        ))}
      </ul>
      {err && <p className="du-err">{err}</p>}
    </div>
  );
}

// 채팅 위의 접힌 QUEUE 줄. 펼치면 큐 전체를 보여 주고, 줄마다 카드와 같은 버튼이나 링크가 있다(DUTY가 말하지 않은 것도)
export function QueueRow({ queue, ctx }: { queue: SupervisorQueue | null; ctx: CardCtx }) {
  const [open, setOpen] = useState(false);
  if (!queue) return <div className="du-queue"><p className="du-queue-head mono">QUEUE …</p></div>;
  const items = queue.items.filter((i) => !ctx.handled.has(cardKey({ queueKind: i.kind, key: i.key })));
  return (
    <section className="du-queue" aria-label="SUPERVISOR QUEUE">
      <button type="button" className="du-queue-head mono" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon icon={open ? ChevronDown : ChevronRight} /> {queueHeadOf(queue.counts, items.length)}
      </button>
      {open && (
        <ul className="du-queue-list">
          {items.length === 0 && <li className="du-hint">기다리는 결정이 없습니다</li>}
          {items.map((i) => (
            <li key={`${i.kind}/${i.key}`} className="du-qrow">
              <div className="du-card-head">
                <span className="du-kind">{i.kind}</span>
                <span className="du-since">{timeAgo(i.since, ctx.now)}</span>
              </div>
              <p className="du-card-title mono">{i.title}</p>
              <Actions item={i} actions={actionsOf(i, ctx.airports)} onDone={() => ctx.markHandled(cardKey({ queueKind: i.kind, key: i.key }))} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
