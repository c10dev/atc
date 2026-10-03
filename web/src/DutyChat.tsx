import { ChevronRight } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./kit/Icon.tsx";
import { Loading } from "./kit/Loading.tsx";
import type { Chat, ChatItem } from "../../server/duty-chat.ts";
import type { Handled } from "../../server/duty-card-status.ts";
import { choicesOf, foldTools, leadOf, matchesQuery, nextStick, scrollTopAfterResize, toolLabel } from "../../server/duty-view.ts";
import { renderSafeMarkdown } from "../../server/safe-markdown.ts";
import { type Airports, type CardCtx, DecisionChip, DraftCard, DutyCard, useCharters, useDecisions, useQueue, waitingOf } from "./DutyCards.tsx";
import "./Drawer.css";
import "./DutyDrawer.css";
import "./DutyChat.css";
import { apiSend } from "./api.ts";

// DUTY 대화의 공유 부품(ATC-477, docs/duty-screen.md 3.1). 로그, 입력, NEW SHIFT, 카드 맥락(context hook)을 한 곳에 두고
// 서랍(DutyDrawer.tsx)과 화면(views/DutyScreen.tsx)은 이것을 두른 틀일 뿐이다. DUTY의 글은 소리로 읽지 않는다.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const IMAGE_MAX = 5 * 1024 * 1024;

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; error?: string; queued?: boolean }> {
  try {
    const res = await apiSend("POST", path, body);
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

export interface DutyChatState {
  chat: Chat;
  ctx: CardCtx;
  queue: ReturnType<typeof useQueue>["queue"];
  thinking: boolean;
  text: string;
  setText: (t: string) => void;
  image: { mediaType: string; data: string; name: string } | null;
  setImage: (i: DutyChatState["image"]) => void;
  note: { tone: "info" | "error"; text: string } | null;
  busy: boolean;
  askShift: boolean;
  setAskShift: (v: boolean) => void;
  stick: RefObject<boolean>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  send: () => Promise<void>;
  onPaste: (e: React.ClipboardEvent) => Promise<void>;
  newShift: () => Promise<void>;
  stop: () => void;
  fill: (choice: string) => void;
}

// 서랍과 화면이 같이 쓰는 상태: 큐·결정·CHARTER를 읽는 hook, 보내기, NEW SHIFT, 그림 붙이기
export function useDutyChat(chat: Chat, airports: Airports, refreshKey: string, now: number): DutyChatState {
  const stick = useRef(true); // 맨 아래를 보고 있을 때만 새 글을 따라 내려간다
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<DutyChatState["image"]>(null);
  const [note, setNote] = useState<DutyChatState["note"]>(null);
  const [busy, setBusy] = useState(false);
  const [askShift, setAskShift] = useState(false);
  const st = chat.status;
  const thinking = st?.state === "thinking";
  const { queue, reload } = useQueue(refreshKey, st?.enabled === true);
  const cardCount = chat.items.filter((i) => i.kind === "card").length;
  useEffect(() => {
    if (cardCount > 0) reload();
  }, [cardCount, reload]);
  const draftCount = chat.items.filter((i) => i.kind === "draft").length;
  const { data: decisions, reload: reloadDecisions } = useDecisions(refreshKey, st?.enabled === true, draftCount);
  const { data: charters, reload: reloadCharters } = useCharters(refreshKey, st?.enabled === true, draftCount);
  const [handled, setHandled] = useState<Readonly<Record<string, Handled>>>({});
  const ctx: CardCtx = {
    items: queue?.items ?? null,
    airports,
    status: { items: queue?.items ?? null, handled, decisions, charters, nowMs: now },
    markHandled: (k, outcome) => {
      setHandled((h) => ({ ...h, [k]: { outcome, at: new Date().toISOString() } }));
      reload();
    },
    now,
    decisions,
    reloadDecisions,
    charters,
    reloadCharters,
  };

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
  // choices 버튼: 입력창을 채울 뿐 보내지 않는다. 보내기는 SUPERVISOR의 Enter(또는 보내기 버튼)다
  const fill = (choice: string) => {
    setText(text.trim() === "" ? choice : `${text.replace(/\s+$/, "")}\n${choice}`);
    inputRef.current?.focus();
  };
  return { chat, ctx, queue, thinking, text, setText, image, setImage, note, busy, askShift, setAskShift, stick, inputRef, send, onPaste, newShift, stop: () => void post("/api/duty/stop", {}), fill };
}

function Md({ src }: { src: string }) {
  const html = useMemo(() => renderSafeMarkdown(src), [src]);
  return <div className="dr-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// DUTY의 답: 3줄 머리 + 접은 나머지(leadOf), 끝의 choices 블록은 버튼. 보이는 글에서 choices 펜스는 걷어 낸다
function Answer({ src, live, fill }: { src: string; live: boolean; fill: (c: string) => void }) {
  const { text, choices } = useMemo(() => choicesOf(src), [src]);
  const { lead, rest } = useMemo(() => leadOf(text), [text]);
  return (
    <>
      <Md src={lead} />
      {rest && (
        <details className="du-more">
          <summary className="chip">더 보기</summary>
          <Md src={rest} />
        </details>
      )}
      {live && choices.length > 0 && (
        <div className="du-choices" role="group" aria-label="DUTY가 고르라는 답 — 누르면 입력창에 채워집니다">
          {choices.map((c, i) => (
            <button key={i} type="button" className="chip" onClick={() => fill(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const utcTime = (t: string) => (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t) ? `${t.slice(11, 16)}Z` : "");

function Item({ it, ctx, live, fill, chips, onGo }: { it: ChatItem; ctx: CardCtx; live: boolean; fill: (c: string) => void; chips: boolean; onGo: (id: string) => void }) {
  switch (it.kind) {
    case "user":
      return (
        <div className="du-msg du-user" id={`du-${it.id}`} title={it.t}>
          <span className="du-who">SUPERVISOR</span>
          <p className="du-text">{it.text}</p>
          {it.image && <span className="du-img mono">▣ {it.image}</span>}
        </div>
      );
    case "text":
      return (
        <div className="du-msg du-duty" id={`du-${it.id}`}>
          <span className="du-who">
            DUTY <time className="du-time mono" dateTime={it.t} title={it.t}>{utcTime(it.t)}</time>
          </span>
          <Answer src={it.text} live={live} fill={fill} />
        </div>
      );
    case "notice":
      return <div className="du-notice">{it.text}</div>;
    case "shift":
      return (
        <div className="du-shift" id={`du-${it.id}`}>
          — NEW SHIFT —
        </div>
      );
    case "card":
      return chips ? <DecisionChip it={it} ctx={ctx} onGo={onGo} /> : <DutyCard it={it} ctx={ctx} />;
    case "draft":
      // 화면에서는 결정을 기다리는 초안도 chip 한 줄이다. 정해 둔 결정 목록 카드(retire)는 패널에 앉지 않으므로 그대로 둔다
      return chips && it.draftKind !== "retire" ? <DecisionChip it={it} ctx={ctx} onGo={onGo} /> : <DraftCard it={it} ctx={ctx} />;
    case "tool":
      return null; // 도구 줄은 foldTools가 턴마다 묶어 낸다
  }
}

// 대화 로그. 맨 아래에 붙어 있으면(stick) 새 글과 창 크기 변화를 따라 내려간다. 높이는 틀의 CSS 배치가 정하고 여기서 재지 않는다
// cards: 카드를 대화 속에 어떻게 두는가. "inline"(서랍)은 작은 카드 그대로, "chips"(화면)는 한 줄 chip이고 카드는 오른쪽 패널에 있다.
// waitingOnly(서랍의 "결정 n" 칩): 대화를 기다리는 카드만 보인다. onGo: chip을 누르면 패널의 그 카드로 간다
export function DutyLog({ d, filter = "", cards = "inline", waitingOnly = false, onGo = () => {} }: { d: DutyChatState; filter?: string; cards?: "inline" | "chips"; waitingOnly?: boolean; onGo?: (id: string) => void }) {
  const { chat, ctx, thinking, stick } = d;
  const st = chat.status;
  const logRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const searching = filter.trim() !== "" || waitingOnly;
  const waitingIds = useMemo(() => (waitingOnly ? new Set(waitingOf(chat.items, ctx).map((i) => i.id)) : null), [waitingOnly, chat.items, ctx]);
  const items = useMemo(() => {
    const byWaiting = waitingIds ? chat.items.filter((i) => waitingIds.has(i.id)) : chat.items;
    return filter.trim() !== "" ? byWaiting.filter((i) => matchesQuery(i, filter)) : byWaiting;
  }, [chat.items, filter, waitingIds]);
  const rows = useMemo(() => (searching ? items.map((it) => ({ kind: "item" as const, it })) : foldTools(items, thinking)), [items, thinking, searching]);
  const lastUser = items.reduce((n, it, i) => (it.kind === "user" ? i : n), -1);
  const lastText = items.reduce((n, it, i) => (it.kind === "text" ? i : n), -1);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.items.length, chat.streaming, thinking, stick]);

  // 틀의 크기(창 크기)와 안쪽 길이가 바뀌면 붙어 있던 로그는 다시 맨 아래로 간다. 크기 때문에 브라우저가 scrollTop을 자르며 내는 스크롤 이벤트는 붙음 상태를 바꾸지 않는다
  useEffect(() => {
    const el = logRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      resizing.current = true;
      const to = scrollTopAfterResize(stick.current, el);
      if (to !== null) el.scrollTop = to;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => (resizing.current = false));
    });
    ro.observe(el);
    ro.observe(inner);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [stick]);

  return (
    <div className="du-log" ref={logRef} onScroll={(e) => void (stick.current = nextStick(stick.current, e.currentTarget, resizing.current))}>
      <div className="du-log-inner" ref={innerRef}>
        {chat.items.length === 0 && !chat.streaming && <p className="dr-note">아직 대화가 없습니다. 아래에 써서 보내세요.</p>}
        {searching && items.length === 0 && <p className="dr-note">{waitingOnly ? "기다리는 카드가 없습니다." : "불러온 줄에 없습니다."}</p>}
        {rows.map((r) => {
          if (r.kind === "tools") {
            return (
              <details key={r.id} className={`du-tool mono${r.refused > 0 ? " is-error" : ""}`}>
                <summary>
                  <Icon icon={ChevronRight} /> {toolLabel(r)}
                  {r.running && <> · {r.running} 실행 중</>}
                </summary>
                <ul>
                  {r.items.map((t) => (
                    <li key={t.id} className={t.error ? "is-error" : undefined}>
                      {t.name}
                      {t.summary && <> · {t.summary}</>}
                      {t.error && <> · 거절됨</>}
                    </li>
                  ))}
                </ul>
              </details>
            );
          }
          const idx = items.indexOf(r.it);
          return <Item key={r.it.id} it={r.it} ctx={ctx} live={r.it.kind === "text" && idx === lastText && idx > lastUser} fill={d.fill} chips={cards === "chips"} onGo={onGo} />;
        })}
        {chat.streaming && (
          <div className="du-msg du-duty is-streaming">
            <span className="du-who">DUTY</span>
            <p className="du-text">{chat.streaming}</p>
          </div>
        )}
        {thinking && !chat.streaming && <Loading className="du-thinking">DUTY가 답하는 중…</Loading>}
        {st?.state === "down" && (
          <div className="du-notice is-error">
            DUTY가 내려가 있습니다{st.error ? `: ${st.error}` : ""}.{st.blocked ? " 연달아 실패해 멈췄습니다. NEW SHIFT로 다시 시작합니다." : " 다음 글을 보내면 다시 띄웁니다."}
          </div>
        )}
      </div>
    </div>
  );
}

// 입력. Enter로 보낸다(choices·자동완성은 채우기만 한다)
export function DutyComposer({ d }: { d: DutyChatState }) {
  const st = d.chat.status;
  if (!st?.enabled) return null;
  return (
    <footer className="du-foot">
      {d.note && <p className={`du-note${d.note.tone === "error" ? " is-error" : ""}`}>{d.note.text}</p>}
      {st.queued > 0 && <p className="du-note">대기 중인 글 {st.queued}</p>}
      {d.image && (
        <p className="du-attach mono">
          ▣ {d.image.name}{" "}
          <button type="button" className="btn" onClick={() => d.setImage(null)}>
            빼기
          </button>
        </p>
      )}
      <div className="du-input">
        <textarea
          ref={d.inputRef}
          value={d.text}
          rows={2}
          placeholder="DUTY에게 — Enter 보내기, Shift+Enter 줄바꿈, 그림 붙여넣기"
          aria-label="DUTY에게 보낼 글"
          onChange={(e) => d.setText(e.target.value)}
          onPaste={(e) => void d.onPaste(e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void d.send();
            }
          }}
        />
        <div className="du-buttons">
          <button type="button" className="btn is-primary" disabled={d.busy || st.blocked || (!d.text.trim() && !d.image)} onClick={() => void d.send()}>
            보내기
          </button>
          {d.thinking && (
            <button type="button" className="btn du-stop" onClick={d.stop}>
              중단
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}

// NEW SHIFT 단추와 확인 줄. 틀의 머리 줄에 놓는다
export function NewShift({ d }: { d: DutyChatState }) {
  if (!d.chat.status?.enabled) return null;
  return d.askShift ? (
    <>
      <span className="du-ask">지금 대화를 끝내고 새로 시작합니다.</span>
      <button type="button" className="btn is-primary" onClick={() => void d.newShift()}>
        확인
      </button>
      <button type="button" className="btn" onClick={() => d.setAskShift(false)}>
        취소
      </button>
    </>
  ) : (
    <button type="button" className="btn" onClick={() => d.setAskShift(true)}>
      NEW SHIFT
    </button>
  );
}

// 꺼짐·불러오는 중 안내. 켜져 있으면 null
export function DutyGate({ d }: { d: DutyChatState }) {
  const st = d.chat.status;
  if (st === null) return <p className="dr-note du-pad">불러오는 중…</p>;
  if (!st.enabled) return <p className="dr-note du-pad">DUTY가 꺼져 있습니다. 설정 → OPERATIONS → DUTY에서 켭니다.</p>;
  return null;
}

