import { useCallback, useEffect, useState } from "react";
import { type CardAction, actionsOf, cardKey, cardViewOf, queueHeadOf } from "../../server/duty-card.ts";
import type { ChatItem } from "../../server/duty-chat.ts";
import type { FleetProposal } from "../../server/fleet-plan.ts";
import type { QueueItem, SupervisorQueue } from "../../server/supervisor-queue.ts";
import { timeAgo } from "./derive.ts";
import { isManual, WILL_DO } from "./views/FleetPlan.tsx";

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

// 카드와 QUEUE 줄이 같이 쓰는 버튼 칸
function Actions({ item, actions, onDone }: { item: QueueItem; actions: CardAction[]; onDone: () => void }) {
  return (
    <>
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

// note·charter 초안: 읽기만 하는 흐린 카드. 확정은 뒤 단계다(버튼 없음)
export function DraftCard({ it }: { it: Extract<ChatItem, { kind: "draft" }> }) {
  return (
    <div className="du-card is-draft" aria-label={`${it.draftKind} 초안 ${it.draft}`}>
      <div className="du-card-head">
        <span className="du-kind">{it.draftKind === "note" ? "NOTE" : "CHARTER REQUEST"}</span>
        <span className="du-key mono">{it.draft}</span>
      </div>
      <p className="du-draft-text">{it.text}</p>
      {it.until && <p className="du-hint mono">until {it.until}</p>}
      <p className="du-hint">{it.draftKind === "note" ? "D4에서 확정" : "D5에서 확정"}</p>
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
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {queueHeadOf(queue.counts, items.length)}
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
