import type { AircraftView } from "../../../../server/fleet.ts";
import { type FuelRemaining, fuelLabel, fuelTitle } from "../../../../server/fuel-remaining.ts";
import { CREW_WARNING_LABEL, LEAK_LABEL, tokensText, usd } from "../../../../server/fuel-view.ts";
import { pct } from "./shared.ts";
import "./Fuel.css";

// FUEL · ACCOUNT(ATC-60): ACCOUNT마다 쓴 몫과 구성원. 관제 세션은 AIRCRAFT와 따로 적는다 — 누가 그 ACCOUNT를 쓰는지 보이게
export function FuelAccounts({ accounts }: { accounts: FuelRemaining[] }) {
  if (!accounts.length) return null;
  const now = Date.now();
  return (
    <section className="fl-fuel-accounts" aria-label="ACCOUNT별 FUEL">
      <h2 className="label">
        FUEL <em>ACCOUNT {accounts.length}</em>
      </h2>
      <ul>
        {accounts.map((f) => (
          <li key={f.group} title={fuelTitle(f, now)}>
            <span className="fl-fa-name mono">{f.account ?? `${f.control.length ? "control" : "AIRCRAFT"} ${f.control[0] ?? f.aircraft[0]}`}</span>
            <span className={`fl-fuel lv-${f.level}`}>{fuelLabel(f, now)}</span>
            <span className="fl-fa-members">
              {f.aircraft.length > 0 && (
                <span>
                  <span className="faint">AIRCRAFT</span> <span className="mono">{f.aircraft.join(", ")}</span>
                </span>
              )}
              {f.control.length > 0 && (
                <span>
                  <span className="faint">control</span> <span className="mono">{f.control.join(", ")}</span>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 최근 FLIGHT 한 줄의 FUEL(ATC-56): FUEL COST(없으면 토큰)·NET·LEAK, TRIP FUEL 안이었나. fuel 없는 옛 줄은 "FUEL —"
type FuelRecentView = NonNullable<AircraftView["fuelRecent"]>[number];
export function RecentFuel({ f }: { f: FuelRecentView | undefined }) {
  if (!f || f.tokens === null) return <span className="fl-log-fuel faint" title="이 FLIGHT의 LOGBOOK 줄에 fuel이 없다(FUEL F4 전이거나 대화 기록을 찾지 못함)">FUEL —</span>;
  const trip = f.trip.p50 !== null && f.trip.p90 !== null ? `TRIP FUEL ${usd(f.trip.p50)}–${usd(f.trip.p90)} (${f.trip.level} ${f.trip.group}, ${f.trip.samples}건)` : "TRIP FUEL 없음(비교할 FLIGHT가 모자람)";
  const title = [
    `FUEL BURN ${tokensText(f.tokens)} 토큰`,
    f.cost === null ? "FUEL COST 없음(값 없는 모델이거나 옛 줄)" : `FUEL COST ${usd(f.cost)}`,
    f.net !== null && `NET ${usd(f.net)}`,
    f.leakTokens !== null && `LEAK ${tokensText(f.leakTokens)} 토큰${f.leakCost !== null ? ` ${usd(f.leakCost)}` : ""}`,
    f.unpriced.length ? `값 없음: ${f.unpriced.join(", ")}` : null,
    trip,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="fl-log-fuel" title={title}>
      {f.net !== null ? `NET ${usd(f.net)}` : `${tokensText(f.tokens)} tok`}
      {f.leakCost ? <span className="fl-short"> LEAK {usd(f.leakCost)}</span> : null}
      {f.verdict === "unexpected" ? <span className="fl-late"> UNEXPECTED</span> : f.verdict === "inside" ? <span className="fl-ontime"> TRIP ✓</span> : null}
    </span>
  );
}

// FLEET 카드의 FUEL(ATC-56): 최근 14일 ARRIVED FLIGHT. 값이 없는 칸은 "—"(0이 아니다)
export function FuelBlock({ a }: { a: AircraftView }) {
  const f = a.fuelBurn;
  if (!f) return null;
  const t = a.targets;
  const costShort = t.fuelPerFlight != null && f.netPerFlight !== null && f.netPerFlight > t.fuelPerFlight;
  const cacheShort = t.cacheHit != null && f.cacheHit?.total != null && f.cacheHit.total < t.cacheHit;
  const hitText = (v: number | null | undefined) => (v == null ? "—" : pct(v));
  return (
    <>
      <h3 className="fl-sub">
        FUEL <span className="faint">최근 {f.days}일</span>
      </h3>
      {f.withFuel === 0 ? (
        <p className="fl-line faint">ARRIVED {f.arrived}건 중 fuel이 있는 FLIGHT 없음 — 옛 LOGBOOK 줄에는 fuel이 없다</p>
      ) : (
        <>
          <p className="fl-actuals">
            <span className={costShort ? "fl-short" : undefined} title="값을 매긴 FLIGHT의 평균. NET은 LEAK을 뺀 것">
              FUEL COST {f.costPerFlight === null ? "—" : `${usd(f.costPerFlight)}/FLT`}
              {f.netPerFlight !== null && ` · NET ${usd(f.netPerFlight)}`}
              {t.fuelPerFlight != null && <span className="faint"> (목표 NET {usd(t.fuelPerFlight)} 이하)</span>}
            </span>
          </p>
          <p className="fl-actuals">
            <span className={cacheShort ? "fl-short" : undefined}>
              CACHE HIT CAPTAIN {hitText(f.cacheHit?.captain)} · CREW {hitText(f.cacheHit?.crew)}
              {t.cacheHit != null && <span className="faint"> (목표 {pct(t.cacheHit)})</span>}
            </span>
            {" · "}
            <span title="값을 매긴 FLIGHT의 FUEL COST 가운데 CREW(서브에이전트) 몫. CREW 출력은 하한">CREW 몫 {f.crewShare === null ? "—" : pct(f.crewShare)}</span>
          </p>
          <p className="fl-actuals faint">
            ARRIVED {f.arrived} · fuel {f.withFuel} · 값 {f.priced}
            {f.checked > 0 && (
              <>
                {" · "}TRIP FUEL 넘음 <span className={f.unexpected ? "fl-bad" : undefined}>{f.unexpected}</span>/{f.checked}
              </>
            )}
          </p>
          <p className="fl-actuals faint">
            LEAK{" "}
            {f.leaks.length
              ? f.leaks.map((l) => `${LEAK_LABEL[l.rule]} ${tokensText(l.tokens)}`).join(" · ")
              : "없음"}
            {f.leakCost ? ` (${usd(f.leakCost)})` : ""}
          </p>
          <p className="fl-actuals faint" title="CREW(서브에이전트) 사용의 낭비 신호(FUEL F7). LEAK에는 넣지 않는다. F7 전 LOGBOOK 줄은 재지 않았다">
            CREW 경고{" "}
            {f.crewWarnings === null ? (
              "— (잰 FLIGHT 없음)"
            ) : f.crewWarnings.length ? (
              <span className="fl-short">{f.crewWarnings.map((w) => `${CREW_WARNING_LABEL[w.kind]} ${w.count}`).join(" · ")}</span>
            ) : (
              "없음"
            )}
          </p>
          {f.unpriced.length > 0 && <p className="fl-actuals faint">값 없는 모델: {f.unpriced.join(", ")}</p>}
        </>
      )}
    </>
  );
}
