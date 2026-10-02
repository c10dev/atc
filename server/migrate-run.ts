// 마이그레이션 리허설의 실행부(ATC-368, docs/dispatch.md "Migration rehearsal"). 순서와 판정은 migration-rehearsal.ts(순수).
// AUTOLAND 주기(autoland-run.ts)가 merge 전에 부른다: CLEARED이고 막힌 것이 "새 마이그레이션이 호스티드 DB에 아직 없음"뿐인 PR을,
// 그 AIRPORT 스위치가 켜져 있을 때 한 주기에 하나씩 리허설하고 통과하면 실전에 적용한다. 그러면 다음 주기에 ATC-329 게이트가 통과해 머지된다(적용이 머지보다 먼저).
// 실패하면 이 head로는 다시 하지 않는다(head가 움직이면 새 head로 다시). 실전 DB는 4단계 전에는 읽기만 하고, 모든 단계는 migrations.jsonl에 남는다.
// 비밀: 토큰은 config에서 SqlRunner로만 간다. 기록·로그·오류에는 싣지 않는다(supabase-sql.ts의 redact).
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { hostedDbOfAirport } from "./airports.ts";
import { appendRecord } from "./autoland-record.ts";
import { config } from "./config.ts";
import { assertGithubOn } from "./github-switch.ts";
import { pullKey, slugOfUrl } from "./landing.ts";
import { loadMigrate, notReadyWhy } from "./migrate-config.ts";
import { type HostedDb, MISSING_REASON_PREFIX, type MigrationGate, migrationGateOf, migrationVersionOf } from "./migration-gate.ts";
import { type MigrationFile, type RehearsalIo, type RunResult, type RunStatus, rehearse, type StepRecord } from "./migration-rehearsal.ts";
import type { PullRequest, Snapshot } from "./model.ts";
import { releaseHashOf, sectionsOf } from "./release.ts";
import { appendReleaseLines, readReleaseView } from "./release-store.ts";
import { listPullFiles } from "./sources/github.ts";
import { fetchIssueDetail } from "./sources/linear.ts";
import { readAppliedFor } from "./sources/supabase-migrations.ts";
import { readRestorePoint, redact, supabaseRunner } from "./sources/supabase-sql.ts";

const run = promisify(execFile);
const RECORD = () => join(config.stateDir, "migrations.jsonl");

export interface MigrateRecord {
  at: string;
  airport: string;
  slug: string;
  number: number;
  head: string;
  versions: string[];
  // step: 한 단계의 결과, run: 이번 시도의 끝
  kind: "step" | "run";
  step?: StepRecord["step"];
  ok?: boolean;
  status?: RunStatus;
  detail: string;
  restorePoint?: string | null;
}

export function readMigrateRecords(limit = 100, file = RECORD()): MigrateRecord[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as MigrateRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function append(r: MigrateRecord, file = RECORD()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(r)}\n`);
}

// 이 head로 이미 시도했나(성공·실패 모두). 같은 head는 다시 하지 않는다
export const triedHead = (records: readonly MigrateRecord[], slug: string, number: number, head: string) =>
  records.some((r) => r.kind === "run" && r.slug === slug && r.number === number && r.head === head);

const gh = async (args: string[]) => {
  assertGithubOn();
  return (await run("gh", args, { timeout: 60_000, maxBuffer: 16 << 20 })).stdout;
};

// 이 head의 새 마이그레이션 파일(버전 순). 읽지 못하면 던진다
async function filesOf(slug: string, number: number, head: string, db: HostedDb): Promise<MigrationFile[]> {
  const rows = await listPullFiles(slug, number);
  const added = rows.filter((f) => f.path.startsWith(`${db.migrationsDir}/`) && f.status === "added");
  const out: MigrationFile[] = [];
  for (const f of added) {
    const version = migrationVersionOf(f.path, db.migrationsDir);
    if (!version) continue;
    const sql = await gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${slug}/contents/${f.path}?ref=${head}`]);
    out.push({ path: f.path, version, name: f.path.slice(db.migrationsDir.length + 1).replace(/^\d+_/, "").replace(/\.sql$/, ""), sql });
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

// 발권 때 선언한 K 효과 글. 발권 기록이 있고 그 해시가 지금 본문의 해시와 같을 때만(승인한 내용이 지금 내용일 때만)
export async function declaredOf(flight: string | null, fetchDetail: (k: string) => Promise<unknown> = fetchIssueDetail): Promise<string | null> {
  if (!flight) return null;
  const rec = readReleaseView().records[flight];
  if (!rec) return null;
  const desc = String(((await fetchDetail(flight)) as { description?: unknown }).description ?? "");
  return releaseHashOf(desc) === rec.hash ? sectionsOf(desc).k : null;
}

function ioFor(p: PullRequest, db: HostedDb, token: string): RehearsalIo {
  const testRef = db.testProjectRef!;
  return {
    now: () => new Date().toISOString(),
    declared: () => declaredOf(p.ticketKey),
    test: supabaseRunner(testRef, token),
    live: supabaseRunner(db.projectRef, token),
    restorePoint: () => readRestorePoint(db.projectRef, token, { now: Date.now(), maxAgeHours: db.maxBackupAgeHours ?? 24 }),
    smoke: db.smoke ?? [],
    ...(db.healthUrl
      ? {
          health: async () => {
            try {
              return (await fetch(db.healthUrl!, { signal: AbortSignal.timeout(15_000) })).ok;
            } catch {
              return false;
            }
          },
        }
      : {}),
  };
}

// 멈춘 FLIGHT는 새 arrow로 돌아온다(ATC-368): 발권을 거둬 제안으로 되돌리고, 이유를 RELEASE 패널에 보인다. 발권 기록이 없으면 할 일이 없다
export function sendBack(flight: string | null, reason: string, at = new Date().toISOString()): boolean {
  if (!flight || !readReleaseView().records[flight]) return false;
  appendReleaseLines([{ op: "revoke", flight, at, reason: reason.slice(0, 200), by: "migration-rehearsal" }]);
  return true;
}

// 한 PR. 결과는 migrations.jsonl과 AUTOLAND 기록에 남는다. 던지지 않는다
export async function rehearseOne(p: PullRequest, airport: string, db: HostedDb, token = config.supabaseMigrateToken, io: RehearsalIo = ioFor(p, db, token)): Promise<RunResult | null> {
  const slug = slugOfUrl(p.url);
  if (!slug) return null;
  const base = { airport, slug, number: p.number, head: p.head };
  const note = (r: Partial<MigrateRecord> & { kind: MigrateRecord["kind"]; detail: string }, versions: string[]) => append({ at: new Date().toISOString(), ...base, versions, ...r });
  let files: MigrationFile[];
  try {
    files = await filesOf(slug, p.number, p.head, db);
  } catch (e) {
    const detail = redact(`마이그레이션 파일을 못 읽음: ${String((e as Error).message ?? e)}`, token);
    note({ kind: "run", status: "stopped", detail }, []);
    sendBack(p.ticketKey, detail);
    return null;
  }
  const versions = files.map((f) => f.version);
  const r = await rehearse(files, io);
  for (const s of r.steps) note({ kind: "step", step: s.step, ok: s.ok, detail: redact(s.detail, token), at: s.at }, versions);
  const last = r.steps[r.steps.length - 1];
  const detail = redact(r.status === "applied" ? "실전에 적용됨 — 다음 주기에 AUTOLAND 마이그레이션 게이트가 통과해 머지" : `${r.failedStep}에서 멈춤: ${last?.detail ?? ""}`, token);
  note({ kind: "run", status: r.status, detail, restorePoint: r.restorePoint }, versions);
  if (r.status !== "applied") sendBack(p.ticketKey, `마이그레이션 리허설 ${detail}`);
  return r;
}

// rehearsalPass가 바깥 세계를 만나는 곳. 시험은 가짜를 넣는다(실제 DB·GitHub 호출 없음)
export interface PassIo {
  switches: () => Record<string, boolean>;
  hostedDb: (repo: string) => HostedDb | null;
  token: () => string;
  records: () => MigrateRecord[];
  gate: (slug: string, number: number, db: HostedDb) => Promise<MigrationGate>; // 이 head를 캐시 없이 새로 읽은 게이트
  rehearse: (p: PullRequest, airport: string, db: HostedDb) => Promise<RunResult | null>;
  note: (r: Parameters<typeof appendRecord>[0]) => void;
}
const defaultPassIo: PassIo = {
  switches: () => loadMigrate().airports,
  hostedDb: hostedDbOfAirport,
  token: () => config.supabaseMigrateToken,
  records: () => readMigrateRecords(500),
  gate: async (slug, number, db) => {
    const rows = await listPullFiles(slug, number);
    return migrationGateOf({ hostedDb: db, files: rows.map((f) => f.path), added: rows.filter((f) => f.status === "added").map((f) => f.path), applied: await readAppliedFor(db) });
  },
  rehearse: (p, airport, db) => rehearseOne(p, airport, db),
  note: appendRecord,
};

// AUTOLAND 주기에서: 이번 주기에 리허설할 PR 하나를 골라 돌린다. 스위치가 켜진 AIRPORT의 CLEARED PR 가운데 막힌 것이 마이그레이션 게이트뿐인 것
// (AUTOLAND가 이 PR을 위임해 머지 리뷰까지 통과했을 때만 그 사유가 나온다: reviewedSecurity가 delegate여야 한다)
export async function rehearsalPass(
  s: Snapshot,
  o: {
    mode: string;
    airports: readonly string[];
    stopped: (airport: string) => boolean;
    otherExclusion: (p: PullRequest) => Promise<string | null>; // 마이그레이션을 적용된 것으로 쳐도 남는 제외 사유(없으면 null)
    hold: (p: PullRequest) => void; // 이 head는 머지 후보에서 뺀다
  },
  io: PassIo = defaultPassIo,
): Promise<void> {
  if (o.mode !== "merge") return;
  const sw = io.switches();
  const exclusions = s.autoland?.exclusions ?? {};
  const records = io.records();
  for (const a of s.airports) {
    if (!sw[a.code] || !o.airports.includes(a.code) || o.stopped(a.code)) continue;
    const db = io.hostedDb(a.repo);
    if (notReadyWhy(db, io.token()) || !db) continue;
    for (const p of s.pulls.filter((x) => x.repo === a.repo && x.landing === "CLEARED" && !x.draft)) {
      const slug = slugOfUrl(p.url);
      const why = exclusions[pullKey(p)];
      if (!slug || typeof why !== "string" || !why.includes(`마이그레이션 게이트: ${MISSING_REASON_PREFIX}`) || triedHead(records, slug, p.number, p.head)) continue;
      // 지금 이 head를 새로 읽어 확인한다(캐시 없이): 새 마이그레이션이 정말 아직 없나
      let gate: MigrationGate;
      try {
        gate = await io.gate(slug, p.number, db);
      } catch {
        continue;
      }
      if (!gate.involved || gate.ok || !gate.missing.length) continue;
      // 막힌 것이 마이그레이션뿐일 때만: 다른 제외(HUMAN CHECK, 다른 SQL 경로 …)가 남으면 실전을 바꾸지 않는다
      let other: string | null;
      try {
        other = await o.otherExclusion(p);
      } catch {
        continue;
      }
      if (other) continue;
      const r = await io.rehearse(p, a.code, db);
      // 멈췄으면(실전이 이미 바뀌었어도) 이 head는 머지하지 않는다. 적용 뒤 검사가 실패하면 버전 줄이 이미 있어 ATC-329 게이트가 통과해 버리기 때문이다
      if (r?.status !== "applied") o.hold(p);
      io.note({ op: "migrate", mode: "merge", airport: a.code, slug, number: p.number, head: p.head, result: r?.status === "applied" ? "ok" : r?.status === "live-changed" ? "failed" : "excluded", detail: r ? (r.status === "applied" ? "마이그레이션 리허설 통과, 실전에 적용" : `마이그레이션 리허설 ${r.failedStep}에서 멈춤(${r.status})`) : "마이그레이션 파일을 못 읽음" });
      return; // 한 주기에 하나
    }
  }
}
