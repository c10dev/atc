import { ExternalLink, X } from "lucide-react";
import { Icon, IconButton } from "./Icon.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawerRef, IssueDetail, IssueRef, PrDetail } from "../../server/detail.ts";
import type { MergeInfo } from "../../server/pr-merge.ts";
import { renderSafeMarkdown } from "../../server/safe-markdown.ts";
import { RelayBox } from "./Relay.tsx";
import { flightNumber } from "./aviation.ts";
import { timeAgo } from "./derive.ts";
import "./Drawer.css";

// FLIGHT drawer(#flight/<KEY>)와 PR drawer(#pr/<AIRPORT>/<번호>): Linear 이슈와 GitHub PR을 읽기만 한다(DUTY G1).
export type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; message: string; off?: boolean };

export function useDetail<T>(url: string): Load<T> {
  const [r, setR] = useState<{ url: string; v: Load<T> } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(url, { signal: ctl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        setR({ url, v: res.ok ? { state: "ok", data: body as T } : { state: "error", message: String(body.error ?? `HTTP ${res.status}`), off: body.off === true } });
      })
      .catch((e) => void (!ctl.signal.aborted && setR({ url, v: { state: "error", message: String(e?.message ?? e) } })));
    return () => ctl.abort();
  }, [url]);
  return r?.url === url ? r.v : { state: "loading" };
}

export function Md({ src }: { src: string }) {
  const html = useMemo(() => renderSafeMarkdown(src), [src]);
  return <div className="dr-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const PRIORITY = ["없음", "긴급", "높음", "보통", "낮음"];

function RefList({ label, items }: { label: string; items: IssueRef[] }) {
  if (!items.length) return null;
  return (
    <div className="dr-row">
      <dt>{label}</dt>
      <dd>
        <ul className="dr-refs">
          {items.map((r) => (
            <li key={r.key} className={r.stateType === "completed" || r.stateType === "canceled" ? "is-done" : ""}>
              <a href={`#flight/${r.key}`} className="mono">
                {flightNumber(r.key)}
              </a>{" "}
              <span>{r.title}</span> <span className="faint">{r.state ?? ""}</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

// 상태 버튼(DUTY G3): SUPERVISOR의 클릭 하나가 Linear 상태를 옮긴다. 누르면 한 번 더 묻고, 서버는 지금 상태가 아직 from일 때만 옮긴다(아니면 409)
function StateMove({ d, onMoved }: { d: IssueDetail; onMoved: () => void }) {
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!d.state || d.moves.length === 0) return null;
  const go = async (to: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/flight/${d.key}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: d.state, to }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      setAsk(null);
      onMoved();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setAsk(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dr-row">
      <dt>상태 이동</dt>
      <dd className="dr-move">
        {ask === null ? (
          d.moves.map((m) => (
            <button key={m.name} type="button" className={`dr-btn${d.ready && m.type === "unstarted" ? " is-primary" : ""}`} disabled={busy} onClick={() => setAsk(m.name)}>
              {m.name}로
            </button>
          ))
        ) : (
          <>
            <span>
              {d.state} → <b>{ask}</b> 로 옮긴다. Linear에 바로 쓴다.
            </span>
            <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void go(ask)}>
              {busy ? "옮기는 중…" : "확인"}
            </button>
            <button type="button" className="dr-btn" disabled={busy} onClick={() => setAsk(null)}>
              취소
            </button>
          </>
        )}
        {err && <span className="dr-error">{err}</span>}
      </dd>
    </div>
  );
}

// FOLLOW 토글(ATC-276): 하위 이슈가 있는 이슈를 FOLLOW 탭에 올리고 내린다. 목록은 서버의 follow.json
function FollowToggle({ k }: { k: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/follow/list")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { parents?: string[] } | null) => live && setOn(b ? Boolean(b.parents?.includes(k)) : null))
      .catch(() => live && setOn(null));
    return () => {
      live = false;
    };
  }, [k]);
  if (on === null) return null;
  const toggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/follow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parent: k, on: !on }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      setOn(!on);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dr-row">
      <dt>FOLLOW</dt>
      <dd className="dr-move">
        <button type="button" className={`dr-btn${on ? "" : " is-primary"}`} disabled={busy} onClick={() => void toggle()} aria-pressed={on}>
          {on ? "FOLLOWING ✓" : "FOLLOW"}
        </button>
        {on && (
          <a href="#follow" className="faint">
            FOLLOW 탭 열기
          </a>
        )}
        {err && <span className="dr-error">{err}</span>}
      </dd>
    </div>
  );
}

function Flight({ k, now }: { k: string; now: number }) {
  const [rev, setRev] = useState(0);
  const l = useDetail<IssueDetail>(`/api/flight/${k}/detail${rev ? `?r=${rev}` : ""}`);
  if (l.state === "loading") return <p className="dr-note">불러오는 중…</p>;
  if (l.state === "error") return <p className="dr-note dr-error">{l.message}</p>;
  const d = l.data;
  return (
    <>
      <p className="dr-crumb mono">FLIGHT {flightNumber(d.key)}</p>
      <h2 className="dr-title">{d.title}</h2>
      <dl className="dr-meta">
        <div className="dr-row">
          <dt>상태</dt>
          <dd>
            {d.state ?? "—"}
            {d.ready && (
              <span className="dr-chip dr-ready" title="막는 FLIGHT가 모두 Done 또는 Canceled">
                READY
              </span>
            )}
          </dd>
        </div>
        <StateMove d={d} onMoved={() => setRev((n) => n + 1)} />
        {d.children.length > 0 && <FollowToggle k={d.key} />}
        <div className="dr-row">
          <dt>우선순위</dt>
          <dd>{PRIORITY[d.priority] ?? "—"}</dd>
        </div>
        {d.assignee && (
          <div className="dr-row">
            <dt>담당</dt>
            <dd>{d.assignee}</dd>
          </div>
        )}
        {d.project && (
          <div className="dr-row">
            <dt>프로젝트</dt>
            <dd>{d.project}</dd>
          </div>
        )}
        {d.labels.length > 0 && (
          <div className="dr-row">
            <dt>라벨</dt>
            <dd className="dr-chips">
              {d.labels.map((x) => (
                <span key={x} className="dr-chip">
                  {x}
                </span>
              ))}
            </dd>
          </div>
        )}
        <RefList label="막는 FLIGHT" items={d.blockedBy} />
        <RefList label="막고 있는 FLIGHT" items={d.blocks} />
        <RefList label="상위" items={d.parent ? [d.parent] : []} />
        <RefList label="하위" items={d.children} />
        {d.prs.length > 0 && (
          <div className="dr-row">
            <dt>PR</dt>
            <dd>
              <ul className="dr-refs">
                {d.prs.map((p) => (
                  <li key={p.url}>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {p.url.replace(/^https?:\/\/github\.com\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {d.url && (
        <p className="dr-ext">
          <a href={d.url} target="_blank" rel="noreferrer">
            Linear에서 열기 <Icon icon={ExternalLink} />
          </a>
        </p>
      )}
      <h3 className="dr-h">본문</h3>
      {d.description ? <Md src={d.description} /> : <p className="dr-note">본문 없음</p>}
      {d.descriptionTruncated && <p className="dr-note">본문이 길어 앞부분만 보인다.</p>}
      <h3 className="dr-h">댓글 {d.comments.length}</h3>
      {d.comments.length === 0 && <p className="dr-note">댓글 없음</p>}
      {d.comments.map((c, i) => (
        <article key={i} className="dr-comment">
          <header>
            <b>{c.author ?? "—"}</b> <span className="faint">{c.at ? timeAgo(c.at, now) : ""}</span>
          </header>
          <Md src={c.body} />
          {c.truncated && <p className="dr-note">길어 앞부분만 보인다.</p>}
        </article>
      ))}
    </>
  );
}

const CHECK_MARK = { pass: "✓", fail: "✗", pending: "…", skipped: "–" } as const;

type PrView = PrDetail & { airport: string; merge: MergeInfo | null; relay: { to: string | null; suggested: boolean; flight: string | null; pr: number; text: string | null; type: "GO AROUND" | "FIX" | null; stand: string | null } | null };

// MERGE(DUTY G2): SUPERVISOR의 클릭 하나가 user 등급 CLEARED PR을 화면이 보여 준 head 그대로 머지한다. 누르면 등급·head·방식을 보이고 한 번 더 묻는다.
// 서버는 눌린 뒤 지금 GitHub 자료로 다시 판정한다(head가 움직였으면 409와 새 head)
function MergeRow({ d, airport, note, onDone }: { d: PrView; airport: string; note: { ok: boolean; text: string } | null; onDone: (n: { ok: boolean; text: string }) => void }) {
  const m = d.merge;
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  // 후보(user 등급이거나 MCC가 ESCALATE)일 때만 이 줄을 낸다. auto·flagged는 MCC의 몫이라 버튼도 까닭도 없다
  if (!m || d.state !== "OPEN" || !(m.tier === "user" || m.escalated)) return null;
  const go = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/pr/${airport}/${d.number}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ head: m.head }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      onDone({ ok: true, text: `머지했다 · ${m.head.slice(0, 7)} · ${m.method}` });
    } catch (e) {
      onDone({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setAsk(false);
      setBusy(false);
    }
  };
  return (
    <div className="dr-row">
      <dt>MERGE</dt>
      <dd className="dr-move">
        {note?.ok ? (
          <span className="dr-ok">{note.text}</span>
        ) : !m.allowed ? (
          <span className="faint">{m.why}</span>
        ) : !ask ? (
          <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => setAsk(true)}>
            MERGE…
          </button>
        ) : (
          <>
            <span>
              TIER <b>{m.escalated && m.tier !== "user" ? `${m.tier} (ESCALATE)` : m.tier}</b> · head <b className="mono">{m.head.slice(0, 7)}</b> · {m.method} 방식. GitHub에 바로 머지한다.
            </span>
            <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void go()}>
              {busy ? "머지하는 중…" : "머지 확인"}
            </button>
            <button type="button" className="dr-btn" disabled={busy} onClick={() => setAsk(false)}>
              취소
            </button>
          </>
        )}
        {note && !note.ok && <span className="dr-error">{note.text}</span>}
      </dd>
    </div>
  );
}

function Pr({ airport, number, now }: { airport: string; number: number; now: number }) {
  const [rev, setRev] = useState(0);
  // 머지했다는 알림은 다시 읽는 동안에도 남긴다(서랍이 다시 그려져도 사라지지 않게 여기 둔다)
  const [merged, setMerged] = useState<{ ok: boolean; text: string } | null>(null);
  const l = useDetail<PrView>(`/api/pr/${airport}/${number}/detail${rev ? `?r=${rev}` : ""}`);
  if (l.state === "loading") return <p className="dr-note">불러오는 중…</p>;
  if (l.state === "error") return <p className="dr-note dr-error">{l.off ? "GitHub이 꺼져 있어 PR을 읽지 못한다. " : ""}{l.message}</p>;
  const d = l.data;
  const failing = d.checks.filter((c) => c.state === "fail").length;
  const pending = d.checks.filter((c) => c.state === "pending").length;
  return (
    <>
      <p className="dr-crumb mono">
        {airport} PR #{d.number}
        {d.ticketKey && (
          <>
            {" · "}
            <a href={`#flight/${d.ticketKey}`}>{flightNumber(d.ticketKey)}</a>
          </>
        )}
      </p>
      <h2 className="dr-title">{d.title}</h2>
      <dl className="dr-meta">
        <div className="dr-row">
          <dt>상태</dt>
          <dd>
            {d.state}
            {d.draft ? " · Draft" : ""}
          </dd>
        </div>
        <div className="dr-row">
          <dt>브랜치</dt>
          <dd className="mono">
            {d.branch} → {d.base}
          </dd>
        </div>
        {d.author && (
          <div className="dr-row">
            <dt>작성</dt>
            <dd>
              {d.author} <span className="faint">{d.createdAt ? timeAgo(d.createdAt, now) : ""}</span>
            </dd>
          </div>
        )}
        {d.landing && (
          <>
            <div className="dr-row">
              <dt>착륙</dt>
              <dd>
                {d.landing.state}
                {d.landing.tier && <span className={`dr-chip tier-${d.landing.tier}`}>TIER {d.landing.tier}</span>}
                {d.landing.blocks.length > 0 && (
                  <ul className="dr-refs">
                    {d.landing.blocks.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {d.landing.inspection && (
              <div className="dr-row">
                <dt>MCC INSPECTION</dt>
                <dd>
                  {d.landing.inspection.verdict}
                  {d.landing.inspection.verdict !== "pass" && ` · P0 ${d.landing.inspection.p0} · P1 ${d.landing.inspection.p1} · P2 ${d.landing.inspection.p2}`}{" "}
                  <span className="faint">{timeAgo(d.landing.inspection.at, now)}</span>
                </dd>
              </div>
            )}
          </>
        )}
        <MergeRow d={d} airport={airport} note={merged} onDone={(n) => (setMerged(n), setRev((x) => x + 1))} />
        {(d.relay?.to || d.relay?.suggested) && d.state === "OPEN" && (
          <div className="dr-row">
            <dt>RELAY</dt>
            <dd>
              <RelayBox to={d.relay.to} editableTo={d.relay.suggested} type={d.relay.type} stand={d.relay.stand} flight={d.relay.flight} pr={d.relay.pr} text={d.relay.text} btnClass="dr-btn" />
              {d.relay.text && <span className="faint">{d.relay.type === "GO AROUND" ? " TOWER의 GO AROUND 글이 채워진다" : " 리뷰 지적의 FIX 글이 채워진다"}</span>}
              {d.relay.suggested && <span className="faint"> · 이 STAND를 쥔 AIRCRAFT가 없다{d.relay.to ? ` — ${d.relay.to}가 이 FLIGHT를 날았다` : ""}</span>}
            </dd>
          </div>
        )}
        <div className="dr-row">
          <dt>리뷰</dt>
          <dd>{d.reviewDecision ?? "결정 없음"}</dd>
        </div>
        {d.labels.length > 0 && (
          <div className="dr-row">
            <dt>라벨</dt>
            <dd className="dr-chips">
              {d.labels.map((x) => (
                <span key={x} className="dr-chip">
                  {x}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      {d.url && (
        <p className="dr-ext">
          <a href={d.url} target="_blank" rel="noreferrer">
            GitHub에서 열기 <Icon icon={ExternalLink} />
          </a>
        </p>
      )}
      <h3 className="dr-h">
        체크 {d.checks.length}
        {failing > 0 && <span className="dr-bad"> · 실패 {failing}</span>}
        {pending > 0 && <span className="faint"> · 진행 {pending}</span>}
      </h3>
      {d.checks.length === 0 ? (
        <p className="dr-note">체크 없음</p>
      ) : (
        <ul className="dr-checks">
          {d.checks.map((c) => (
            <li key={c.name} className={`is-${c.state}`}>
              <span aria-hidden="true">{CHECK_MARK[c.state]}</span> {c.name} <span className="faint">{c.state}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="dr-h">본문</h3>
      {d.body ? <Md src={d.body} /> : <p className="dr-note">본문 없음</p>}
      {d.bodyTruncated && <p className="dr-note">본문이 길어 앞부분만 보인다.</p>}
      <h3 className="dr-h">바뀐 파일 {d.filesTotal}</h3>
      <ul className="dr-files mono">
        {d.files.map((f) => (
          <li key={f.path}>
            <span>{f.path}</span>{" "}
            <span className="dr-add">+{f.additions}</span> <span className="dr-del">−{f.deletions}</span>
          </li>
        ))}
      </ul>
      {d.filesTotal > d.files.length && <p className="dr-note">앞의 {d.files.length}개만 보인다.</p>}
    </>
  );
}

export default function Drawer({ target, onClose, now }: { target: Extract<DrawerRef, { kind: "flight" | "pr" }>; onClose: () => void; now: number }) {
  const ref = useRef<HTMLElement>(null);
  const id = target.kind === "flight" ? target.key : `${target.airport}/${target.number}`;
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [id, onClose]);
  return (
    <>
      <div className="dr-backdrop" onClick={onClose} />
      <aside className="dr" role="dialog" aria-modal="true" aria-label={target.kind === "flight" ? `FLIGHT ${target.key}` : `PR ${target.number}`} tabIndex={-1} ref={ref}>
        <IconButton className="dr-close" onClick={onClose} label="닫기" icon={X} size={16} />
        {target.kind === "flight" ? <Flight k={target.key} now={now} /> : <Pr airport={target.airport} number={target.number} now={now} />}
      </aside>
    </>
  );
}
