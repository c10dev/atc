import { useCallback, useEffect, useState } from "react";
import { OpenFlight } from "../FlightLink.tsx";
import { apiGet, apiSend } from "../api.ts";
import { PriorityMark } from "../badges.tsx";
import "./Release.css";

// RELEASE 화면(ATC-376, docs/layout.md Y1): SUPERVISOR가 화살을 쏘는 한 곳(`#release`).
// 후보(READY Backlog, 에이전트 제안) · 발권 없는 Todo · 최근 발권. 발권 기록은 ATC-362의 길 그대로이고, 이 화면의 클릭만 screen 발권을 만든다(서버가 Origin을 검사한다).
// 클릭 전에 FLIGHT가 선언한 K 효과를 같은 줄에 보인다.

// K3 줄이 있는 FLIGHT의 상태(ATC-398, server/k3-allow.ts K3Status): 선언이 읽히나, 지금 발권이 allow를 주나
interface K3Status {
  lines: number;
  declared: number;
  unparsed: number;
  labels: string[];
  parses: boolean;
  grants: boolean;
  willGrant: boolean;
  hold: "not-declaration" | "release-on-screen" | null;
}
interface Row {
  k3?: K3Status | null;
  key: string;
  title: string;
  hash: string | null;
  priority: number;
  kEffects: string | null;
  state: "ready" | "unreleased" | "stale";
  why?: string | null; // 발권을 거둔 이유(마이그레이션 리허설이 멈춤 등)
}
interface Proposal {
  id: string;
  title: string;
  reason: string;
  status: string;
  kEffects: string | null;
  priority: number;
}
// attested 발권에 K 효과가 선언돼 있고 SUPERVISOR 확인이 아직 없는 것(ATC-391): 누르면 K 권한이 착륙까지 간다
interface KPending {
  key: string;
  title: string | null;
  hash: string;
  at: string;
  session: string | null;
  words: string | null;
  kEffects: string | null;
}
interface Recent {
  key: string;
  title: string | null;
  channel: Channel;
  at: string;
  via: "click" | "bulk" | null;
  session: string | null;
}
type Channel = "screen" | "duty-chat" | "attested";
// atc가 Backlog에 올린 제안(ATC-401): DUTY REVIEW·SCHEDULE NEW. 쏘거나 버릴 때까지 여기 있다
interface Filed {
  k3?: K3Status | null;
  key: string;
  title: string;
  hash: string | null;
  priority: number;
  kEffects: string | null;
  by: string;
  at: string;
}
interface ReleaseData {
  k3Hold?: { mode: "on" | "off"; nuisance: string[]; miss: { flight: string; aircraft: string; t: string }[] };
  gate: { mode: "auto" | "on" | "off"; on: boolean; armedAt: string | null };
  ready: Row[];
  filed: Filed[];
  proposals: Proposal[];
  unreleased: Row[];
  kPending?: KPending[];
  recent: Recent[];
  channels: Record<Channel, number>;
  attested: Record<string, number>;
}

const CHANNEL_LABEL: Record<Channel, string> = { screen: "화면", "duty-chat": "DUTY 채팅", attested: "attested" };

async function send(path: string, body: unknown) {
  const res = await apiSend("POST", path, body);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 선언한 K 효과: 없으면 없다고 적는다(빈 칸이 "효과 없음"으로 읽히지 않게)
// K3 줄의 상태 한 줄: 읽히나 · 지금 발권이 allow를 주나(ATC-398). 줄이 없으면 아무것도 보이지 않는다
function k3Text(k3: K3Status): string {
  if (!k3.parses) return `K3 줄 ${k3.lines}개 중 ${k3.unparsed || k3.lines}개가 선언으로 읽히지 않음(not a declaration) — DISPATCH가 보내지 않습니다. 줄을 \`K3[<라벨>]: <통제> | files: <경로>\`로 고칩니다`;
  const what = `선언 ${k3.declared}개 읽힘(${k3.labels.join(", ")})`;
  return k3.grants ? `${what} · 지금 발권이 allow를 줍니다` : `${what} · 이 화면에서 발권하면 allow를 줍니다(세션이 증언한 발권은 주지 않습니다)`;
}
function KEffects({ text, k3 }: { text: string | null; k3?: K3Status | null }) {
  const line = k3 ? (
    <span className={k3.parses ? "rl-k3" : "rl-k3 is-bad"}>
      <b>K3</b> {k3Text(k3)}
    </span>
  ) : null;
  return text ? (
    <span className="rl-k" title="이슈 본문 `## K effects` 절. 발권은 이 선언을 승인하는 것입니다">
      <b>K</b> {text}
      {line}
    </span>
  ) : (
    <span className="rl-k">
      <b>K</b> 선언 없음
      {line}
    </span>
  );
}

export function Release({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<ReleaseData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiGet("/api/releases");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch {
      setData(null); // 서버에 발권 기록이 없으면(옛 서버) 안내만 그린다
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!loaded) return <p className="empty">발권 후보 불러오는 중…</p>;
  if (!data) return <p className="empty">발권 기록을 읽지 못했습니다. 서버를 새 버전으로 올린 뒤 다시 엽니다.</p>;

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      setConfirm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const fireFiled = (f: Filed) => run(f.key, () => send("/api/releases/fire", { flight: f.key, hash: f.hash }));
  const discard = (f: Filed) =>
    run(f.key, async () => {
      await send("/api/releases/discard", { flight: f.key, hash: f.hash, reason });
      setDiscarding(null);
      setReason("");
    });
  const fireReady = (r: Row) => run(r.key, () => send("/api/releases/fire", { flight: r.key, hash: r.hash }));
  const releaseTodo = (r: Row) => run(r.key, () => send("/api/releases", { flight: r.key, hash: r.hash }));
  const confirmK = (r: KPending) => run(`k-${r.key}`, () => send("/api/releases/k-confirm", { flight: r.key, hash: r.hash }));
  const releaseAll = () => run("all", () => send("/api/releases/bulk", { flights: data.unreleased.map((r) => ({ key: r.key, hash: r.hash })) }));

  // gate가 아직 꺼져 있으면(일괄 확인 전) 안내만: 지금은 발권 없이도 배정한다
  const gateNote = data.gate.on
    ? "발권한 FLIGHT만 배정합니다"
    : data.gate.mode === "off"
      ? "발권 gate 꺼짐(dispatch.json releaseGate) — 발권 없이도 배정합니다"
      : "일괄 확인을 하면 이때부터 발권한 FLIGHT만 배정합니다. 그 전까지는 발권 없이도 배정합니다";
  const k3Hold = data.k3Hold;
  const attested = Object.entries(data.attested);
  const candidates = data.filed.length + data.ready.length + data.proposals.length;

  return (
    <div className="rl-screen">
      <h2 className="label">
        RELEASE <em>{gateNote}</em>
      </h2>
      {error && <p className="rl-error" role="alert">{error}</p>}
      {k3Hold && (
        <p className="faint rl-none" title="DISPATCH가 K3 줄이 있는 FLIGHT를 allow 없이 보내지 않는 장치(설정 창 K3 HOLD). 오작동: nuisance = 효과 없는 K3 줄에 걸려 hold됨, miss = allow 없이 떠난 K3 FLIGHT가 classifier 거부로 멈춤">
          K3 HOLD {k3Hold.mode} · 오작동 nuisance {k3Hold.nuisance.length} · miss {k3Hold.miss.length}
          {k3Hold.miss.length > 0 && ` (${k3Hold.miss.map((m) => `${m.flight}@${m.aircraft}`).join(", ")})`}
        </p>
      )}

      <section className="rl" aria-label="후보">
        <h3 className="label">
          후보 <em>{candidates ? `${candidates}건` : "없음"}</em>
        </h3>
        {candidates === 0 && <p className="faint rl-none">발권할 후보 없음 — DUTY REVIEW·SCHEDULE NEW가 올린 Backlog 제안과 막는 FLIGHT가 모두 끝난 Backlog 이슈가 여기 옵니다</p>}
        {data.filed.length > 0 && (
          <ul className="rl-list" aria-label="제안">
            {data.filed.map((f) => (
              <li key={f.key}>
                <b>
                  <OpenFlight k={f.key} />
                </b>
                <PriorityMark priority={f.priority} />
                <span className="rl-title">{f.title}</span>
                <span className="faint rl-kind">제안</span>
                <span className="rl-sub">
                  <span className="rl-who" title="누가 언제 제안했나">
                    {f.by} · <span className="mono">{clock(f.at)}</span>
                  </span>
                  <KEffects text={f.kEffects} k3={f.k3} />
                  {f.priority <= 0 && <span className="rl-warn">우선순위가 없어 Todo로 옮기지 않습니다(DISPATCH가 건너뜁니다). 먼저 정합니다</span>}
                </span>
                <span className="rl-acts">
                  {discarding === f.key ? (
                    <>
                      <input className="rl-reason" aria-label={`${f.key}를 버리는 사유`} placeholder="버리는 사유(선택)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy !== null} />
                      <button type="button" className="rl-btn" disabled={busy !== null} onClick={() => discard(f)}>
                        버리기
                      </button>
                      <button type="button" className="rl-btn is-quiet" disabled={busy !== null} onClick={() => { setDiscarding(null); setReason(""); }}>
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      {f.priority > 0 ? (
                        <button type="button" className="rl-btn" disabled={busy !== null} onClick={() => fireFiled(f)} aria-label={`${f.key} 발권: Todo로 옮기고 발권`}>
                          발권
                        </button>
                      ) : (
                        <a className="rl-btn is-link" href={`#flight/${f.key}`} title="우선순위가 없으면 DISPATCH가 배정하지 않습니다. FLIGHT 서랍에서 먼저 정합니다">
                          우선순위 먼저
                        </a>
                      )}
                      <button type="button" className="rl-btn is-quiet" disabled={busy !== null} onClick={() => { setDiscarding(f.key); setReason(""); }} aria-label={`${f.key} 버리기`} title="Canceled로 옮기고 사유를 이슈에 남깁니다">
                        버림…
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.ready.length > 0 && (
          <ul className="rl-list" aria-label="READY Backlog">
            {data.ready.map((r) => (
              <li key={r.key}>
                <b>
                  <OpenFlight k={r.key} />
                </b>
                <PriorityMark priority={r.priority} />
                <span className="rl-title">{r.title}</span>
                <span className="faint rl-kind">READY</span>
                <KEffects text={r.kEffects} k3={r.k3} />
                {r.priority > 0 ? (
                  <button type="button" className="rl-btn" disabled={busy !== null} onClick={() => fireReady(r)} aria-label={`${r.key} 발권: Todo로 옮기고 발권`}>
                    발권
                  </button>
                ) : (
                  <a className="rl-btn is-link" href={`#flight/${r.key}`} title="우선순위가 없으면 DISPATCH가 배정하지 않습니다. FLIGHT 서랍에서 먼저 정합니다">
                    우선순위 먼저
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.proposals.length > 0 && (
          <ul className="rl-list" aria-label="에이전트 제안">
            {data.proposals.map((p) => (
              <li key={p.id}>
                <b className="mono">{p.id}</b>
                <PriorityMark priority={p.priority} />
                <span className="rl-title" title={p.reason}>{p.title}</span>
                <span className="faint rl-kind">SCHEDULE NEW</span>
                <KEffects text={p.kEffects} />
                <a className="rl-btn is-link" href="#home" title="아직 이슈가 아닙니다. HOME의 QUEUE에서 승인하면 Backlog 이슈가 생기고(SCHEDULE AUTO가 켜져 있으면 서버가 승인합니다), 그 뒤 이 화면의 제안 줄로 올라와 한 번의 클릭으로 발권합니다">
                  HOME에서 승인
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rl" aria-label="발권 없는 Todo">
        <h3 className="label">
          Todo, 발권 전 <em>{data.unreleased.length ? `${data.unreleased.length}건` : "없음"}</em>
        </h3>
        {data.unreleased.length === 0 ? (
          <p className="faint rl-none">발권을 기다리는 Todo FLIGHT 없음</p>
        ) : (
          <>
            <div className="rl-bar">
              <span className="faint">발권해야 DISPATCH가 배정합니다</span>
              {confirm ? (
                <span className="rl-confirm">
                  <span>위 {data.unreleased.length}개의 목표·완료 기준·K 효과를 승인하고 DISPATCH가 배정하게 합니다. 이 승인은 한 번이고 이후 사람 단계는 없습니다.</span>
                  <button type="button" className="rl-btn" disabled={busy !== null} onClick={releaseAll}>
                    {data.gate.on ? `${data.unreleased.length}개 발권` : `${data.unreleased.length}개 발권하고 gate 켜기`}
                  </button>
                  <button type="button" className="rl-btn is-quiet" disabled={busy !== null} onClick={() => setConfirm(false)}>
                    취소
                  </button>
                </span>
              ) : (
                <button type="button" className="rl-btn" disabled={busy !== null} onClick={() => setConfirm(true)}>
                  모두 발권…
                </button>
              )}
            </div>
            <ul className="rl-list">
              {data.unreleased.map((r) => (
                <li key={r.key}>
                  <b>
                    <OpenFlight k={r.key} />
                  </b>
                  <PriorityMark priority={r.priority} />
                  <span className="rl-title">{r.title}</span>
                  <span className="faint rl-kind">{r.why ? `발권 거둠 — ${r.why}` : r.state === "stale" ? "발권 뒤 내용이 바뀜" : "Todo"}</span>
                  <KEffects text={r.kEffects} k3={r.k3} />
                  <button type="button" className="rl-btn" disabled={busy !== null} onClick={() => releaseTodo(r)} aria-label={`${r.key} 발권`}>
                    발권
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {(data.kPending ?? []).length > 0 && (
        <section className="rl" aria-label="K 효과 확인">
          <h3 className="label">
            K 효과 확인 <em>{(data.kPending ?? []).length}건 — attested 발권만으로는 K 권한이 착륙까지 가지 않습니다</em>
          </h3>
          <ul className="rl-list">
            {(data.kPending ?? []).map((r) => (
              <li key={r.key}>
                <b>
                  <OpenFlight k={r.key} />
                </b>
                <span className="rl-title">{r.title ?? "—"}</span>
                <span className="faint rl-kind">
                  attested{r.session ? ` · ${r.session}` : ""}
                  {r.words ? ` · “${r.words.slice(0, 80)}”` : ""}
                </span>
                <KEffects text={r.kEffects} />
                <button type="button" className="rl-btn" disabled={busy !== null} onClick={() => confirmK(r)} aria-label={`${r.key} K 효과 확인`}>
                  K 효과 확인
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rl" aria-label="최근 발권">
        <h3 className="label">
          최근 발권{" "}
          <em>
            7일 {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => `${CHANNEL_LABEL[c]} ${data.channels[c]}`).join(" · ")}
          </em>
        </h3>
        {data.recent.length === 0 ? (
          <p className="faint rl-none">발권 기록 없음</p>
        ) : (
          <ul className="rl-recent">
            {data.recent.map((r) => (
              <li key={`${r.key}-${r.at}`}>
                <b>
                  <OpenFlight k={r.key} />
                </b>
                <span className="rl-title">{r.title ?? "—"}</span>
                <span className="faint">
                  {CHANNEL_LABEL[r.channel]}
                  {r.via === "bulk" ? " · 일괄" : ""}
                  {r.session ? ` · ${r.session}` : ""}
                </span>
                <span className="faint mono">{clock(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {attested.length > 0 && (
          <p className="faint rl-attested" title="다른 세션이 SUPERVISOR의 말을 증언한 발권. 서버는 그 말을 확인할 수 없어 표본으로 확인한다">
            attested 발권(세션별): {attested.map(([s, n]) => `${s} ${n}`).join(" · ")}
          </p>
        )}
      </section>
    </div>
  );
}
