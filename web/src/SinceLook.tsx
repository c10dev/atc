import { useCallback, useEffect, useRef, useState } from "react";
import type { SinceLook as SinceLookView } from "../../server/since-look.ts";
import { apiGet, apiSend } from "./api.ts";
import { OpenFlight } from "./FlightLink.tsx";
import "./SinceLook.css";

// 마지막으로 본 뒤 바뀐 것 한 줄(ATC-383). 수·문구·목록은 서버가 정한다(GET /api/since-look). 조용하면(센 것이 없으면) 아무것도 그리지 않는다.
// "봄"은 SUPERVISOR 화면이 서버에 알린다: 읽음 버튼, 또는 탭이 가려질 때(그린 시각까지). 마커는 서버에 하나라 메뉴 막대와 다른 브라우저도 같이 옮겨진다.
const MIN_GAP_MS = 10_000;

type Kind = "released" | "landed" | "deployed" | "stuck" | "waiting";
const LABEL: Record<Kind, string> = { released: "발권", landed: "착륙(ON)", deployed: "배포(IN)", stuck: "막힘", waiting: "기다림" };
const KINDS: Kind[] = ["released", "landed", "deployed", "stuck", "waiting"];

export function SinceLook({ refreshKey }: { refreshKey: string }) {
  const [v, setV] = useState<(SinceLookView & { at: string }) | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useRef<string | null>(null); // 화면에 그린 시각(at)

  const load = useCallback(async () => {
    last.current = Date.now();
    try {
      const res = await apiGet("/api/since-look");
      if (res.ok) setV(await res.json());
    } catch {
      // 못 읽으면 지난 줄을 그대로 둔다
    }
  }, []);

  useEffect(() => {
    const wait = Math.max(0, last.current + MIN_GAP_MS - Date.now());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refreshKey, load]);

  const seen = useCallback(async () => {
    if (!shown.current) return;
    try {
      await apiSend("POST", "/api/since-look/seen", { at: shown.current });
    } catch {
      // 못 보내면 다음에 다시 센다
    }
  }, []);

  // 줄이 보이는 동안 탭이 가려지면 본 것으로 친다(그린 시각까지만: 그 뒤에 생긴 일은 다음에 센다)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void seen();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [seen]);

  shown.current = v && v.line ? v.at : null;
  if (!v || !v.line) return null;

  const items = (k: Kind) => (k === "waiting" ? v.waiting : v[k]);
  return (
    <section className="since-look" aria-label="마지막으로 본 뒤">
      <div className="since-look-row">
        <span className="since-look-label">SINCE LAST LOOK</span>
        {KINDS.filter((k) => items(k).length > 0).map((k) => (
          <button key={k} className={`chip since-look-chip${k === "waiting" ? " is-waiting" : ""}`} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
            {LABEL[k]} <b>{items(k).length}</b>
          </button>
        ))}
        <button
          className="btn since-look-seen"
          onClick={async () => {
            await seen();
            setOpen(null);
            await load();
          }}
        >
          읽음
        </button>
      </div>
      {open && open !== "waiting" && (
        <ul className="since-look-list">
          {v[open].map((k) => (
            <li key={k}>
              <OpenFlight k={k} label={k} />
            </li>
          ))}
        </ul>
      )}
      {open === "waiting" && (
        <ul className="since-look-list is-wide">
          {v.waiting.map((w) => (
            <li key={w.key}>
              <a className="fl-link" href={w.link}>
                {w.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
