import { useEffect, useMemo, useRef, useState } from "react";
import type { DrawerRef, IssueDetail, IssueRef, PrDetail } from "../../server/detail.ts";
import { renderSafeMarkdown } from "../../server/safe-markdown.ts";
import { flightNumber } from "./aviation.ts";
import { timeAgo } from "./derive.ts";
import "./Drawer.css";

// FLIGHT drawer(#flight/<KEY>)와 PR drawer(#pr/<AIRPORT>/<번호>): Linear 이슈와 GitHub PR을 읽기만 한다(DUTY G1).
type Load<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; message: string; off?: boolean };

function useDetail<T>(url: string): Load<T> {
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

function Md({ src }: { src: string }) {
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

function Flight({ k, now }: { k: string; now: number }) {
  const l = useDetail<IssueDetail>(`/api/flight/${k}/detail`);
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
          <dd>{d.state ?? "—"}</dd>
        </div>
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
            Linear에서 열기 ↗
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

type PrView = PrDetail & { airport: string };
function Pr({ airport, number, now }: { airport: string; number: number; now: number }) {
  const l = useDetail<PrView>(`/api/pr/${airport}/${number}/detail`);
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
            GitHub에서 열기 ↗
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

export default function Drawer({ target, onClose, now }: { target: DrawerRef; onClose: () => void; now: number }) {
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
        <button className="dr-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        {target.kind === "flight" ? <Flight k={target.key} now={now} /> : <Pr airport={target.airport} number={target.number} now={now} />}
      </aside>
    </>
  );
}
