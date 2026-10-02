import { Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "./api.ts";
import { type Index, occupantsOf } from "./derive.ts";
import { flightNumber } from "./aviation.ts";
import { Icon } from "./kit/Icon.tsx";
import {
  type AircraftInput,
  type AirportLite,
  aircraftGroups,
  aircraftStateWord,
  filterLabeled,
  flightGroups,
  type FlightInput,
  type Group,
  HOME_ANCHORS,
  METRICS_ITEMS,
  metricsSubOf,
  releaseGroups,
  type ReleaseInput,
} from "./sidebar-rows.ts";
import type { Snapshot } from "../../server/model.ts";
import "./Sidebar.css";

// 화면 사이드바(ATC-443, docs/layout.md 7.2·E1): 레일 옆에서 "열린 화면 안"을 AIRPORT별로 보여 준다.
// 새 서버 길은 없다. FLIGHTS·RELEASE는 snapshot(tickets의 airport)과 RELEASE가 이미 받는 GET /api/releases, FLEET는 FLEET가 이미 받는 GET /api/fleet을 읽는다.
// 머리: 화면 이름 + 검색(알림 Z6이 들어올 자리는 검색 왼쪽의 빈 칸). 항목을 고르면 서랍(#flight/<KEY>)이나 화면 안 자리로 간다.

const TITLE: Record<string, string> = { home: "HOME", release: "RELEASE", flights: "FLIGHTS", fleet: "FLEET", metrics: "METRICS", docs: "DOCS" };

// ≤ 860px(결정 Q2의 한 폭): 사이드바가 화면 위로 열린다
export function useNarrow(): boolean {
  const q = "(max-width: 860px)";
  const [narrow, setNarrow] = useState(() => (typeof matchMedia === "function" ? matchMedia(q).matches : false));
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(q);
    const f = () => setNarrow(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return narrow;
}

// 접힘 선택은 이 브라우저에 기억한다(localStorage가 막혀 있어도 화면은 열린 채 그대로 동작한다)
const FOLD_KEY = "atc.sidebar";
export function loadSidebarFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === "folded";
  } catch {
    return false;
  }
}
export function saveSidebarFolded(folded: boolean): void {
  try {
    localStorage.setItem(FOLD_KEY, folded ? "folded" : "open");
  } catch {
    // 기억하지 못해도 된다
  }
}

// 새 폴링 없이 화면과 같이 refreshKey가 바뀔 때만 읽는다
function useJson<T>(path: string | null, refreshKey: string, pick: (j: unknown) => T, empty: T): T {
  const [v, setV] = useState<T>(empty);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    apiGet(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => alive && setV(pick(j)))
      .catch(() => alive && setV(empty));
    return () => {
      alive = false;
    };
    // pick·empty는 모듈 상수라 의존성에 두지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, refreshKey]);
  return v;
}

const releaseOf = (j: unknown): { key: string; title: string; priority: number }[] => {
  const ready = (j as { ready?: unknown })?.ready;
  return Array.isArray(ready) ? (ready as { key: string; title: string; priority: number }[]) : [];
};
const aircraftOf = (j: unknown): { registration: string; callsign: string; status: string; base: string | null; retired?: boolean }[] => {
  const a = (j as { aircraft?: unknown })?.aircraft;
  return Array.isArray(a) ? (a as { registration: string; callsign: string; status: string; base: string | null; retired?: boolean }[]) : [];
};
const NONE_RELEASE: ReturnType<typeof releaseOf> = [];
const NONE_AIRCRAFT: ReturnType<typeof aircraftOf> = [];

function go(hash: string, onPick: () => void) {
  location.hash = hash;
  onPick();
}

function GroupHead({ g, extra }: { g: Group<unknown>; extra?: ReactNode }) {
  return (
    <div className="sb-group-head">
      <span className="sb-code mono">{g.code}</span>
      {g.name ? <span className="sb-repo faint">{g.name}</span> : null}
      {extra}
    </div>
  );
}

export function Sidebar({
  screen,
  snapshot,
  idx,
  refreshKey,
  over,
  onPick,
  onClose,
}: {
  screen: string;
  snapshot: Snapshot | null;
  idx: Index | null;
  refreshKey: string;
  over: boolean; // 좁은 폭: 화면 위로 열린다
  onPick: () => void; // 항목을 골랐다(좁은 폭에서는 닫는다)
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hash, setHash] = useState(location.hash);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  // 화면이 바뀌면 검색어를 비운다(다른 화면의 목록에 남은 글자가 거르지 않게)
  useEffect(() => setQuery(""), [screen]);
  // 좁은 폭에서 열리면 검색 칸으로 초점을 옮기고, Esc로 닫는다
  useEffect(() => {
    if (!over) return;
    searchRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [over, onClose]);

  const airports: AirportLite[] = useMemo(() => (snapshot?.airports ?? []).map((a) => ({ code: a.code, repo: a.repo, name: a.name })), [snapshot?.airports]);
  const now = Date.now();

  const flights = useMemo<FlightInput[]>(() => {
    if (!snapshot || !idx) return [];
    return snapshot.tickets.map((t) => ({
      key: t.key,
      title: t.title,
      state: t.state,
      stateType: t.stateType,
      priority: t.priority,
      airport: t.airport ?? null,
      live: occupantsOf(t.key, idx).length > 0,
      updatedAt: t.updatedAt,
    }));
  }, [snapshot, idx]);
  const flightGs = useMemo(() => (screen === "flights" ? flightGroups(flights, airports, query, now) : []), [screen, flights, airports, query, now]);

  const releaseRows = useJson(screen === "release" ? "/api/releases" : null, refreshKey, releaseOf, NONE_RELEASE);
  const airportOfKey = useMemo(() => new Map((snapshot?.tickets ?? []).map((t) => [t.key, t.airport ?? null])), [snapshot?.tickets]);
  const releaseGs = useMemo(
    () => (screen === "release" ? releaseGroups(releaseRows.map((r): ReleaseInput => ({ key: r.key, title: r.title, priority: r.priority, airport: airportOfKey.get(r.key) ?? null })), airports, query) : []),
    [screen, releaseRows, airportOfKey, airports, query],
  );

  const fleetRows = useJson(screen === "fleet" ? "/api/fleet" : null, refreshKey, aircraftOf, NONE_AIRCRAFT);
  const fleetGs = useMemo(() => {
    if (screen !== "fleet") return [];
    // 빠르게 바뀌는 상태는 snapshot의 세션이 덮는다(FLEET 화면과 같은 규칙)
    const live = new Map((snapshot?.sessions ?? []).map((s) => [s.name.toUpperCase(), s.status]));
    const items: AircraftInput[] = fleetRows.map((a) => ({
      registration: a.registration,
      callsign: a.callsign,
      airport: a.base,
      status: live.get(a.registration.toUpperCase()) ?? a.status,
      retired: Boolean(a.retired),
    }));
    return aircraftGroups(items, airports, query);
  }, [screen, fleetRows, snapshot?.sessions, airports, query]);

  const metricsItems = filterLabeled(METRICS_ITEMS, query);
  const homeItems = filterLabeled(HOME_ANCHORS, query);
  const sub = metricsSubOf(hash);

  const empty = <p className="sb-empty faint">{query ? "맞는 항목 없음" : "표시할 것이 없음"}</p>;
  let body: ReactNode;
  if (screen === "flights") {
    body = flightGs.length ? (
      flightGs.map((g) => (
        <section className="sb-group" key={g.code} aria-label={`${g.code} ${g.name ?? ""}`.trim()}>
          <GroupHead g={g} extra={<span className="sb-count mono">{g.rows.length}</span>} />
          <ul className="sb-list">
            {g.rows.map((f) => (
              <li key={f.key}>
                <button type="button" className="sb-item" onClick={() => go(`flight/${f.key}`, onPick)} title={`${f.key} · ${f.title}`}>
                  <span className={`sb-dot${f.live ? " is-live" : ""}`} role="img" aria-label={f.live ? "살아 있는 세션" : "세션 없음"} />
                  <span className="sb-key mono">{flightNumber(f.key)}</span>
                  <span className="sb-title">{f.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {g.doneCount > 0 && (
            <details className="sb-done">
              <summary>
                끝난 FLIGHT <span className="mono">{g.doneCount}</span>
              </summary>
              <ul className="sb-list">
                {g.done.map((f) => (
                  <li key={f.key}>
                    <button type="button" className="sb-item" onClick={() => go(`flight/${f.key}`, onPick)} title={`${f.key} · ${f.title}`}>
                      <span className="sb-dot" aria-hidden="true" />
                      <span className="sb-key mono">{flightNumber(f.key)}</span>
                      <span className="sb-title">{f.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ))
    ) : (
      empty
    );
  } else if (screen === "fleet") {
    body = fleetGs.length ? (
      fleetGs.map((g) => (
        <section className="sb-group" key={g.code} aria-label={`${g.code} ${g.name ?? ""}`.trim()}>
          <GroupHead g={g} extra={<span className="sb-count mono">{g.rows.length}</span>} />
          <ul className="sb-list">
            {g.rows.map((a) => (
              <li key={a.registration}>
                <button type="button" className="sb-item" onClick={() => go(`fleet/${a.registration}`, onPick)}>
                  <span className={`sb-dot${a.status === "busy" ? " is-live" : a.status === "idle" ? " is-idle" : ""}`} aria-hidden="true" />
                  <span className="sb-key mono">{a.registration}</span>
                  <span className="sb-state mono">{aircraftStateWord(a.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))
    ) : (
      empty
    );
  } else if (screen === "release") {
    body = releaseGs.length ? (
      releaseGs.map((g) => (
        <section className="sb-group" key={g.code} aria-label={`${g.code} ${g.name ?? ""}`.trim()}>
          <GroupHead g={g} extra={<span className="sb-count mono">{g.rows.length}</span>} />
          <ul className="sb-list">
            {g.rows.map((r) => (
              <li key={r.key}>
                <button type="button" className="sb-item" onClick={() => go(`flight/${r.key}`, onPick)} title={`${r.key} · ${r.title}`}>
                  <span className="sb-key mono">{flightNumber(r.key)}</span>
                  <span className="sb-title">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))
    ) : (
      empty
    );
  } else if (screen === "metrics") {
    body = metricsItems.length ? (
      <ul className="sb-list">
        {metricsItems.map((m) => (
          <li key={m.id}>
            <button type="button" className="sb-item" aria-current={sub === m.id ? "page" : undefined} onClick={() => go(m.hash, onPick)}>
              <span className="sb-key mono">{m.label}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      empty
    );
  } else if (screen === "home") {
    body = homeItems.length ? (
      <ul className="sb-list">
        {homeItems.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className="sb-item"
              onClick={() => {
                // 비어 있으면 그 절이 그려지지 않는다(원칙 1): 없는 닻은 아무 데도 가지 않는다
                document.querySelector<HTMLElement>(`section[aria-label="${a.ariaLabel}"]`)?.scrollIntoView({ block: "start" });
                onPick();
              }}
            >
              <span className="sb-key mono">{a.label}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      empty
    );
  } else {
    body = <p className="sb-empty faint">이 화면에는 목록이 없음</p>;
  }

  return (
    <>
      <div className="sb-head">
        <h2 className="sb-title-screen mono">{TITLE[screen] ?? screen.toUpperCase()}</h2>
        <div className="sb-tools">
          {/* 알림(Z6, docs/layout.md E4)이 들어올 자리: 검색 왼쪽 */}
          <div className="sb-notify" />
          <label className="sb-search">
            <Icon icon={Search} size={14} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder="검색"
              aria-label={`${TITLE[screen] ?? screen} 목록 검색`}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      </div>
      <div className="sb-body">{body}</div>
    </>
  );
}
