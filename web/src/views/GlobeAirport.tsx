import { ArrowLeft } from "lucide-react";
import { Icon } from "../Icon.tsx";
import { useMemo, useState } from "react";
import type { GlobeFlight, GlobeScene } from "../../../server/globe.ts";
import {
  AIRPORT_LINES_MAX,
  AIRPORT_WINDOW_MS,
  assignGates,
  atAirport,
  FACILITIES,
  GENERIC_STATION,
  HOLD_CENTER,
  lineOf,
  MISSED_PATH,
  planeSpot,
  type Pt,
  type Pulse,
  pulsesOf,
  RADIO_AIRPORT_KEY,
  RUNWAY,
  showCrosscheck,
  type Spot,
  TAXIWAY_Y,
  VIEW_H,
  VIEW_W,
} from "../../../server/globe-radio.ts";
import type { Transmission } from "../../../server/radio.ts";
import { f1 } from "./globe-draw.ts";
import { flightNumber, flightTip, splitMarks, toneOf, waitsOnSupervisor } from "./GlobeFlights.tsx";
import "./GlobeRadio.css";

// GLOBE G7(ATC-268, docs/globe.md 3.9): 한 AIRPORT를 가까이서 본 그림(#globe/<CODE>). STANDs는 게이트, 활주로 하나, 시설은 OCC·TOWER·MCC(와 PREFLIGHT 교신이 있으면 CROSSCHECK).
// 비행기는 장면의 상태 그대로 놓고(서버가 정한 t만 쓴다), 최근 교신은 시설에서 비행기까지의 선과 head 한 줄로 그린다.
// body는 눌렀을 때만 보인다(RADIO와 같은 "기록된 것만 말한다"). 음성은 템플릿만이다. 읽기만 한다.

const PLANE = "M0 -9 L6 8 L0 4 L-6 8 Z";
const HOLD_RX = 62;
const HOLD_RY = 26;
const SHORT = 38; // 선 위의 head는 이만큼만(전체는 아래 목록)

const clock = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)}Z`;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// 홀딩 중인 비행기는 레이스트랙 위에 고르게 놓는다(여럿이 한 점에 겹치지 않게)
function holdSpot(i: number, n: number): Spot {
  const th = (2 * Math.PI * i) / Math.max(1, n);
  return { x: HOLD_CENTER.x + HOLD_RX * Math.cos(th), y: HOLD_CENTER.y + HOLD_RY * Math.sin(th), heading: (Math.atan2(-HOLD_RX * Math.sin(th), HOLD_RY * Math.cos(th)) * 180) / Math.PI + 90 };
}

function openRadio(code: string) {
  try {
    localStorage.setItem(RADIO_AIRPORT_KEY, code);
  } catch {
    /* 저장소를 못 쓰면 RADIO가 전부 보여 준다 */
  }
  location.hash = "flights/radio";
}

export function AirportView({ code, scene, txs, motion, now }: { code: string; scene: GlobeScene; txs: readonly Transmission[]; motion: boolean; now: number }) {
  const apt = scene.airports.find((a) => a.code === code);
  const flights = useMemo(() => scene.flights.filter((f) => f.airport === code), [scene.flights, code]);
  const parked = useMemo(() => scene.parked.filter((p) => p.airport === code), [scene.parked, code]);
  const gates = useMemo(() => assignGates(flights, parked), [flights, parked]);
  const [picked, setPicked] = useState<string | null>(null);

  // 이 AIRPORT의 교신(전체, 시각순). 선은 최근 10분 가운데 비행기를 아는 것 최대 8개, 아래 목록은 최근 12개
  const mine = useMemo(() => atAirport(pulsesOf(txs, scene.flights, now, 6 * 3_600_000), code), [txs, scene.flights, now, code]);
  const crosscheck = showCrosscheck(txs);

  const spots = useMemo(() => {
    const holds = flights.filter((f) => f.state === "hold");
    const m = new Map<string, Spot>();
    for (const f of flights) {
      const gate = gates.flights.get(f.key)!;
      m.set(f.key, f.state === "hold" ? holdSpot(holds.indexOf(f), holds.length) : planeSpot(f.state, f.t, gate));
    }
    return m;
  }, [flights, gates]);

  const lines = useMemo(() => {
    const recent = mine.filter((p) => p.state !== "answered" || now - Date.parse(p.tx.at) <= AIRPORT_WINDOW_MS); // 열린 호출은 답이 올 때까지 남는다
    const out: { p: Pulse; from: Pt; to: Pt }[] = [];
    for (const p of recent) {
      const l = lineOf(p, p.plane ? (spots.get(p.plane.key) ?? null) : null);
      if (l) out.push({ p, ...l });
    }
    return out.slice(-AIRPORT_LINES_MAX);
  }, [mine, spots, now]);

  const list = mine.slice(-12).reverse();
  const sel = picked ? mine.find((p) => p.tx.id === picked) ?? null : null;
  const holding = flights.filter((f) => f.state === "hold");
  const missed = flights.some((f) => f.state === "goAround");

  if (!apt) {
    return (
      <section className="ga" aria-label={`AIRPORT ${code}`}>
        <a className="ga-back" href="#globe">
          <Icon icon={ArrowLeft} /> GLOBE
        </a>
        <p className="empty">{code} AIRPORT를 찾지 못했다(닫혔거나 이름이 다르다).</p>
      </section>
    );
  }

  const facilities = (["OCC", ...(crosscheck ? (["CROSSCHECK"] as const) : []), "TOWER", "MCC"] as const).map((s) => ({ s, ...FACILITIES[s] }));
  const generic = mine.some((p) => p.station === "RADIO");

  return (
    <section className="ga" aria-label={`AIRPORT ${code}`}>
      <header className="ga-head">
        <a className="ga-back" href="#globe">
          <Icon icon={ArrowLeft} /> GLOBE
        </a>
        <h2 className="ga-title">
          <span className="mono">{apt.code}</span> {apt.name}
          {apt.code === scene.home && <em> HOME</em>}
        </h2>
        <span className="ga-rwy faint">활주로 {Math.round(apt.runway)}° · 게이트 {gates.all.length}</span>
      </header>
      <svg className="ga-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={`${apt.code} AIRPORT. FLIGHT ${flights.length}개, 세워 둔 AIRCRAFT ${parked.length}대, 최근 교신 ${lines.length}건. 같은 내용이 아래 목록에 있다.`}>
        <rect className="ga-apron" x={190} y={228} width={520} height={118} rx={6} />
        <line className="ga-taxiway" x1={150} y1={TAXIWAY_Y} x2={790} y2={TAXIWAY_Y} />
        <line className="ga-taxiway" x1={700} y1={TAXIWAY_Y} x2={700} y2={RUNWAY.y} />
        <rect className="ga-runway" x={RUNWAY.x1} y={RUNWAY.y - 16} width={RUNWAY.x2 - RUNWAY.x1} height={32} rx={3} />
        <line className="ga-centerline" x1={RUNWAY.x1 + 14} y1={RUNWAY.y} x2={RUNWAY.x2 - 14} y2={RUNWAY.y} />
        <text className="ga-label" x={RUNWAY.x1} y={RUNWAY.y + 32}>
          RWY {String(Math.round(apt.runway / 10) % 36 || 36).padStart(2, "0")}
        </text>
        {holding.length > 0 && <ellipse className="ga-hold" cx={HOLD_CENTER.x} cy={HOLD_CENTER.y} rx={HOLD_RX} ry={HOLD_RY} />}
        {missed && <path className="ga-hold is-missed" d={`M${MISSED_PATH.map((q) => `${f1(q.x)} ${f1(q.y)}`).join("L")}`} />}

        {facilities.map((f) => (
          <g key={f.s} className="ga-facility" data-station={f.s}>
            <title>{`${f.label} — ${f.sub}`}</title>
            {f.s === "TOWER" ? <rect x={f.x - 10} y={f.y - 30} width={20} height={34} rx={2} /> : null}
            <rect x={f.x - 56} y={f.y - (f.s === "TOWER" ? 4 : 18)} width={112} height={f.s === "TOWER" ? 28 : 42} rx={4} />
            <text className="ga-fac-name" x={f.x} y={f.y + (f.s === "TOWER" ? 14 : 2)} textAnchor="middle">
              {f.label}
            </text>
            {f.s !== "TOWER" && (
              <text className="ga-fac-sub" x={f.x} y={f.y + 16} textAnchor="middle">
                {f.sub}
              </text>
            )}
          </g>
        ))}
        {generic && (
          <g className="ga-facility is-generic" data-station="RADIO">
            <title>모르는 주파수의 교신</title>
            <rect x={GENERIC_STATION.x - 40} y={GENERIC_STATION.y - 18} width={80} height={42} rx={4} />
            <text className="ga-fac-name" x={GENERIC_STATION.x} y={GENERIC_STATION.y + 8} textAnchor="middle">
              RADIO
            </text>
          </g>
        )}

        {gates.all.map((g, i) => (
          <circle key={i} className="ga-gate" cx={g.x} cy={g.y + 22} r={4} />
        ))}
        {parked.map((p) => {
          const g = gates.parked.get(p.registration)!;
          return (
            <g key={p.registration} className="ga-plane is-parked" transform={`translate(${f1(g.x)} ${f1(g.y)}) rotate(180)`}>
              <title>{`${p.callsign} — 세워 둠`}</title>
              <path d={PLANE} />
            </g>
          );
        })}

        <g className="ga-lines">
          {lines.map(({ p, from, to }, i) => {
            // MCC의 방송 선은 한 점(활주로 가운데)으로 모여 글이 겹친다: 가장 새것에만 글을 달고 나머지는 선과 목록에
            const labelled = Boolean(p.plane) || !lines.slice(i + 1).some((o) => !o.p.plane);
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            const on = picked === p.tx.id;
            return (
              <g key={p.tx.id} className={`ga-line is-${p.state}${on ? " is-on" : ""}${motion && p.state !== "answered" ? " is-moving" : ""}`} role="button" tabIndex={0} aria-pressed={on} aria-label={p.tx.head} onClick={() => setPicked(on ? null : p.tx.id)} onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  setPicked(on ? null : p.tx.id);
                }}>
                <title>{p.tx.head}</title>
                <line x1={f1(from.x)} y1={f1(from.y)} x2={f1(to.x)} y2={f1(to.y)} />
                <line className="ga-line-hit" x1={f1(from.x)} y1={f1(from.y)} x2={f1(to.x)} y2={f1(to.y)} />
                {labelled && (
                  <text x={f1(mx)} y={f1(my - 4)} textAnchor="middle">
                    {cut(p.tx.head, SHORT)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {flights.map((f) => (
          <Plane key={f.key} f={f} spot={spots.get(f.key)!} />
        ))}
      </svg>

      {sel && (
        <div className="ga-detail" role="status">
          <b className="mono">{clock(sel.tx.at)}</b> {sel.tx.head}
          <pre>{sel.tx.body ?? "기록된 문구 없음"}</pre>
        </div>
      )}

      <section className="ga-list" aria-label={`${apt.code}의 최근 교신`}>
        <div className="ga-list-head">
          <h3 className="globe-rows-head">RECENT TRANSMISSIONS</h3>
          <button type="button" className="ga-link" onClick={() => openRadio(apt.code)}>
            RADIO에서 {apt.code} 보기
          </button>
        </div>
        {list.length === 0 ? (
          <p className="empty">이 AIRPORT의 최근 교신이 없다.</p>
        ) : (
          <ul>
            {list.map((p) => (
              <li key={p.tx.id} className={`is-${p.state}`}>
                <button type="button" className="ga-row" aria-expanded={picked === p.tx.id} onClick={() => setPicked(picked === p.tx.id ? null : p.tx.id)}>
                  <span className="mono faint">{clock(p.tx.at)}</span>
                  <span className="ga-st">{p.station}</span>
                  <span className="ga-head-text">{p.tx.head}</span>
                  {p.state !== "answered" && <em className={`ga-state is-${p.state}`}>{p.state === "open" ? "OPEN" : "LATE"}</em>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Plane({ f, spot }: { f: GlobeFlight; spot: Spot }) {
  const tone = toneOf(f);
  const tip = flightTip(f);
  const marks = splitMarks(f);
  const body = (
    <>
      <title>{tip}</title>
      <g transform={`translate(${f1(spot.x)} ${f1(spot.y)}) rotate(${f1(spot.heading)})`}>
        <circle className="ga-plane-hit" r={14} />
        {waitsOnSupervisor(f) && <circle className="globe-sup-ring" r={12} />}
        <path className={`ga-plane tone-${tone}`} d={PLANE} />
      </g>
      <text className={`ga-plane-label tone-${tone}`} x={f1(spot.x + 12)} y={f1(spot.y + 22)}>
        {flightNumber(f.key)}
        {marks.rest && <tspan className="ga-plane-mark"> {marks.rest}</tspan>}
        {marks.sup && <tspan className="globe-plane-sup"> SUP</tspan>}
      </text>
    </>
  );
  return /^[A-Z][A-Z0-9]+-\d+$/.test(f.key) ? (
    <a href={`#flight/${f.key}`} className="ga-flight" data-flight={f.key}>
      {body}
    </a>
  ) : (
    <g className="ga-flight" data-flight={f.key}>
      {body}
    </g>
  );
}
