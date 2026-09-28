import { useEffect, useState } from "react";
import type { HumanCheckStatus } from "../../../server/human-check.ts";
import type { PullRequest } from "../../../server/model.ts";
import { flightNumber } from "../aviation.ts";
import type { Index } from "../derive.ts";
import { AirportCode } from "../ui.tsx";
import "./HumanCheck.css";

// HUMAN CHECK(ATC-37): 사람이 꼭 봐야 하는 PR만(`## UI change` class CHOICE·ACCOUNT·DEVICE, 이 head에 done 아님).
// 줄마다 증거(PR 댓글 이미지, RUN-UP 보고서), ACCOUNT·DEVICE면 Preview와 단계. SUPERVISOR가 PASS·FAIL을 누르면
// atc가 PR 본문 `Human check:` 줄 하나와 댓글 하나를 쓴다(head에 묶임)

// 대기열에 드는가(server/human-check.ts waitsOnHuman과 같음. 화면 번들에 node 모듈을 들이지 않으려고 따로 둔다)
export const waitsOnHuman = (s: HumanCheckStatus | null | undefined) => Boolean(s?.required && s.state !== "done");
const slugOf = (url: string) => /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(url)?.[1] ?? null;
const sha7 = (s: string | null | undefined) => (s ?? "").slice(0, 7);

const STATE: Record<HumanCheckStatus["state"], string> = {
  done: "done",
  failed: "FAILED",
  stale: "옛 head에 기록됨",
  pending: "pending",
  "not-needed": "not needed로 적힘",
  unfilled: "채우지 않음",
};

type Evidence = {
  comment: { url: string | null; images: string[]; error: string | null } | null;
  runup: { run: string; base: string; screens: number; changedScreens: number; cuts: number; changedCuts: number; unexpected: string[]; thumbs: { image: string; label: string }[] } | null;
};

export function HumanCheckQueue({ pulls, idx, nameOf }: { pulls: PullRequest[]; idx: Index; nameOf: (id: string) => string }) {
  const queue = pulls.filter((p) => !p.draft && waitsOnHuman(p.humanCheck));
  if (!queue.length) return null;
  return (
    <div className="bay hc">
      <h2 className="label">
        HUMAN CHECK <em>{queue.length}</em>
      </h2>
      <p className="hc-hint faint">CHOICE·ACCOUNT·DEVICE PR만. PASS·FAIL은 이 head에 묶여 PR 본문 Human check 줄과 댓글 하나로 남는다</p>
      <ul className="hc-list">
        {queue.map((p) => (
          <HumanRow key={`${p.repo}#${p.number}`} pr={p} idx={idx} nameOf={nameOf} />
        ))}
      </ul>
    </div>
  );
}

function HumanRow({ pr, idx, nameOf }: { pr: PullRequest; idx: Index; nameOf: (id: string) => string }) {
  const slug = slugOf(pr.url);
  const ui = pr.uiChange!;
  const hc = pr.humanCheck!;
  const [ev, setEv] = useState<Evidence | null>(null);
  const [evError, setEvError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: string; head: string; comment: string | null } | null>(null);

  useEffect(() => {
    if (!slug) return;
    let live = true;
    setEv(null);
    setEvError(null);
    fetch(`/api/human-check/${slug}/${pr.number}/evidence`)
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (r.ok) setEv(body as Evidence);
        else setEvError((body as { error?: string }).error ?? `HTTP ${r.status}`);
      })
      .catch(() => live && setEvError("서버에 연결할 수 없음"));
    return () => {
      live = false;
    };
  }, [slug, pr.number, pr.head]);

  const record = async (result: "pass" | "fail") => {
    if (!slug) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/human-check/${slug}/${pr.number}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, note, head: pr.head }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; head?: string; comment?: string | null };
      if (res.ok) setDone({ result, head: body.head ?? pr.head, comment: body.comment ?? null });
      else setError(body.error ?? `HTTP ${res.status}`);
    } catch {
      setError("서버에 연결할 수 없음");
    }
    setBusy(false);
  };

  const holders = pr.standPath
    ? (idx.claimsByWorkspace.get(pr.standPath) ?? [])
        .filter((c) => c.state === "active")
        .map((c) => nameOf(c.sessionId))
    : [];
  const ws = pr.standPath ? idx.wsByPath.get(pr.standPath) : undefined;
  const needsPreview = ui.classes.some((c) => c === "ACCOUNT" || c === "DEVICE");
  const recorded = done && done.head === pr.head;

  return (
    <li className={`hc-row is-${hc.state}`}>
      <div className="hc-head">
        <a className="pr-num" href={pr.url} target="_blank" rel="noreferrer">
          #{pr.number}
        </a>
        <span className="hc-flight">
          <AirportCode airport={idx.airportByRepo.get(pr.repo)} /> {pr.ticketKey ? flightNumber(pr.ticketKey) : <span className="faint">AD HOC</span>}
        </span>
        <span className="hc-team" title={pr.standPath ?? undefined}>
          {holders.length ? holders.join(", ") : ws ? ws.name : "STAND 없음"}
        </span>
        {ui.classes.map((c) => (
          <span key={c} className={`hc-class is-${c.toLowerCase()}`}>
            {c}
          </span>
        ))}
        <span className="hc-state" title={hc.sha ? `Human check 줄의 SHA ${hc.sha} · head ${sha7(pr.head)}` : undefined}>
          {STATE[hc.state]}
          {hc.state === "stale" && hc.sha ? ` (${hc.sha})` : ""}
        </span>
        <span className="hc-title" title={pr.title}>
          {pr.title}
        </span>
      </div>

      <div className="hc-evidence">
        {!ev && !evError && <span className="faint">증거 불러오는 중…</span>}
        {evError && <span className="hc-error">{evError}</span>}
        {ev?.runup && (
          <div className="hc-runup">
            <a href={`${ev.runup.base}index.html`} target="_blank" rel="noreferrer">
              RUN-UP
            </a>{" "}
            <span>
              {ev.runup.changedScreens}/{ev.runup.screens} screens · {ev.runup.changedCuts}/{ev.runup.cuts} cuts changed
            </span>
            {ev.runup.unexpected.length > 0 && <span className="hc-error"> · UNEXPECTED {ev.runup.unexpected.join(", ")}</span>}
            <div className="hc-thumbs">
              {ev.runup.thumbs.map((t) => (
                <a key={t.image} href={`${ev.runup!.base}${t.image}`} target="_blank" rel="noreferrer" title={t.label}>
                  <img src={`${ev.runup!.base}${t.image}`} alt={t.label} loading="lazy" />
                </a>
              ))}
            </div>
          </div>
        )}
        {ev?.comment && (
          <div className="hc-comment">
            {ev.comment.url ? (
              <a href={ev.comment.url} target="_blank" rel="noreferrer">
                Evidence pack
              </a>
            ) : (
              <span>Evidence pack</span>
            )}
            {ev.comment.error && <span className="hc-error"> · {ev.comment.error}</span>}
            {ev.comment.images.length > 0 && (
              <div className="hc-thumbs">
                {ev.comment.images.map((src, i) => (
                  <a key={src} href={ev.comment!.url ?? src} target="_blank" rel="noreferrer">
                    <img src={src} alt={`evidence ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        {ev && !ev.runup && !ev.comment && <span className="faint">{ui.evidence ? `Evidence pack: ${ui.evidence}` : "증거 없음 — Evidence pack 링크도 RUN-UP 보고서도 없다"}</span>}
      </div>

      {needsPreview && (
        <div className="hc-preview">
          {ui.preview ? (
            <a href={ui.preview} target="_blank" rel="noreferrer noopener">
              Preview ↗
            </a>
          ) : (
            <span className="hc-error">Preview URL 없음</span>
          )}
          {ui.steps ? <pre className="hc-steps">{ui.steps}</pre> : <span className="hc-error"> · Human steps 없음</span>}
        </div>
      )}

      <div className="hc-actions">
        {recorded ? (
          <span className={done.result === "pass" ? "hc-ok" : "hc-error"}>
            {done.result === "pass" ? "PASS" : "FAIL"} 기록됨 · {sha7(done.head)}
            {done.comment && (
              <>
                {" "}·{" "}
                <a href={done.comment} target="_blank" rel="noreferrer">
                  댓글
                </a>
              </>
            )}{" "}
            · GitHub을 다시 읽으면 줄이 바뀐다
          </span>
        ) : (
          <>
            <input
              className="hc-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder="본 것(FAIL은 필수)"
              aria-label={`#${pr.number} 메모`}
            />
            <button className="hc-btn is-pass" onClick={() => void record("pass")} disabled={busy} title={`head ${sha7(pr.head)}에 done을 기록`}>
              PASS
            </button>
            <button className="hc-btn is-fail" onClick={() => void record("fail")} disabled={busy || !note.trim()} title={note.trim() ? `head ${sha7(pr.head)}에 failed를 기록` : "FAIL은 메모가 필요함"}>
              FAIL
            </button>
          </>
        )}
        {error && <span className="hc-error">{error}</span>}
      </div>
    </li>
  );
}

// LANDING SEQUENCE 줄의 표시: class PR의 사람 확인 상태
export function HumanCheckTag({ pr }: { pr: PullRequest }) {
  const hc = pr.humanCheck;
  if (!hc?.required) return null;
  const ok = hc.state === "done";
  return (
    <span className={`pr-extreview ${ok ? "is-pass" : "is-findings"}`} title={hc.carriedFrom ? `${sha7(hc.carriedFrom)}의 HUMAN CHECK를 이어받음(main 병합만)` : undefined}>
      HUMAN CHECK {hc.classes.join("·")}: {ok ? `done${hc.carriedFrom ? ` (carried from ${sha7(hc.carriedFrom)})` : ""}` : STATE[hc.state]}
    </span>
  );
}
