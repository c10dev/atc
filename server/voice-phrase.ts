import { callsign } from "./callsign.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";

// 음성 콜아웃의 문구(ATC-140, docs/guide/voice.md). 알림 종류마다 정해진 영어 관제 용어 틀에 콜사인과 FLIGHT 번호만 채운다(순수).
// 한국어 text와 자유 제목은 읽지 않는다. 그래서 화면이 서버에 글을 보낼 일이 없고, 서버는 알림의 key만 받아 같은 문구를 다시 만든다.
// 브라우저에서도 쓰므로 node 모듈을 끌어오지 않는다.

export const PHRASE_CHARS = /[^A-Za-z0-9 ,.'-]/g; // 엔진에 넘기는 글은 이 글자만
export const PHRASE_MAX = 200;

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];

// ATC-120 → "ATC one two zero", VOC-191 → "VOC one niner one". 모르는 모양이면 null
export function flightWords(key: string | null | undefined): string | null {
  const m = /^([A-Za-z]{2,10})-(\d{1,6})$/.exec((key ?? "").trim());
  return m ? `${m[1].toUpperCase()} ${[...m[2]].map((d) => DIGITS[Number(d)]).join(" ")}` : null;
}

const clean = (s: string) => s.replace(PHRASE_CHARS, " ").replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();

// "TEAM_G, TEAM_K" → "GOLF and KILO". 이름을 모르면(null) 빈 글
export function whoWords(aircraft: string | null | undefined): string {
  const names = (aircraft ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  const words = names.map((name) => clean(callsign({ name }))).filter(Boolean);
  return words.length <= 2 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

// key에서 종류를 읽는다: ALERT(alert|<kind>|…, health는 alert|health|<CODE>|…), PENDING(pending|<tool|proposal|humancheck>|…), RTS(rts|<at>|<result>)
export function kindOf(a: Pick<SupervisorAlert, "key">): string | null {
  const p = a.key.split("|");
  switch (p[0]) {
    case "alert":
      return p[1] === "health" ? (p[2] ? `health:${p[2]}` : null) : (p[1] ?? null);
    case "pending":
      return p[1] ? `pending:${p[1]}` : null;
    case "rts":
      return p[2] ? `rts:${p[2]}` : null;
    default:
      return null;
  }
}

const on = (flight: string | null) => (flight ? ` on ${flight}` : "");
const list = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ");

// 알림 하나의 문구. 틀이 없는 종류는 null(그 알림은 소리만 난다)
export function phraseOf(a: Pick<SupervisorAlert, "key" | "aircraft" | "flight">): string | null {
  const kind = kindOf(a);
  if (!kind) return null;
  const who = whoWords(a.aircraft);
  const flight = flightWords(a.flight);
  let phrase: string | null;
  switch (kind) {
    // WARNING
    case "conflict":
      phrase = `${list("Supervisor", who || null, `traffic conflict${on(flight)}`, "request instructions")}.`;
      break;
    case "stranded":
      phrase = `${list("Supervisor", flight ? `${flight} stranded` : "merge stranded", "merge not on main", "request instructions")}.`;
      break;
    case "rts:rollback":
      phrase = "Supervisor, return to service rolled back, request instructions.";
      break;
    case "rts:failed":
      phrase = "Supervisor, return to service failed, request instructions.";
      break;
    // CALL(SUPERVISOR를 기다리는 새 항목)
    case "pending:tool":
      phrase = `${list("Supervisor", who || null, "standing by for approval")}.`;
      break;
    case "pending:proposal":
      phrase = `Supervisor, dispatch proposal waiting${on(flight)}, request decision.`;
      break;
    case "pending:humancheck":
      phrase = `Supervisor, human check waiting${on(flight)}, request decision.`;
      break;
    // 지금은 CAUTION이라 소리 나지 않는다(음성은 WARNING·CALL만). 등급이 바뀌면 그대로 쓸 수 있게 틀만 둔다
    case "health:STALLED":
      phrase = `${list("Supervisor", who || null, `stalled${on(flight)}`, "request instructions")}.`;
      break;
    default:
      return null;
  }
  const out = clean(phrase).slice(0, PHRASE_MAX);
  return out || null;
}

// 음성 고르기 화면의 미리 듣기 문구(고정)
export const PREVIEW_PHRASE = "Supervisor, GOLF, radio check, how do you read.";
