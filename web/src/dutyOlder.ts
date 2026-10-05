import { useCallback, useEffect, useRef, useState } from "react";
import { type Chat, type ChatItem, olderItems } from "../../server/duty-chat.ts";
import type { DutyLogLine } from "../../server/duty-log.ts";
import { apiGet } from "./api.ts";

// 앞쪽 기록 불러오기(ATC-479). 맨 처음 200줄은 useDuty가 읽고(chat.older가 그 앞의 before), 이 hook은 그 앞쪽 쪽들을 GET /api/duty/history?before=로 이어 붙인다.
// 이어 붙인 항목(items)은 chat.items 앞에 놓인다. 재연결로 chat.older가 바뀌면 맨 끝이 달라진 것이므로 처음부터 다시 쌓는다.
type Page = { lines: (DutyLogLine & { n: number })[]; next: number | null };

export interface Older {
  items: ChatItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  // 줄 번호 n이 보이도록 거기까지 한꺼번에 불러온다(검색 결과로 갈 때). 이미 불러왔으면 아무것도 하지 않는다
  loadTo: (n: number) => Promise<void>;
}

export function useOlder(chat: Chat): Older {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(chat.older);
  const [loading, setLoading] = useState(false);
  const base = chat.older;
  const busy = useRef(false);
  const state = useRef({ cursor, base });
  state.current = { cursor, base };

  useEffect(() => {
    setItems([]);
    setCursor(base);
  }, [base]);

  const read = useCallback(async (before: number, limit?: number): Promise<Page | null> => {
    try {
      const r = await apiGet(`/api/duty/history?before=${before}${limit ? `&limit=${limit}` : ""}`);
      return r.ok ? ((await r.json()) as Page) : null;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(
    async (limit: (cur: number) => number | undefined) => {
      if (busy.current) return;
      const cur = state.current.cursor;
      if (cur === null) return;
      const from = state.current.base;
      busy.current = true;
      setLoading(true);
      const page = await read(cur, limit(cur));
      busy.current = false;
      setLoading(false);
      if (!page || state.current.base !== from) return; // 그 사이 재연결로 바뀌었으면 버린다
      state.current.cursor = page.next; // 되풀이하는 loadTo가 다음 렌더를 기다리지 않고 읽는다
      setItems((prev) => [...olderItems(page.lines), ...prev]);
      setCursor(page.next);
    },
    [read],
  );

  const loadMore = useCallback(() => load(() => undefined), [load]);
  const loadTo = useCallback(
    async (n: number) => {
      // 목표 줄보다 조금 더 앞(맥락)까지. 한 번에 읽는 줄 수의 위는 서버가 정하므로 모자라면 되풀이한다
      const want = Math.max(0, n - 20);
      if (state.current.cursor === null || n >= state.current.cursor) return;
      for (let i = 0; i < 20; i++) {
        const cur: number | null = state.current.cursor;
        if (cur === null || cur <= want) return;
        await load((c) => c - want);
        if (state.current.cursor === cur) return; // 진전이 없으면 멈춘다(읽기 실패)
      }
    },
    [load],
  );

  return { items, loading, hasMore: cursor !== null, loadMore, loadTo };
}
