import { ExternalLink } from "lucide-react";
import { Icon } from "../Icon.tsx";
import { useEffect, useRef, useState } from "react";

// 2b 켜기 점검표: 서버(/api/dispatch/brief의 readiness2b)가 준 항목을 보이기만 한다.
// 모드 전환은 SUPERVISOR가 위 버튼으로 한다. 이 점검표는 버튼을 막거나 바꾸지 않는다.

export type ReadinessStatus = "ready" | "not-ready" | "check";
export interface ReadinessItem {
  id: string; // gate, recall, send-guard, vocado-readback, readback-<code>(AIRPORT마다), stand-free, crew-change, known-gaps
  label: string;
  status: ReadinessStatus;
  detail: string;
  link?: string;
  suggestion?: string; // 다른 저장소 CLAUDE.md에 붙여 넣을 문장(detail 끝 "추가할 문장: …"과 같다)
}

// 색만으로 전하지 않게 기호와 글자를 같이 쓴다
const STATUS: Record<ReadinessStatus, { mark: string; text: string }> = {
  ready: { mark: "✓", text: "준비됨" },
  "not-ready": { mark: "✗", text: "안 됨" },
  check: { mark: "?", text: "확인 필요" },
};
// 모르는 상태 값은 확인 필요로 본다
const statusOf = (s: string): ReadinessStatus => (s in STATUS ? (s as ReadinessStatus) : "check");

// 붙여 넣을 문장. suggestion이 있으면 detail 끝의 "추가할 문장: …"을 떼고 따로 보인다.
// 옛 서버처럼 suggestion이 없으면 detail의 "추가할 문장:" 뒤를 문장으로 본다
const MARK = "추가할 문장:";
export function splitSuggestion(detail: string, suggestion?: string): { detail: string; text: string | null } {
  const at = detail.lastIndexOf(MARK);
  const head = at >= 0 ? detail.slice(0, at).trimEnd() : detail;
  const tail = at >= 0 ? detail.slice(at + MARK.length).trim() : "";
  if (suggestion) return { detail: head, text: suggestion };
  return tail ? { detail: head, text: tail } : { detail, text: null };
}

// 링크 글자: http면 호스트와 경로, 앱 안(#docs/…)이면 그대로
function linkText(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.hash}`;
  } catch {
    // 상대 경로
  }
  return href;
}
const external = (href: string) => /^https?:\/\//.test(href);

export function Readiness2b({ items, mode }: { items: ReadinessItem[]; mode: "shadow" | "approval" }) {
  const count = (s: ReadinessStatus) => items.filter((i) => statusOf(i.status) === s).length;
  const ready = count("ready");
  const allReady = items.length > 0 && ready === items.length;
  // 다 준비됐으면 접고, 하나라도 아니면 편다. 상태가 바뀌면 다시 맞춘다
  const [open, setOpen] = useState(!allReady);
  useEffect(() => setOpen(!allReady), [allReady]);
  if (!items.length) return null;

  const parts = (["not-ready", "check", "ready"] as const).filter((s) => count(s) > 0).map((s) => `${STATUS[s].text} ${count(s)}`);
  return (
    <details className={`dp-rd${allReady ? " is-ready" : ""}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="dp-rd-head">
        <span className="dp-rd-title">2b 켜기 점검표</span>
        <span className="dp-rd-sum">
          {allReady ? `✓ 모두 준비됨 ${ready}/${items.length}` : `${ready}/${items.length} 준비됨 · ${parts.filter((t) => !t.startsWith(STATUS.ready.text)).join(" · ")}`}
        </span>
      </summary>
      <p className="dp-rd-note">
        표시만 한다 — {mode === "shadow" ? "2b를 켜는 것" : "2a로 되돌리는 것"}은 SUPERVISOR가 위 버튼으로 한다. 점검표는 버튼을 막지 않는다.
      </p>
      <ul className="dp-rd-list">
        {items.map((i) => (
          <Item key={i.id} item={i} />
        ))}
      </ul>
    </details>
  );
}

function Item({ item }: { item: ReadinessItem }) {
  const s = statusOf(item.status);
  const { detail, text } = splitSuggestion(item.detail ?? "", item.suggestion);
  return (
    <li className={`dp-rd-item s-${s}`}>
      <span className="dp-rd-badge">
        <span aria-hidden>{STATUS[s].mark}</span> {STATUS[s].text}
      </span>
      <div className="dp-rd-body">
        <span className="dp-rd-label">{item.label}</span>
        {detail && <p className="dp-rd-detail">{detail}</p>}
        {text && <Paste label={item.label} text={text} />}
        {item.link && (
          <a
            className="dp-rd-link"
            href={item.link}
            title={item.link}
            aria-label={`${item.label} — ${linkText(item.link)}${external(item.link) ? " (새 탭)" : ""}`}
            {...(external(item.link) ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {linkText(item.link)}
            {external(item.link) && <> <Icon icon={ExternalLink} /></>}
          </a>
        )}
      </div>
    </li>
  );
}

// 다른 저장소 CLAUDE.md에 붙여 넣을 문장 + 복사 버튼.
// 클립보드를 못 쓰면 execCommand, 그것도 안 되면 문장을 선택해 두고 Ctrl+C를 안내한다.
function Paste({ label, text }: { label: string; text: string }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "ok" | "select">("idle");
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      const el = ref.current;
      const sel = getSelection();
      if (!el || !sel) return setState("select");
      sel.selectAllChildren(el);
      let ok = false;
      try {
        ok = document.execCommand?.("copy") ?? false;
      } catch {
        ok = false;
      }
      if (ok) sel.removeAllRanges();
      setState(ok ? "ok" : "select");
    }
  };
  return (
    <div className="dp-rd-paste">
      <span className="dp-rd-paste-head">CLAUDE.md에 붙여 넣을 문장</span>
      <code ref={ref} className="dp-rd-code">
        {text}
      </code>
      <div className="dp-rd-paste-act">
        <span className="dp-rd-copy-state" role="status" aria-live="polite">
          {state === "ok" ? "복사함" : state === "select" ? "문장을 선택해 둠 — Ctrl+C로 복사" : ""}
        </span>
        <button type="button" className="dp-btn dp-rd-copy" aria-label={`${label} — 붙여 넣을 문장 복사`} onClick={copy}>
          복사
        </button>
      </div>
    </div>
  );
}
