import { useEffect, useMemo, useState } from "react";
import { type Chat, headLine } from "../../../server/duty-chat.ts";
import { SEARCH_MIN, type SearchHit } from "../../../server/duty-log.ts";
import { apiGet } from "../api.ts";
import { useOlder } from "../dutyOlder.ts";
import { decisionLog, outcomeText } from "../../../server/duty-card-status.ts";
import { shiftsOf } from "../../../server/duty-view.ts";
import { type Airports, DraftCard, DutyCard, QueueRow, waitingOf } from "../DutyCards.tsx";
import { DutyComposer, DutyGate, DutyLog, NewShift, useDutyChat } from "../DutyChat.tsx";
import "./DutyScreen.css";

// DUTY 화면(#duty/screen, ATC-477, docs/duty-screen.md 3.2). 레일 항목이 아니라 서랍의 "화면" 단추로 들어온다. 서랍과 같은 대화 부품(DutyChat.tsx)을 세 열로 두른 틀이다.
// 왼쪽은 찾기(검색, 정해 둔 결정, SHIFT 목록), 가운데는 대화(읽기 열 72ch, 입력은 늘 보임), 오른쪽은 아직 기다리는 카드와 초안. QUEUE는 여기 없고 HOME 링크뿐이다.
// 서버 검색(GET /api/duty/search): 입력을 잠깐 쉰 뒤 한 번 묻는다. 결과는 브라우저에만 있고 어디에도 쓰지 않는다
type SearchState = { state: "idle" } | { state: "loading" } | { state: "error" } | { state: "done"; hits: SearchHit[]; truncated: boolean };
function useSearch(query: string, enabled: boolean): SearchState {
  const [r, setR] = useState<SearchState>({ state: "idle" });
  const q = query.trim();
  useEffect(() => {
    if (!enabled || q.length < SEARCH_MIN) return void setR({ state: "idle" });
    setR({ state: "loading" });
    let alive = true;
    const timer = setTimeout(() => {
      apiGet(`/api/duty/search?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((j: { hits: SearchHit[]; truncated: boolean }) => alive && setR({ state: "done", hits: j.hits, truncated: j.truncated }))
        .catch(() => alive && setR({ state: "error" }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, enabled]);
  return r;
}

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  user: "SUPERVISOR",
  text: "DUTY",
  draft: "초안",
  card: "카드",
};

export default function DutyScreen({ chat, onClose, airports, refreshKey, now }: { chat: Chat; onClose: () => void; airports: Airports; refreshKey: string; now: number }) {
  const d = useDutyChat(chat, airports, refreshKey, now);
  const [query, setQuery] = useState("");
  const st = chat.status;
  const enabled = st?.enabled === true;
  const older = useOlder(chat);
  const search = useSearch(query, enabled);
  const searching = query.trim() !== "";
  const loaded = useMemo(() => [...older.items, ...chat.items], [older.items, chat.items]);
  const shifts = shiftsOf(loaded);
  const waiting = waitingOf(chat.items, d.ctx);
  const decisions = d.ctx.decisions?.active ?? [];
  const log = decisionLog(chat.items, d.ctx.status);

  // SHIFT 구분선으로 간다: 검색을 풀어 구분선이 다시 그려진 뒤 그 자리로 스크롤한다
  const jump = (id: string) => {
    setQuery("");
    d.stick.current = false;
    requestAnimationFrame(() => document.getElementById(`du-${id}`)?.scrollIntoView({ block: "start" }));
  };

  // 검색 결과로 간다: 그 줄까지 불러오고(이어 붙여 하나의 로그), 줄 앞에 스크롤해 잠깐 표시한다. 검색어는 그대로 둬서 다른 결과로 바로 갈 수 있다
  const goHit = async (h: SearchHit) => {
    d.stick.current = false;
    await older.loadTo(h.n);
    let tries = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`.du-log [data-n="${h.n}"]`);
      if (!el) {
        if (tries++ < 20) return void requestAnimationFrame(find);
        // 이 화면을 연 뒤 SSE로 들어온 줄에는 줄 번호가 없다. 그런 줄은 로그의 맨 끝에 있으니 맨 아래로 간다
        const log = document.querySelector(".du-log");
        if (log) log.scrollTop = log.scrollHeight;
        d.stick.current = true;
        return;
      }
      el.scrollIntoView({ block: "center" });
      el.classList.add("is-hit");
      setTimeout(() => el.classList.remove("is-hit"), 2000);
    };
    requestAnimationFrame(find);
  };

  // chip → 패널의 그 카드, 결정 기록 → 대화 속 그 chip
  const goPanel = (id: string) => {
    const el = document.getElementById(`ds-card-${id}`);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  };
  const goChat = (id: string) => {
    setQuery("");
    d.stick.current = false;
    requestAnimationFrame(() => document.getElementById(`du-${id}`)?.scrollIntoView({ block: "center" }));
  };

  return (
    <div className="ds" aria-label="DUTY 화면">
      <aside className="ds-left" aria-label="찾기">
        <input type="search" className="ds-search" value={query} placeholder="지난 대화 전체에서 찾기" aria-label="지난 DUTY 대화 전체에서 찾기" onChange={(e) => setQuery(e.target.value)} />
        {searching && (
          <section className="ds-sec" aria-label="찾은 줄" aria-live="polite">
            <h2 className="ds-h">
              찾은 줄{" "}
              {search.state === "done" && search.hits.length > 0 && (
                <em>
                  {search.hits.length}
                  {search.truncated ? "+" : ""}
                </em>
              )}
            </h2>
            {query.trim().length < SEARCH_MIN ? (
              <p className="ds-empty">{SEARCH_MIN}글자 이상 쓰세요</p>
            ) : search.state === "error" ? (
              <p className="ds-empty">찾지 못했습니다. 다시 시도하세요</p>
            ) : search.state !== "done" ? (
              <p className="ds-empty">찾는 중…</p>
            ) : search.hits.length === 0 ? (
              <p className="ds-empty">없습니다</p>
            ) : (
              <ul className="ds-list">
                {search.hits.map((h) => (
                  <li key={h.n}>
                    <button type="button" className="ds-hit" onClick={() => void goHit(h)}>
                      <span className="mono ds-hit-meta">
                        {KIND_LABEL[h.kind]} · {h.t.slice(0, 10)} {h.t.slice(11, 16)}Z · #{h.n + 1}
                      </span>
                      <span className="ds-hit-snip">{h.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {search.state === "done" && search.truncated && <p className="ds-empty">더 있습니다. 검색어를 더 쓰면 줄어듭니다</p>}
          </section>
        )}
        {!searching && (
          <>
            <section className="ds-sec" aria-label="정해 둔 결정">
              <h2 className="ds-h">정해 둔 결정 {decisions.length > 0 && <em>{decisions.length}</em>}</h2>
              {decisions.length === 0 ? (
                <p className="ds-empty">켜져 있는 결정이 없습니다</p>
              ) : (
                <ul className="ds-list">
                  {decisions.map((x) => (
                    <li key={x.id}>
                      <span className="mono ds-id">{x.id}</span> {x.text}
                      {x.until && <span className="ds-until mono"> until {x.until}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="ds-sec" aria-label="결정 기록">
              <h2 className="ds-h">결정 기록 {log.length > 0 && <em>{log.length}</em>}</h2>
              {log.length === 0 ? (
                <p className="ds-empty">처리한 카드가 아직 없습니다</p>
              ) : (
                <ul className="ds-list">
                  {log.map((e) => (
                    <li key={e.id}>
                      <button type="button" className={`ds-shift${e.outcome === "gone" ? " is-gone" : ""}`} onClick={() => goChat(e.id)}>
                        <span className="mono">
                          {e.kind} {e.ref}
                        </span>
                        <span>{outcomeText(e.outcome, e.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="ds-sec" aria-label="SHIFT 목록">
              <h2 className="ds-h">SHIFT {shifts.length > 0 && <em>{shifts.length}</em>}</h2>
              {shifts.length === 0 ? (
                <p className="ds-empty">불러온 줄에 SHIFT 구분선이 없습니다</p>
              ) : (
                <ul className="ds-list">
                  {[...shifts].reverse().map((s) => (
                    <li key={s.id}>
                      <button type="button" className="ds-shift" onClick={() => jump(s.id)}>
                        <time className="mono" dateTime={s.t}>
                          {s.t.slice(5, 10)} {s.t.slice(11, 16)}Z
                        </time>
                        <span>메시지 {s.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </aside>

      <section className="ds-centre" aria-label="대화">
        <header className="ds-head">
          <p className="mono ds-title">{st ? headLine(st) : "DUTY"}</p>
          <div className="ds-head-actions">
            <NewShift d={d} />
            <button type="button" className="btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </header>
        <DutyGate d={d} />
        {enabled && (
          <>
            <DutyLog d={d} cards="chips" onGo={goPanel} older={older} />
            <DutyComposer d={d} />
          </>
        )}
      </section>

      <aside className="ds-right" aria-label="결정">
        <h2 className="ds-h">기다리는 카드 {waiting.length > 0 && <em>{waiting.length}</em>}</h2>
        {!enabled ? null : waiting.length === 0 ? (
          <p className="ds-empty">기다리는 카드가 없습니다</p>
        ) : (
          <div className="ds-cards">
            {waiting.map((it) => (
              <div key={it.id} id={`ds-card-${it.id}`} tabIndex={-1} className="ds-card">
                {it.kind === "card" ? <DutyCard it={it} ctx={d.ctx} /> : <DraftCard it={it} ctx={d.ctx} />}
              </div>
            ))}
          </div>
        )}
        {enabled && <QueueRow queue={d.queue} ctx={d.ctx} />}
      </aside>
    </div>
  );
}
