import type { AlertLevel } from "../../server/alert-level.ts";

// 화면 읽기 프로그램에 새 경보를 알리는 글(ATC-432). 계산만 하는 순수 함수: 읽는 쪽은 App.tsx의 두 live region이다.
// 폴링마다 읽히지 않게 "지난번에 없던 key"만 읽고, 처음 불러온 목록은 읽지 않는다(prev가 null). ADVISORY는 읽지 않는다.
export interface LiveAlert {
  key: string;
  level: AlertLevel;
  text: string;
}
export interface Announcement {
  polite: string; // CAUTION
  assertive: string; // WARNING만
}

const MAX_LISTED = 3;

export const liveKey = (a: { kind: string; ticketKey?: string; workspacePath?: string; sessionIds?: string[]; key?: string }): string =>
  [a.kind, a.key ?? "", a.ticketKey ?? "", a.workspacePath ?? "", (a.sessionIds ?? []).join(",")].join("|");

const sentence = (list: readonly LiveAlert[]): string => {
  if (!list.length) return "";
  const shown = list
    .slice(0, MAX_LISTED)
    .map((a) => a.text)
    .join("; ");
  const more = list.length > MAX_LISTED ? ` 외 ${list.length - MAX_LISTED}건` : "";
  return `새 경보 ${list.length}건: ${shown}${more}`;
};

export function announceNew(prev: ReadonlySet<string> | null, now: readonly LiveAlert[]): Announcement {
  if (!prev) return { polite: "", assertive: "" };
  const fresh = now.filter((a) => a.level !== "advisory" && !prev.has(a.key));
  return {
    assertive: sentence(fresh.filter((a) => a.level === "warning")),
    polite: sentence(fresh.filter((a) => a.level === "caution")),
  };
}

// 조치가 필요한 atc 알림(종 목록)의 수가 늘었을 때만. 줄거나 같으면 읽지 않는다
export function announceCount(prev: number | null, now: number): string {
  if (prev === null || now <= prev) return "";
  return `atc 알림 ${now}건, ${now - prev}건 늘었음`;
}
