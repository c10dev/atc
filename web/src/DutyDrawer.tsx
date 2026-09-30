import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Chat, type ChatItem, headLine } from "../../server/duty-chat.ts";
import { renderSafeMarkdown } from "../../server/safe-markdown.ts";
import { type Airports, type CardCtx, DraftCard, DutyCard, QueueRow, useDecisions, useQueue } from "./DutyCards.tsx";
import "./Drawer.css";
import "./DutyDrawer.css";

// DUTY 서랍(#duty, ATC-220, docs/duty.md 4장). 대화, 카드(ATC-230, D3), 채팅 위의 접힌 QUEUE 줄.
// 서랍 껍데기와 닫는 방법(Esc, 배경, ×, Back)은 FLIGHT·PR 서랍(Drawer.tsx)과 같다. DUTY의 글은 소리로 읽지 않는다.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX = 5 * 1024 * 1024;

function Md({ src }: { src: string }) {
  const html = useMemo(() => renderSafeMarkdown(src), [src]);
  return <div className="dr-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Item({ it, ctx }: { it: ChatItem; ctx: CardCtx }) {
  switch (it.kind) {
    case "user":
      return (
        <div className="du-msg du-user">
          <span className="du-who">SUPERVISOR</span>
          <p className="du-text">{it.text}</p>
          {it.image && <span className="du-img mono">▣ {it.image}</span>}
        </div>
      );
    case "text":
      return (
        <div className="du-msg du-duty">
          <span className="du-who">DUTY</span>
          <Md src={it.text} />
        </div>
      );
    case "tool":
      return (
        <div className={`du-tool mono${it.error ? " is-error" : ""}`}>
          ▸ {it.name}
          {it.summary && <> · {it.summary}</>}
          {it.error && <> · 거절됨</>}
        </div>
      );
    case "notice":
      return <div className="du-notice">{it.text}</div>;
    case "shift":
      return <div className="du-shift">— NEW SHIFT —</div>;
    case "card":
      return <DutyCard it={it} ctx={ctx} />;
    case "draft":
      return <DraftCard it={it} ctx={ctx} />;
  }
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; error?: string; queued?: boolean }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { error?: string; queued?: boolean };
    return { ok: res.ok, status: res.status, error: j.error ?? (res.ok ? undefined : `HTTP ${res.status}`), queued: j.queued };
  } catch (e) {
    return { ok: false, status: 0, error: String((e as Error).message ?? e) };
  }
}

const readBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export default function DutyDrawer({ chat, onClose, airports, refreshKey, now }: { chat: Chat; onClose: () => void; airports: Airports; refreshKey: string; now: number }) {
  const ref = useRef<HTMLElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 맨 아래를 보고 있을 때만 새 글을 따라 내려간다
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ mediaType: string; data: string; name: string } | null>(null);
  const [note, setNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [askShift, setAskShift] = useState(false);
  const st = chat.status;
  const thinking = st?.state === "thinking";
  // 카드와 QUEUE 줄이 읽는 지금의 큐. 새 카드가 오면 다시 읽는다
  const { queue, reload } = useQueue(refreshKey, st?.enabled === true);
  const cardCount = chat.items.filter((i) => i.kind === "card").length;
  useEffect(() => {
    if (cardCount > 0) reload();
  }, [cardCount, reload]);
  const draftCount = chat.items.filter((i) => i.kind === "draft").length;
  const { data: decisions, reload: reloadDecisions } = useDecisions(refreshKey, st?.enabled === true, draftCount);
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const ctx: CardCtx = {
    items: queue?.items ?? null,
    airports,
    handled,
    markHandled: (k) => {
      setHandled((h) => new Set(h).add(k));
      reload();
    },
    now,
    decisions,
    reloadDecisions,
  };

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.items.length, chat.streaming, thinking]);

  const send = async () => {
    const t = text.trim();
    if ((!t && !image) || busy) return;
    setBusy(true);
    setNote(null);
    const r = await post("/api/duty/message", { text: t, ...(image ? { image: { mediaType: image.mediaType, data: image.data } } : {}) });
    setBusy(false);
    if (!r.ok) return void setNote({ tone: "error", text: r.error ?? "보내지 못함" });
    setText("");
    setImage(null);
    stick.current = true;
    if (r.queued) setNote({ tone: "info", text: "DUTY is answering — 답이 끝나면 이어서 보냅니다" });
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => IMAGE_TYPES.includes(x.type));
    if (!f) return;
    e.preventDefault();
    if (f.size > IMAGE_MAX) return void setNote({ tone: "error", text: "그림이 너무 큽니다(최대 5MB)" });
    setImage({ mediaType: f.type, data: await readBase64(f), name: f.name || "붙인 그림" });
  };

  const newShift = async () => {
    setAskShift(false);
    const r = await post("/api/duty/new-shift", {});
    setNote(r.ok ? null : { tone: "error", text: r.error ?? "NEW SHIFT 실패" });
  };

  const off = st !== null && !st.enabled;
  return (
    <>
      <div className="dr-backdrop" onClick={onClose} />
      <aside className="dr dr-duty" role="dialog" aria-modal="true" aria-label="DUTY" tabIndex={-1} ref={ref}>
        <header className="du-head">
          <p className="dr-crumb mono du-title">{st ? headLine(st) : "DUTY"}</p>
          <div className="du-head-actions">
            <a className="dr-btn du-ideas" href="#ideas">
              IDEAS
            </a>
            {st?.enabled &&
              (askShift ? (
                <>
                  <span className="du-ask">지금 대화를 끝내고 새로 시작합니다.</span>
                  <button type="button" className="dr-btn is-primary" onClick={() => void newShift()}>
                    확인
                  </button>
                  <button type="button" className="dr-btn" onClick={() => setAskShift(false)}>
                    취소
                  </button>
                </>
              ) : (
                <button type="button" className="dr-btn" onClick={() => setAskShift(true)}>
                  NEW SHIFT
                </button>
              ))}
            <button className="dr-close du-close" onClick={onClose} aria-label="닫기">
              ×
            </button>
          </div>
        </header>

        {st === null && <p className="dr-note du-pad">불러오는 중…</p>}
        {off && <p className="dr-note du-pad">DUTY가 꺼져 있습니다. 설정 → OPERATIONS → DUTY에서 켭니다.</p>}
        {st?.enabled && (
          <>
            <QueueRow queue={queue} ctx={ctx} />
            <div
              className="du-log"
              ref={logRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {chat.items.length === 0 && !chat.streaming && <p className="dr-note">아직 대화가 없습니다. 아래에 써서 보내세요.</p>}
              {chat.items.map((it) => (
                <Item key={it.id} it={it} ctx={ctx} />
              ))}
              {chat.streaming && (
                <div className="du-msg du-duty is-streaming">
                  <span className="du-who">DUTY</span>
                  <p className="du-text">{chat.streaming}</p>
                </div>
              )}
              {thinking && !chat.streaming && <div className="du-thinking">DUTY가 답하는 중…</div>}
              {st.state === "down" && (
                <div className="du-notice is-error">
                  DUTY가 내려가 있습니다{st.error ? `: ${st.error}` : ""}.{st.blocked ? " 연달아 실패해 멈췄습니다. NEW SHIFT로 다시 시작합니다." : " 다음 글을 보내면 다시 띄웁니다."}
                </div>
              )}
            </div>

            <footer className="du-foot">
              {note && <p className={`du-note${note.tone === "error" ? " is-error" : ""}`}>{note.text}</p>}
              {st.queued > 0 && <p className="du-note">대기 중인 글 {st.queued}</p>}
              {image && (
                <p className="du-attach mono">
                  ▣ {image.name}{" "}
                  <button type="button" className="dr-btn" onClick={() => setImage(null)}>
                    빼기
                  </button>
                </p>
              )}
              <div className="du-input">
                <textarea
                  value={text}
                  rows={2}
                  placeholder="DUTY에게 — Enter 보내기, Shift+Enter 줄바꿈, 그림 붙여넣기"
                  aria-label="DUTY에게 보낼 글"
                  onChange={(e) => setText(e.target.value)}
                  onPaste={(e) => void onPaste(e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="du-buttons">
                  <button type="button" className="dr-btn is-primary" disabled={busy || st.blocked || (!text.trim() && !image)} onClick={() => void send()}>
                    보내기
                  </button>
                  {thinking && (
                    <button type="button" className="dr-btn du-stop" onClick={() => void post("/api/duty/stop", {})}>
                      중단
                    </button>
                  )}
                </div>
              </div>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
