import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { Icon, IconButton } from "./Icon.tsx";
import { useEffect, useRef, useState } from "react";
import type { DrawerRef } from "../../server/detail.ts";
import type { IdeaDetail, IdeaRow } from "../../server/ideas.ts";
import { timeAgo } from "./derive.ts";
import { Md, useDetail } from "./Drawer.tsx";
import "./Drawer.css";

// IDEAS 서랍(#ideas, #ideas/<번호>, DUTY G4): atc 저장소의 열린 idea 이슈를 읽기만 한다. 서랍 껍데기와 닫는 방법은 FLIGHT·PR 서랍과 같다.
// ADOPT는 서버가 만든 고정 문구를 DUTY에 보낸다(기존 /api/duty/message). GitHub에는 아무것도 쓰지 않는다.
type Target = Extract<DrawerRef, { kind: "ideas" | "idea" }>;
// DUTY 켜짐 여부: null이면 아직 모른다
export type DutyGate = { enabled: boolean | null; blocked: boolean };

function List({ now }: { now: number }) {
  const l = useDetail<{ repo: string; ideas: IdeaRow[] }>("/api/ideas");
  if (l.state === "loading") return <p className="dr-note">불러오는 중…</p>;
  if (l.state === "error") return <p className="dr-note dr-error">{l.off ? "GitHub이 꺼져 있어 idea를 읽지 못한다. " : ""}{l.message}</p>;
  const { ideas, repo } = l.data;
  return (
    <>
      <p className="dr-crumb mono">IDEAS · {repo}</p>
      <h2 className="dr-title">열린 idea {ideas.length}</h2>
      {ideas.length === 0 && <p className="dr-note">idea 라벨이 붙은 열린 이슈가 없다.</p>}
      <ul className="id-list">
        {ideas.map((i) => (
          <li key={i.number}>
            <a className="id-item" href={`#ideas/${i.number}`}>
              <span className="id-head">
                <b className="mono">#{i.number}</b> <span className="id-title">{i.title}</span>
              </span>
              <span className="id-meta faint">
                {i.updatedAt ? timeAgo(i.updatedAt, now) : "—"} · 댓글 {i.comments}
                {i.labels.filter((x) => x !== "idea").map((x) => (
                  <span key={x} className="dr-chip">
                    {x}
                  </span>
                ))}
              </span>
              {i.preview && <span className="id-preview">{i.preview}</span>}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

// ADOPT: 한 번 묻고, 확인하면 DUTY에 보낸다. DUTY가 꺼져 있으면 까닭만 보인다
function Adopt({ d, gate }: { d: IdeaDetail; gate: DutyGate }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const why = gate.enabled === null ? "DUTY 상태를 읽는 중" : !gate.enabled ? "DUTY가 꺼져 있습니다(설정 → DUTY)" : gate.blocked ? "DUTY가 멈춰 있습니다(NEW SHIFT로 다시 시작)" : null;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/duty/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: d.adopt }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      location.hash = "#duty";
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setAsk(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dr-row">
      <dt>ADOPT</dt>
      <dd className="dr-move">
        {why ? (
          <span className="faint">{why}</span>
        ) : !ask ? (
          <button type="button" className="dr-btn is-primary" onClick={() => setAsk(true)}>
            ADOPT…
          </button>
        ) : (
          <>
            <span>DUTY에게 이 idea의 설계 개요(문제, 확인할 사실, 원칙, 단계)를 청한다. 채팅에서만 답하고 파일은 쓰지 않는다. 한 번 답하는 만큼 FUEL을 쓴다.</span>
            <button type="button" className="dr-btn is-primary" disabled={busy} onClick={() => void go()}>
              {busy ? "보내는 중…" : "보내기"}
            </button>
            <button type="button" className="dr-btn" disabled={busy} onClick={() => setAsk(false)}>
              취소
            </button>
          </>
        )}
        {err && <span className="dr-error">{err}</span>}
      </dd>
    </div>
  );
}

function One({ n, now, gate }: { n: number; now: number; gate: DutyGate }) {
  const l = useDetail<IdeaDetail>(`/api/ideas/${n}`);
  if (l.state === "loading") return <p className="dr-note">불러오는 중…</p>;
  if (l.state === "error")
    return (
      <>
        <p className="dr-crumb mono">
          <a href="#ideas"><Icon icon={ArrowLeft} /> IDEAS</a>
        </p>
        <p className="dr-note dr-error">{l.off ? "GitHub이 꺼져 있어 idea를 읽지 못한다. " : ""}{l.message}</p>
      </>
    );
  const d = l.data;
  return (
    <>
      <p className="dr-crumb mono">
        <a href="#ideas"><Icon icon={ArrowLeft} /> IDEAS</a> · #{d.number}
      </p>
      <h2 className="dr-title">{d.title}</h2>
      <dl className="dr-meta">
        {d.author && (
          <div className="dr-row">
            <dt>작성</dt>
            <dd>
              {d.author} <span className="faint">{d.createdAt ? timeAgo(d.createdAt, now) : ""}</span>
            </dd>
          </div>
        )}
        {d.updatedAt && (
          <div className="dr-row">
            <dt>갱신</dt>
            <dd>{timeAgo(d.updatedAt, now)}</dd>
          </div>
        )}
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
        <Adopt d={d} gate={gate} />
      </dl>
      {d.url && (
        <p className="dr-ext">
          <a href={d.url} target="_blank" rel="noreferrer">
            <Icon icon={ExternalLink} /> GitHub
          </a>
        </p>
      )}
      <h3 className="dr-h">본문</h3>
      {d.body ? <Md src={d.body} /> : <p className="dr-note">본문 없음</p>}
      {d.bodyTruncated && <p className="dr-note">본문이 길어 앞부분만 보인다.</p>}
      <h3 className="dr-h">댓글 {d.commentsTotal}</h3>
      {d.commentsTotal === 0 && <p className="dr-note">댓글 없음</p>}
      {d.comments.map((c, i) => (
        <article key={i} className="dr-comment">
          <header>
            <b>{c.author ?? "—"}</b> <span className="faint">{c.at ? timeAgo(c.at, now) : ""}</span>
          </header>
          <Md src={c.body} />
          {c.truncated && <p className="dr-note">길어 앞부분만 보인다.</p>}
        </article>
      ))}
      {d.commentsTotal > d.comments.length && <p className="dr-note">앞의 {d.comments.length}개만 보인다. 나머지는 GitHub에서 본다.</p>}
    </>
  );
}

export default function IdeasDrawer({ target, onClose, now, gate }: { target: Target; onClose: () => void; now: number; gate: DutyGate }) {
  const ref = useRef<HTMLElement>(null);
  const id = target.kind === "idea" ? String(target.number) : "list";
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
      <aside className="dr" role="dialog" aria-modal="true" aria-label={target.kind === "idea" ? `IDEA #${target.number}` : "IDEAS"} tabIndex={-1} ref={ref}>
        <IconButton className="dr-close" onClick={onClose} label="닫기" icon={X} size={16} />
        {target.kind === "idea" ? <One n={target.number} now={now} gate={gate} /> : <List now={now} />}
      </aside>
    </>
  );
}
