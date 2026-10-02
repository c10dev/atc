import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ControlAccountRow,
  type ControlFuelInfo,
  type ControlList,
  controlGroupFacts,
  controlGroupOf,
  controlPollDue,
  CONTROL_POLL_MS,
  controlRow2Of,
  type ControlRow2,
  type ControlSessionInfo,
  type OtherView,
} from "../../../../server/control-view.ts";
import { idleText } from "../../../../server/other-background.ts";
import type { Snapshot } from "../../../../server/model.ts";
import { EditRow, type SaveResult } from "../../SettingsServer.tsx";
import { JobDetail, NeedsYou } from "../../ui.tsx";
import { timeAgo } from "../../derive.ts";
import { type ControlAccounts, controlMemo } from "../../controlData.ts";
import { allControlDown, type BulkOp } from "../../../../server/control-bulk.ts";
import { BulkBar, BulkPanel, RecoveryBanner } from "./ControlBulk.tsx";
import { ContextCell } from "./Context.tsx";
import { FleetListHead, FleetRowShell } from "./StatusList.tsx";
import { apiGet, apiSend } from "../../api.ts";

// FLEET 탭의 CONTROL 그룹(ATC-130 → ATC-132, docs/fleet.md 8.5.1). AIRCRAFT 목록과 같은 줄(FleetRowShell)·같은 열이고, 모두가 같은 사실은 그룹 머리에 한 번만 적는다.
// 줄마다 live 배지(BG·TERM·DESKTOP). TOWER·OCC·MCC·CROSSCHECK·REVIEW는 atc가 그 폴더에서 `claude --bg`로 띄운다(ocx·tmux LAUNCH는 2026-09-29에 끊음).
// ENGINEERING은 배지만. tmux pane에서 손으로 연 세션도 STOP한다(그 pane만 닫음, 묻고 나서). 데스크톱 세션은 그 창에서 닫는다.
// 새로 읽기: FLEET가 보이는 동안 60초에 한 번(탭을 막 열어도 마지막 읽은 지 60초 전이면 그 값을 보인다), LAUNCH·STOP 뒤에는 곧장.
// FUEL 14일·FOB: 열 때 /api/fuel?days=14를 한 번 읽는다(60초 안에는 그 값). 따로 돌리지 않는다.

// 탭을 오가도 60초 안에는 다시 읽지 않도록 모듈에 둔다. 값(list·accounts)은 헤더 띠와 나누지만 "마지막으로 읽은 시각"은 나누지 않는다(띠가 읽어도 이 구역은 자기 60초로 새로 읽고 ACCOUNT도 읽는다)
let sectionAt: number | null = null;
const memo = controlMemo;
const fuelMemo: { at: number | null; byName: Map<string, ControlFuelInfo> } = { at: null, byName: new Map() };

// /api/fuel의 aircraft[]는 세션 이름(대문자)마다 한 줄이다. 관제 세션도 여기 든다
type FuelReply = { aircraft?: { aircraft: string; total: { cost: { total: number }; requests: number; unpriced?: { requests: number } }; models: Record<string, number>; context: ControlFuelInfo["context"] }[] };
function fuelByName(r: FuelReply): Map<string, ControlFuelInfo> {
  const out = new Map<string, ControlFuelInfo>();
  for (const a of r.aircraft ?? []) {
    const priced = a.total.requests - (a.total.unpriced?.requests ?? 0);
    out.set(a.aircraft.toUpperCase(), { cost: priced > 0 ? a.total.cost.total : null, requests: a.total.requests, models: a.models ?? {}, context: a.context ?? null });
  }
  return out;
}

const CONTROL_AIRPORT = "ATCC";

export function ControlSessions({ snapshot, attached }: { snapshot: Snapshot; attached: boolean }) {
  const [list, setList] = useState<ControlList | null>(memo.list);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ControlAccounts | null>(memo.accounts);
  const [fuel, setFuel] = useState<Map<string, ControlFuelInfo>>(fuelMemo.byName);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<BulkOp | null>(null); // 일괄 동작 미리 보기(ATC-255)
  const autoOpened = useRef(new Set<string>());
  const inflight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inflight.current || !controlPollDue(sectionAt, Date.now(), force)) return;
    inflight.current = true;
    sectionAt = Date.now();
    apiGet("/api/control/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((a: ControlAccounts | null) => {
        if (!a) return;
        memo.accounts = a;
        setAccounts(a);
      })
      .catch(() => {});
    try {
      const res = await apiGet(`/api/control/sessions${force ? "?fresh=1" : ""}`);
      const body = await res.json();
      if (res.ok) {
        memo.list = body as ControlList;
        setList(body as ControlList);
        setError(null);
      } else setError(body.error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    inflight.current = false;
  }, []);
  // #fleet/control로 오면(설정 창의 안내, 헤더 CONTROL 띠) 이 그룹으로 스크롤하고 초점을 둔다
  const ready = list !== null || error !== null;
  useEffect(() => {
    const go = () => {
      if (location.hash.slice(1) !== "fleet/control") return;
      const el = document.getElementById("control");
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, [ready]);
  // 처음과 60초마다. 숨겨진 탭(브라우저)은 건너뛴다
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, CONTROL_POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  // FUEL 14일·FOB: 열 때 한 번(60초 안에는 이미 읽은 값)
  useEffect(() => {
    if (!controlPollDue(fuelMemo.at, Date.now())) return;
    fuelMemo.at = Date.now();
    apiGet("/api/fuel?days=14")
      .then((r) => (r.ok ? r.json() : null))
      .then((r: FuelReply | null) => {
        if (!r) return;
        fuelMemo.byName = fuelByName(r);
        setFuel(fuelMemo.byName);
      })
      .catch(() => {});
  }, []);

  const act = async (name: string, op: "launch" | "stop", tmux?: string | null) => {
    if (tmux && !window.confirm(`${name}: tmux ${tmux}의 pane을 닫습니다. 대화 기록은 남고 claude --resume으로 다시 열 수 있습니다.`)) return;
    setBusy(name);
    setError(null);
    try {
      const res = await apiSend("POST", `/api/control/${encodeURIComponent(name)}/${op}`, {});
      if (!res.ok) setError(`${name}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    await load(true);
    setBusy(null);
  };
  // 그 밖의 백그라운드 세션 STOP(ATC-184): SUPERVISOR가 누를 때만. CONTROL STOP과 같은 Origin 검사(서버)
  const stopOther = async (o: OtherView) => {
    if (!window.confirm(`${o.name}(${o.id}): 이 백그라운드 세션을 멈춥니다. 대화 기록은 남고 claude --resume으로 다시 열 수 있습니다.`)) return;
    setBusy(o.id);
    setError(null);
    try {
      const res = await apiSend("POST", `/api/control/others/${encodeURIComponent(o.id)}/stop`, {});
      if (!res.ok) setError(`${o.name}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    await load(true);
    setBusy(null);
  };
  // ACCOUNT(ATC-60): 관제 세션도 FUEL에서 그 ACCOUNT에 센다. 라벨만 둔다(fleet.json control)
  const saveAccount = async (name: string, v: string): Promise<SaveResult> => {
    try {
      const res = await apiSend("PUT", `/api/control/${encodeURIComponent(name)}/account`, { account: v || null });
      const body = (await res.json().catch(() => ({}))) as { error?: string; accounts?: ControlAccounts };
      if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      if (body.accounts) {
        memo.accounts = body.accounts;
        setAccounts(body.accounts);
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "서버에 연결할 수 없음" };
    }
  };

  // 줄 모델: API 목록 + snapshot(마지막 활동·origin·mode) + /api/fuel + ACCOUNT. 그룹 값과 다른 것만 줄에 칩으로 남는다
  const view = useMemo(() => {
    if (!list) return null;
    const sessionOf = (name: string): ControlSessionInfo | null => {
      const s = snapshot.sessions.filter((x) => x.name.toUpperCase() === name && x.status !== "dead").sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""))[0];
      return s ? { lastActiveAt: s.lastActiveAt, permissionMode: s.permissionMode ?? null, origin: s.origin ?? null } : null;
    };
    const accountOf = (name: string): ControlAccountRow | null => accounts?.rows.find((r) => r.name === name) ?? null;
    const rows = list.sessions.map((c) => controlRow2Of(c, { account: accountOf(c.name), session: sessionOf(c.name), fuel: fuel.get(c.name.toUpperCase()) ?? null }));
    return controlGroupOf(rows, Boolean(list.daemonInService));
  }, [list, accounts, fuel, snapshot.sessions]);

  // NEEDS YOU인 줄은 펼친 채 시작한다. 한 번 펼친 줄은 사람이 접으면 다시 열지 않는다
  useEffect(() => {
    if (!view) return;
    const fresh = view.rows.filter((r) => r.startsOpen && !autoOpened.current.has(r.name)).map((r) => r.name);
    if (!fresh.length) return;
    fresh.forEach((n) => autoOpened.current.add(n));
    setOpen((prev) => new Set([...prev, ...fresh]));
  }, [view]);
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const accountEdit = (name: string) => {
    const a = accounts?.rows.find((r) => r.name === name);
    if (!a) return null;
    return (
      <dl className="config-rows fl-c-account">
        <EditRow
          label={`${name} ACCOUNT`}
          env={`fleet.json control.${name}`}
          value={a.label ?? ""}
          note={
            a.label
              ? `FUEL에서 ACCOUNT ${a.label}에 센다. 비우면 ${accounts?.labeled ? "default" : "자기 이름으로 따로"}`
              : a.account
                ? `라벨 없음 — ACCOUNT ${a.account}로 센다. 사용 한도를 같이 쓰는 AIRCRAFT와 같은 라벨(main, pro-2 …). email은 쓰지 않는다`
                : "라벨 없음 — 어느 AIRCRAFT에도 ACCOUNT가 없어 이 세션 이름으로 따로 센다"
          }
          input={{ kind: "text", mono: true, maxLength: 24 }}
          onSave={(v) => saveAccount(name, v.toLowerCase())}
        />
      </dl>
    );
  };

  const now = Date.now();
  const promptOf = (name: string) => list?.sessions.find((c) => c.name === name)?.prompt ?? null;
  const detailOf = (r: ControlRow2) => (
    <div className="fl-c-detail">
      <div className="fl-c-actions">
        {r.action?.kind === "stop" ? (
          <button className="config-btn is-danger" onClick={() => void act(r.name, "stop", r.action?.kind === "stop" ? r.action.tmux : null)} disabled={busy !== null}>
            STOP
          </button>
        ) : r.action?.kind === "launch" ? (
          <button className="config-btn is-primary" onClick={() => void act(r.name, "launch")} disabled={busy !== null || r.action.disabled} title={r.action.title ?? undefined}>
            LAUNCH
          </button>
        ) : (
          <span className="faint">이름으로 알아본다 — LAUNCH·STOP 없음</span>
        )}
        {r.launchOff && <span className="is-error"> LAUNCH 꺼짐: {r.launchOff}</span>}
      </div>
      <p className="fl-c-line">
        <span className="faint">폴더</span> <code className="config-env">{r.dir}</code>
        {r.how && promptOf(r.name) && (
          <>
            {" "}
            <span className="faint">첫 메시지</span> <code>{promptOf(r.name)}</code>
          </>
        )}
        {r.detail && <span className="faint"> · {r.detail}</span>}
      </p>
      {r.stale.length > 0 && (
        <p className="fl-c-line">
          <span className="fl-stale" title={`${r.stale.join(", ")} — Claude Code가 멈춘 job을 목록에 남긴 것, 무시해도 됨`}>
            STALE {r.stale.length}
          </span>
        </p>
      )}
      {accountEdit(r.name)}
    </div>
  );

  const heading = (facts: string[] | null, count: number | string) => (
    <div className="fl-group-head">
      <h2 className="label">
        CONTROL <em>{count}</em>
      </h2>
      {facts && (
        <span className="fl-group-facts mono" title="이 그룹의 모든 세션이 같은 사실. 다른 줄에만 따로 표시">
          {facts.join(" · ")}
        </span>
      )}
    </div>
  );

  // 세션 목록을 못 읽어도 ACCOUNT 라벨은 보이고 고칠 수 있다
  if (!view)
    return (
      <section className="fl-control" id="control" tabIndex={-1}>
        {heading(null, "")}
        {error ? (
          <div className="fl-c-fallback">
            <p className="conn-error">{error}</p>
            {accounts?.rows.map((r) => (
              <div key={r.name}>{accountEdit(r.name)}</div>
            ))}
          </div>
        ) : (
          <p className="settings-hint">불러오는 중…</p>
        )}
      </section>
    );
  const { group, rows } = view;
  return (
    <section className={`fl-control${attached ? " is-attached" : ""}`} id="control" tabIndex={-1}>
      {!attached && <FleetListHead first="CONTROL" />}
      {heading(controlGroupFacts(group), group.count)}
      {/* 맨 위: 재시작하면 모든 백그라운드 세션이 함께 멈춘다 */}
      {group.daemonInService && (
        <p className="fl-c-warn is-error" role="alert">
          백그라운드 세션 daemon이 atc 서비스 안에서 돌고 있음 — atc를 재시작하면(배포·RTS) 모든 백그라운드 세션이 함께 멈춘다. 재시작한 뒤 LAUNCH하면 daemon이 서비스 밖(systemd scope)에서 뜬다
        </p>
      )}
      {error && <p className="fl-c-warn is-error">{error}</p>}
      {/* 일괄 동작(ATC-255): 모두 내려가 있으면(호스트 재부팅 뒤 등) 복구 배너 */}
      {allControlDown(list?.sessions) && !bulk && <RecoveryBanner onLaunchAll={() => setBulk("launch")} />}
      <BulkBar onOpen={setBulk} disabled={busy !== null} />
      {bulk && <BulkPanel key={bulk} op={bulk} onClose={() => setBulk(null)} onDone={() => load(true)} />}
      <ul className="fl-rows">
        {rows.map((r) => (
          <FleetRowShell
            key={r.name}
            className={r.statusClass}
            detailId={`fl-control-detail-${r.name}`}
            isOpen={open.has(r.name)}
            onToggle={() => toggle(r.name)}
            detail={detailOf(r)}
            cells={
              <>
                <span className="fl-r-id">
                  <b>{r.name}</b> {r.dirShort && <span className="mono faint">{r.dirShort}</span>}
                  {r.accountDiffers && r.account && (
                    <span className="fl-r-acct mono" title={`ACCOUNT ${r.account} — 이 그룹의 ACCOUNT와 다르다`}>
                      {r.account}
                    </span>
                  )}
                  {r.origin && (
                    <span className={`fl-origin mono o-${r.origin.origin}`} title={r.origin.title}>
                      {r.origin.badge}
                      {r.origin.mode && r.permissionDiffers && <span className="fl-origin-mode"> {r.origin.mode}</span>}
                    </span>
                  )}
                  {r.methodDiffers && r.method && <span className="fl-origin mono">{r.method}</span>}
                </span>
                <span className="fl-r-apt">
                  <span className="apt">{CONTROL_AIRPORT}</span>
                </span>
                <span className="fl-r-status">{r.status}</span>
                <span className="fl-r-flight" title={r.flying?.title}>
                  {r.needs ? <NeedsYou job={r.needs} attach={r.origin?.attach} /> : r.working ? <JobDetail job={r.working} /> : <span className="faint">—</span>}
                </span>
                <span className="fl-r-elapsed mono" title={r.intervalMin === null ? "loop 주기 모름" : `첫 메시지 /loop ${r.intervalMin}m`}>
                  {r.intervalMin === null ? <span className="faint">—</span> : `${r.intervalMin}m`}
                </span>
                <span className="fl-r-last" title={r.lastActiveAt ?? undefined}>
                  {r.lastActiveAt ? timeAgo(r.lastActiveAt, now) : <span className="faint">—</span>}
                </span>
                <span className="fl-r-week" aria-hidden="true" />
                <ContextCell c={r.fob} />
                <span className="fl-r-burn mono" title={r.fuel?.title ?? "최근 14일 이 세션의 FUEL COST 없음(기록이 없거나 값 없는 모델)"}>
                  {r.fuel ? r.fuel.label : <span className="faint">—</span>}
                </span>
              </>
            }
          />
        ))}
      </ul>
      {/* OTHER BACKGROUND SESSIONS(ATC-184): 비어 있으면 그룹이 없다 */}
      {list && (list.others?.length ?? 0) > 0 && (
        <section className="fl-others" id="other-background" aria-label="OTHER BACKGROUND SESSIONS">
          <div className="fl-group-head">
            <h2 className="label">
              OTHER BACKGROUND SESSIONS <em>{list.others!.length}</em>
            </h2>
          </div>
          <p className="fl-c-line faint">
            AIRCRAFT도 관제 세션도 아닌 백그라운드 세션이다. 이 세션들도 백그라운드 세션 상한(ATC_MAX_LAUNCHED{list.max ? ` ${list.max}` : ""})에 센다. STOP은 누를 때만 하고, atc가 스스로 멈추지 않는다.
          </p>
          <ul className="fl-others-list">
            {list.others!.map((o) => (
              <li key={o.id} className="fl-other">
                <span className="fl-other-id">
                  <b>{o.name}</b> <span className="mono faint">{o.id}</span>
                </span>
                <code className="config-env fl-other-cwd" title={o.cwd}>
                  {o.cwdShort}
                </code>
                <span className="fl-other-status">{o.job?.state ?? o.status ?? "?"}</span>
                <span className="fl-other-idle mono" title={o.lastActiveAt ?? undefined}>
                  {idleText(o.idleMin) ?? <span className="faint">idle ?</span>}
                </span>
                <span className="fl-other-detail ellipsis" title={o.job?.detail || undefined}>
                  {o.job?.detail || <span className="faint">—</span>}
                </span>
                {o.account && <span className="fl-r-acct mono">{o.account}</span>}
                <button className="config-btn is-danger" onClick={() => void stopOther(o)} disabled={busy !== null} aria-label={`${o.name} STOP`}>
                  STOP
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* 목록에 없는 세션의 ACCOUNT 라벨도 고칠 수 있다(전 구역과 같다) */}
      {accounts?.rows
        .filter((r) => !rows.some((x) => x.name === r.name))
        .map((r) => (
          <div key={r.name} className="fl-c-fallback">
            {accountEdit(r.name)}
          </div>
        ))}
    </section>
  );
}
