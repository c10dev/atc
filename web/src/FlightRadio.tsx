import { useEffect, useState } from "react";
import type { Transmission } from "../../server/radio.ts";
import { apiGet } from "./api.ts";
import { formatClock, useSettings } from "./settings.ts";
import { flightTx, threadsOf } from "./radio-log.ts";
import "./FlightRadio.css";

// FLIGHT 서랍의 RADIO 스레드(ATC-379): RADIO 탭이 보이던 교신 가운데 이 FLIGHT의 것을 호출·답 묶음으로. 읽기만.
// 기록이 없으면 아무것도 그리지 않는다(정상 상태에 빈 절을 두지 않는다). 전체 기록은 #flights/radio
const WEEK_MS = 7 * 86_400_000;

export function FlightRadio({ k }: { k: string }) {
  const [txs, setTxs] = useState<Transmission[] | null>(null);
  const { clock } = useSettings();
  useEffect(() => {
    let live = true;
    apiGet(`/api/radio?since=${encodeURIComponent(new Date(Date.now() - WEEK_MS).toISOString())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setTxs(d && Array.isArray(d.transmissions) ? flightTx(d.transmissions, k) : []))
      .catch(() => live && setTxs([]));
    return () => {
      live = false;
    };
  }, [k]);
  if (!txs || txs.length === 0) return null;
  const threads = threadsOf(txs);
  return (
    <>
      <h3 className="dr-h">RADIO {txs.length}</h3>
      <ul className="fr-list">
        {threads.map((th) => (
          <li key={th.tx.id} className="fr-row">
            {[th.tx, ...th.replies].map((t) => (
              <p key={t.id} className={`fr-line${t.replyTo ? " is-reply" : ""}`}>
                <time className="mono faint" dateTime={t.at}>
                  {formatClock(Date.parse(t.at), clock, false)}
                </time>{" "}
                <span className="mono faint">{t.freq}</span> {t.head}
              </p>
            ))}
          </li>
        ))}
      </ul>
      <p className="dr-note">
        <a href="#flights/radio">전체 RADIO 기록</a>
      </p>
    </>
  );
}
