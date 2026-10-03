import { X } from "lucide-react";
import { IconButton } from "./kit/Icon.tsx";
import { useRef, useState } from "react";
import { useDialog, useDocked } from "./kit/useDialog.ts";
import { type Chat, headLine } from "../../server/duty-chat.ts";
import { type Airports, QueueRow, waitingOf } from "./DutyCards.tsx";
import { DutyComposer, DutyGate, DutyLog, NewShift, useDutyChat } from "./DutyChat.tsx";
import "./Drawer.css";
import "./DutyDrawer.css";

// DUTY 서랍(#duty, ATC-220, docs/duty.md 4장). 대화·입력·NEW SHIFT는 공유 부품(DutyChat.tsx)이고, 이 파일은 서랍 틀이다(ATC-477).
// 서랍 껍데기와 닫는 방법(Esc, 배경, ×, Back)은 FLIGHT·PR 서랍(Drawer.tsx)과 같다. "화면" 단추는 같은 대화를 넓게 보는 #duty/screen을 연다.
export default function DutyDrawer({ chat, onClose, airports, refreshKey, now }: { chat: Chat; onClose: () => void; airports: Airports; refreshKey: string; now: number }) {
  const ref = useRef<HTMLElement>(null);
  const d = useDutyChat(chat, airports, refreshKey, now);
  const st = chat.status;
  const docked = useDocked();
  const [onlyWaiting, setOnlyWaiting] = useState(false); // "결정 n" 칩: 대화를 기다리는 카드만 본다
  const waiting = st?.enabled ? waitingOf(chat.items, d.ctx).length : 0;
  useDialog(ref, onClose, undefined, { trap: !docked, restore: false });

  return (
    <aside className="dr dr-duty" role="dialog" aria-modal={!docked} aria-label="DUTY" tabIndex={-1} ref={ref}>
      <header className="du-head">
        <p className="dr-crumb mono du-title">{st ? headLine(st) : "DUTY"}</p>
        <div className="du-head-actions">
          {st?.enabled && (
            <button type="button" className="chip" aria-pressed={onlyWaiting} aria-label={`결정 ${waiting}: 기다리는 카드만 보기`} onClick={() => setOnlyWaiting((v) => !v)}>
              결정 {waiting}
            </button>
          )}
          <a className="btn" href="#ideas">
            IDEAS
          </a>
          <a className="btn" href="#duty/screen">
            화면
          </a>
          <NewShift d={d} />
          <IconButton className="dr-close du-close" onClick={onClose} label="닫기" icon={X} size={16} />
        </div>
      </header>
      <DutyGate d={d} />
      {st?.enabled && (
        <>
          <QueueRow queue={d.queue} ctx={d.ctx} />
          <DutyLog d={d} waitingOnly={onlyWaiting} />
          <DutyComposer d={d} />
        </>
      )}
    </aside>
  );
}
