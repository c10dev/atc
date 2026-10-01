import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSettings } from "../settings.ts";
import {
  clamp,
  clipPolyline,
  clipRing,
  destination,
  distanceDeg,
  normLon,
  nightRing,
  placeOnLand,
  tzCity,
  project,
  unproject,
  type GlobeScene,
  type LatLon,
  type Place,
  type XY,
} from "../../../server/globe.ts";
import { LAND } from "./globe-land.ts";
import { AIRPORTS, TZ_CITY } from "./globe-geo.ts";
import { f1, pathOf, SIZE } from "./globe-draw.ts";
import { FlightRows, FlightsLayer } from "./GlobeFlights.tsx";
import "./Globe.css";

// GLOBE(ATC-254, docs/globe.md): atc의 AIRPORT를 정사영 지구본에 놓고 AIRPORT마다 세워 둔 AIRCRAFT를 보인다. 읽기만 한다.
// 계산은 server/globe.ts(순수), 장면은 GET /api/globe. SUPERVISOR의 위치·홈·옮긴 AIRPORT·시점은 이 브라우저의 localStorage(atc.globe)에만 둔다.
// 서버로 보내지도, 기록하지도 않는다. 색은 :root 토큰만 쓴다.

const KEY = "atc.globe";
const R0 = 440; // 줌 1에서 지구본 반지름
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const PITCH_MAX = 85;

interface View {
  lat: number;
  lon: number;
  zoom: number;
}
interface Saved {
  loc?: LatLon; // SUPERVISOR의 위치(허브). 없으면 시간대에서 정한 기본값
  home?: string; // 홈 AIRPORT 코드. 없으면 서버 기본값
  overrides?: Record<string, LatLon>; // AIRPORT id → 옮긴 자리
  view?: View;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isLatLon = (x: unknown): x is LatLon => {
  const o = x as LatLon | null;
  return Boolean(o) && finite(o?.lat) && finite(o?.lon) && Math.abs(o!.lat) <= 90 && Math.abs(o!.lon) <= 180;
};

// 읽고 쓰는 것은 모두 try/catch 안에서. 막힌 환경(사생활 보호 창, 저장소 차단)에서도 화면은 뜬다.
function loadSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return {};
    const out: Saved = {};
    if (isLatLon(raw.loc)) out.loc = { lat: raw.loc.lat, lon: raw.loc.lon };
    if (typeof raw.home === "string" && /^[A-Z]{4}$/.test(raw.home)) out.home = raw.home;
    if (raw.overrides && typeof raw.overrides === "object") {
      const o: Record<string, LatLon> = {};
      for (const [id, p] of Object.entries(raw.overrides)) if (isLatLon(p)) o[id] = { lat: p.lat, lon: p.lon };
      if (Object.keys(o).length) out.overrides = o;
    }
    const v = raw.view as View | undefined;
    if (v && finite(v.lat) && finite(v.lon) && finite(v.zoom)) out.view = { lat: clamp(v.lat, -PITCH_MAX, PITCH_MAX), lon: normLon(v.lon), zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX) };
    return out;
  } catch {
    return {};
  }
}
function storeSaved(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장소를 못 쓰면 이번 방문에만 쓴다 */
  }
}

// 허락 없이 정하는 기본 위치: 브라우저 시간대의 대표 도시(IANA zone1970.tab). 표에 없으면 UTC 오프셋으로 경도만, 위도는 0.
const defaultLoc = (): LatLon => {
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* 시간대를 못 읽으면 오프셋 규칙 */
  }
  return tzCity(tz, TZ_CITY) ?? { lat: 0, lon: clamp(normLon(-new Date().getTimezoneOffset() / 4), -180, 180) };
};

// ── 고정 데이터(한 번만 셈) ─────────────────────────────────────────
const LAND_RINGS: LatLon[][] = LAND.map((r) => {
  const pts: LatLon[] = [];
  for (let i = 0; i < r.length; i += 2) pts.push({ lon: r[i] / 10, lat: r[i + 1] / 10 });
  return pts;
});
const GRATICULE: LatLon[][] = (() => {
  const lines: LatLon[][] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const l: LatLon[] = [];
    for (let lat = -90; lat <= 90; lat += 6) l.push({ lat, lon });
    lines.push(l);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const l: LatLon[] = [];
    for (let lon = -180; lon <= 180; lon += 6) l.push({ lat, lon });
    lines.push(l);
  }
  return lines;
})();

// ── 그리기 도우미 ────────────────────────────────────────────────────
// 화면 점(SVG 좌표) → 원판 좌표
function discOf(svg: SVGSVGElement, clientX: number, clientY: number, r: number): XY {
  const box = svg.getBoundingClientRect();
  const k = SIZE / box.width;
  return { x: ((clientX - box.left) * k - SIZE / 2) / r, y: -(((clientY - box.top) * k - SIZE / 2) / r) };
}

interface Row {
  id: string;
  code: string;
  name: string;
  parked: string[];
  home: boolean;
}

export function Globe({ refreshKey }: { refreshKey: string }) {
  const { motion } = useSettings();
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [scene, setScene] = useState<GlobeScene | null>(null);
  const [error, setError] = useState(false);
  const hub = saved.loc ?? defaultLoc();
  const [view, setView] = useState<View>(() => saved.view ?? { ...hub, zoom: 1 });
  const [now, setNow] = useState(Date.now());
  const [geoMsg, setGeoMsg] = useState("");
  const [latText, setLatText] = useState(String(Math.round(hub.lat * 10) / 10));
  const [lonText, setLonText] = useState(String(Math.round(hub.lon * 10) / 10));
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "globe"; x: number; y: number } | { kind: "airport"; id: string } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);

  const update = useCallback((patch: (s: Saved) => Saved) => setSaved((s) => patch(s)), []);
  useEffect(() => storeSaved(saved), [saved]);
  useEffect(() => {
    // 시점은 손을 뗄 때마다가 아니라 잠시 멈추면 저장한다
    const t = setTimeout(() => update((s) => ({ ...s, view })), 400);
    return () => clearTimeout(t);
  }, [view, update]);

  // 장면: 스냅샷이 바뀌는 분마다, 홈을 고르면 다시 읽는다
  const home = saved.home;
  useEffect(() => {
    let live = true;
    fetch(`/api/globe${home ? `?home=${encodeURIComponent(home)}` : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<GlobeScene>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => {
        if (!live) return;
        setScene(s);
        setError(false);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [refreshKey, home]);

  // 밤 영역은 시계에서 정한다. 숨은 탭에서는 멈춘다
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const id = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const R = R0 * view.zoom;
  const C = SIZE / 2;

  const places: Place[] = useMemo(() => (scene?.airports ?? []).map((a) => ({ id: a.id, bearing: a.bearing, distance: a.distance, runway: a.runway })), [scene]);
  const positions = useMemo(() => placeOnLand(hub, places, AIRPORTS, saved.overrides ?? {}), [hub.lat, hub.lon, places, saved.overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const land = useMemo(() => {
    const rings: XY[][] = [];
    for (const ring of LAND_RINGS) {
      rings.push(...clipRing(ring, view));
    }
    return pathOf(rings, true, C, C, R);
  }, [view.lat, view.lon, R]); // eslint-disable-line react-hooks/exhaustive-deps
  const grid = useMemo(() => pathOf(GRATICULE.flatMap((l) => clipPolyline(l, view)), false, C, C, R), [view.lat, view.lon, R]); // eslint-disable-line react-hooks/exhaustive-deps

  const minute = Math.floor(now / 60_000);
  const night = useMemo(() => {
    const n = nightRing(minute * 60_000);
    return pathOf(clipRing(n.ring, view, distanceDeg(view, n.center) < 90), true, C, C, R);
  }, [minute, view.lat, view.lon, R]); // eslint-disable-line react-hooks/exhaustive-deps

  // 홈으로: 허브가 가운데, 줌 1
  const goHome = useCallback(
    (to: LatLon = hub) => {
      const target: View = { lat: clamp(to.lat, -PITCH_MAX, PITCH_MAX), lon: to.lon, zoom: 1 };
      if (!motion) return setView(target);
      const from = view;
      const dLon = normLon(target.lon - from.lon);
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 350);
        const e = 1 - (1 - k) ** 3;
        setView({ lat: from.lat + (target.lat - from.lat) * e, lon: normLon(from.lon + dLon * e), zoom: from.zoom + (target.zoom - from.zoom) * e });
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [hub.lat, hub.lon, motion, view], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 휠 확대는 페이지 스크롤을 막아야 해서 passive가 아닌 리스너로 건다
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, zoom: clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // 비행기는 링크라서 누르기를 가로채지 않는다(포인터 캡처가 click을 svg로 돌려 버린다)
    if ((e.target as Element).closest?.("[data-flight]")) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current = null;
      return;
    }
    const airport = (e.target as Element).closest?.("[data-airport]")?.getAttribute("data-airport");
    drag.current = airport ? { kind: "airport", id: airport } : { kind: "globe", x: e.clientX, y: e.clientY };
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current > 0 && d > 0) {
        const k = d / pinch.current;
        setView((v) => ({ ...v, zoom: clamp(v.zoom * k, ZOOM_MIN, ZOOM_MAX) }));
      }
      pinch.current = d;
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === "airport") {
      const p = unproject(discOf(e.currentTarget, e.clientX, e.clientY, R), view);
      if (p) update((s) => ({ ...s, overrides: { ...s.overrides, [d.id]: { lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10 } } }));
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const k = (SIZE / box.width / R) * (180 / Math.PI); // 화면 1px이 지구본에서 몇 도인가(중심 근처)
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    drag.current = { kind: "globe", x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, lon: normLon(v.lon - dx / Math.max(0.25, Math.cos((v.lat * Math.PI) / 180))), lat: clamp(v.lat + dy, -PITCH_MAX, PITCH_MAX) }));
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = 0;
    if (pointers.current.size === 0) drag.current = null;
  };

  const setLoc = (p: LatLon) => {
    const loc = { lat: clamp(p.lat, -90, 90), lon: clamp(normLon(p.lon), -180, 180) };
    update((s) => ({ ...s, loc }));
    setLatText(String(Math.round(loc.lat * 10) / 10));
    setLonText(String(Math.round(loc.lon * 10) / 10));
    setView((v) => ({ ...v, lat: clamp(loc.lat, -PITCH_MAX, PITCH_MAX), lon: loc.lon }));
  };
  const applyTyped = () => {
    const lat = Number(latText);
    const lon = Number(lonText);
    if (latText.trim() !== "" && lonText.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      setLoc({ lat, lon });
      setGeoMsg("");
    } else setGeoMsg("위도는 −90~90, 경도는 −180~180 사이 숫자로 적는다.");
  };
  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return setGeoMsg("이 브라우저는 위치를 알려 주지 않는다.");
    setGeoMsg("위치를 묻는 중…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // 1°로 반올림해서 저장한다(지구본에는 충분하고, 화면을 보여 줄 일이 있어도 덜 정확하다)
        setLoc({ lat: Math.round(pos.coords.latitude), lon: Math.round(pos.coords.longitude) });
        setGeoMsg("");
      },
      () => setGeoMsg("위치를 받지 못했다. 위도·경도를 직접 적을 수 있다."),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };
  const forget = () => {
    update((s) => {
      const { loc: _loc, ...rest } = s;
      return rest;
    });
    const d = defaultLoc();
    setLatText(String(d.lat));
    setLonText(String(Math.round(d.lon * 10) / 10));
    setGeoMsg("");
    setView((v) => ({ ...v, lat: d.lat, lon: d.lon }));
  };

  const rows: Row[] = useMemo(
    () =>
      (scene?.airports ?? []).map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        home: a.code === scene?.home,
        parked: (scene?.parked ?? []).filter((p) => p.airport === a.code).map((p) => p.callsign),
      })),
    [scene],
  );
  const flights = scene?.flights ?? [];
  const atText = new Date(minute * 60_000).toISOString().slice(11, 16);
  const moved = Object.keys(saved.overrides ?? {}).length;

  return (
    <div className="globe">
      <div className="globe-bar">
        <label className="globe-field">
          <span>HOME</span>
          <select value={saved.home ?? ""} onChange={(e) => update((s) => ({ ...s, home: e.target.value || undefined }))} aria-label="홈 AIRPORT">
            <option value="">자동{scene?.home ? ` (${scene.home})` : ""}</option>
            {(scene?.airports ?? []).map((a) => (
              <option key={a.id} value={a.code}>
                {a.code}
              </option>
            ))}
          </select>
        </label>
        <div className="globe-loc">
          <label className="globe-field">
            <span>LAT</span>
            <input value={latText} inputMode="decimal" onChange={(e) => setLatText(e.target.value)} onBlur={applyTyped} onKeyDown={(e) => e.key === "Enter" && applyTyped()} aria-label="위도" />
          </label>
          <label className="globe-field">
            <span>LON</span>
            <input value={lonText} inputMode="decimal" onChange={(e) => setLonText(e.target.value)} onBlur={applyTyped} onKeyDown={(e) => e.key === "Enter" && applyTyped()} aria-label="경도" />
          </label>
          <button type="button" onClick={useMyLocation}>
            내 위치 사용
          </button>
          <button type="button" onClick={forget} disabled={!saved.loc}>
            위치 지우기
          </button>
        </div>
        <button type="button" onClick={() => goHome()}>
          홈으로
        </button>
        {moved > 0 && (
          <button type="button" onClick={() => update((s) => ({ ...s, overrides: undefined }))}>
            AIRPORT 위치 되돌리기
          </button>
        )}
      </div>
      <p className="globe-note">
        {saved.loc ? "위치는 이 브라우저에만 저장한다(서버로 보내지 않는다)." : "위치를 정하지 않아 시간대로 경도만 맞췄다(위도 0). 아래에서 정할 수 있다. 위치는 이 브라우저에만 저장한다."} 밤 영역은 {atText} UTC 기준.
        {geoMsg && <strong role="status"> {geoMsg}</strong>}
      </p>
      {error && !scene && <p className="empty">GLOBE 장면을 읽지 못했다.</p>}
      <div className="globe-body">
        <svg
          ref={svgRef}
          className="globe-svg"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`지구본. AIRPORT ${rows.length}곳${rows.some((r) => r.parked.length) ? `, 세워 둔 AIRCRAFT ${rows.reduce((n, r) => n + r.parked.length, 0)}대` : ""}${flights.length ? `, 나는 FLIGHT ${flights.length}개` : ""}. 같은 내용이 오른쪽 목록에 있다.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <defs>
            <clipPath id="globe-disc">
              <circle cx={C} cy={C} r={R} />
            </clipPath>
          </defs>
          <circle className="globe-sphere" cx={C} cy={C} r={R} />
          <g clipPath="url(#globe-disc)">
            <path className="globe-grid" d={grid} />
            <path className="globe-land" d={land} />
            {night && <path className="globe-night" d={night} />}
          </g>
          <circle className="globe-rim" cx={C} cy={C} r={R} />
          {rows.map((row) => {
            const at = positions.get(row.id);
            if (!at) return null;
            const p = project(at, view);
            if (p.depth <= 0) return null;
            const x = C + p.x * R;
            const y = C - p.y * R;
            const a = (scene?.airports ?? []).find((q) => q.id === row.id)!;
            const e1 = project(destination(at, a.runway, 1.1), view);
            const e2 = project(destination(at, a.runway + 180, 1.1), view);
            const fade = clamp(p.depth * 5, 0.25, 1);
            return (
              <g key={row.id} className={`globe-airport${row.home ? " home" : ""}`} data-airport={row.id} opacity={fade}>
                <title>{`${row.code} · ${row.name}${row.home ? " (HOME)" : ""}${at.iata ? ` — 실제 공항 ${at.iata}` : ""}${row.parked.length ? ` — 세워 둔 AIRCRAFT: ${row.parked.join(", ")}` : ""}`}</title>
                <circle className="globe-hit" cx={x} cy={y} r={16} />
                <line className="globe-runway" x1={C + e1.x * R} y1={C - e1.y * R} x2={C + e2.x * R} y2={C - e2.y * R} />
                <circle className="globe-aerodrome" cx={x} cy={y} r={row.home ? 7 : 5} />
                <text className="globe-code" x={x + 11} y={y - 9}>
                  {row.code}
                </text>
                {row.parked.length > 0 && (
                  <g className="globe-parked" transform={`translate(${f1(x - 13)} ${f1(y + 13)})`}>
                    <path d="M0 -6 L4.5 5 L0 3 L-4.5 5 Z" />
                    {row.parked.length > 1 && (
                      <text x={8} y={5}>
                        ×{row.parked.length}
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
          {scene && flights.length > 0 && <FlightsLayer scene={scene} positions={positions} view={view} C={C} R={R} motion={motion} now={now} />}
          {(() => {
            const h = project(hub, view);
            return h.depth > 0 ? <circle className="globe-hub" cx={C + h.x * R} cy={C - h.y * R} r={2.5} /> : null;
          })()}
        </svg>
        <div className="globe-side">
        <section className="globe-rows" aria-label="AIRPORT 목록">
          <h2 className="globe-rows-head">AIRPORTS</h2>
          {rows.length === 0 ? (
            <p className="empty">{scene ? "열린 AIRPORT가 없다." : "불러오는 중…"}</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <span className="globe-row-code">{r.code}</span>
                  <span className="globe-row-name">
                    {r.name}
                    {r.home && <em> HOME</em>}
                  </span>
                  <span className="globe-row-parked">{r.parked.length ? r.parked.join(", ") : "—"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="globe-hint">끌어서 돌리고, 휠이나 두 손가락으로 확대한다. AIRPORT를 끌면 그 자리를 이 브라우저에 기억한다.</p>
        </section>
        <FlightRows flights={flights} />
        </div>
      </div>
    </div>
  );
}
