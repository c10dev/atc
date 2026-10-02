// 마이그레이션 리허설(ATC-368). 순수한 단계 순서와 판정만 둔다. DB·GitHub·Linear 호출은 모두 `RehearsalIo`로 받는다(시험은 가짜 io).
// 순서는 정해져 있다: 선언 검사 → 리허설(시험 DB) → 복원점 → 실전 적용 → 적용 뒤 검사. 어느 단계든 실패하면 거기서 멈춘다.
// 실전 DB는 4단계 전에는 읽기만 한다. 4·5단계에서 실패하면 실전이 바뀌었을 수 있어 `live-changed`로 적고 복원점을 남긴다(자동 복원은 하지 않는다).
import { bodyStatements, declarationCheck, type DeclarationResult } from "./migration-declare.ts";

export const STEPS = ["declaration", "rehearsal", "restore-point", "live-apply", "post-check"] as const;
export type Step = (typeof STEPS)[number];

export interface MigrationFile {
  path: string;
  version: string;
  name: string;
  sql: string;
}

export interface StepRecord {
  step: Step;
  ok: boolean;
  detail: string;
  at: string;
}

export type RunStatus =
  | "applied" // 5단계까지 통과, 실전에 적용됨
  | "stopped" // 4단계 전에 멈춤: 실전은 그대로
  | "live-changed"; // 4·5단계에서 실패: 실전이 바뀌었을 수 있다(복원점 확인)

export interface RunResult {
  status: RunStatus;
  steps: StepRecord[];
  failedStep: Step | null;
  restorePoint: string | null;
}

export interface SmokeCheck {
  name: string;
  sql: string;
  expectRows?: boolean; // true면 한 줄 이상이어야 한다
}

export interface Row {
  [col: string]: unknown;
}

// 한 DB에 SQL을 보내는 문. 실패하면 던진다(메시지에 비밀이 없어야 한다: 구현이 걸러서 던진다)
export interface SqlRunner {
  query(sql: string): Promise<Row[]>;
}

export interface RehearsalIo {
  now: () => string;
  declared: () => Promise<string | null>; // 발권한 `## K effects` 글. 발권이 없거나 본문이 바뀌었으면 null
  test: SqlRunner;
  live: SqlRunner;
  restorePoint: () => Promise<string>; // 실전 DB의 복원점(시각이나 백업 표시). 없으면 던진다
  smoke: SmokeCheck[];
  health?: () => Promise<boolean>; // 앱 건강 확인(있을 때만)
}

const VERSIONS_SQL = "select version from supabase_migrations.schema_migrations order by version";
const versionsOf = (rows: Row[]) => rows.map((r) => String(r.version)).sort();
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

// 파일 하나를 한 트랜잭션으로: 파일의 문장들과 버전 줄(파일이 가진 version·name 그대로)을 함께 넣는다
export function applySql(f: MigrationFile): string {
  return ["begin;", ...bodyStatements(f.sql).map((s) => `${s};`), `insert into supabase_migrations.schema_migrations (version, name) values (${q(f.version)}, ${q(f.name)});`, "commit;"].join("\n");
}

// 적용 뒤 비교용 카탈로그: public 함수 본문 해시, 표·함수 grant
export const CATALOG_SQL = `select 'fn' as k, p.oid::regprocedure::text as n, md5(p.prosrc) as h
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public'
union all select 'grant', grantee || ':' || table_name || ':' || privilege_type, '' from information_schema.role_table_grants where table_schema = 'public'
union all select 'rgrant', grantee || ':' || routine_name || ':' || privilege_type, '' from information_schema.role_routine_grants where routine_schema = 'public'`;

const catalogKeys = (rows: Row[]) => new Set(rows.map((r) => `${r.k}|${r.n}|${r.h}`));

// 두 카탈로그가 같은가. 다르면 어느 쪽에만 있는지 앞 몇 개를 적는다(함수 본문 해시와 grant만, 데이터는 없다)
export function catalogDiff(test: Row[], live: Row[]): { same: boolean; onlyTest: string[]; onlyLive: string[] } {
  const a = catalogKeys(test);
  const b = catalogKeys(live);
  const onlyTest = [...a].filter((x) => !b.has(x)).sort();
  const onlyLive = [...b].filter((x) => !a.has(x)).sort();
  return { same: !onlyTest.length && !onlyLive.length, onlyTest: onlyTest.slice(0, 5), onlyLive: onlyLive.slice(0, 5) };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

export async function rehearse(files: readonly MigrationFile[], io: RehearsalIo): Promise<RunResult> {
  const steps: StepRecord[] = [];
  let restorePoint: string | null = null;
  const done = (step: Step, ok: boolean, detail: string) => steps.push({ step, ok, detail, at: io.now() });
  const stop = (step: Step, detail: string, status: RunStatus = "stopped"): RunResult => {
    done(step, false, detail);
    return { status, steps, failedStep: step, restorePoint };
  };
  const versions = files.map((f) => f.version);

  // 1. 선언 검사
  let decl: DeclarationResult;
  try {
    const declared = await io.declared();
    if (declared === null) return stop("declaration", "발권 기록이 없거나 발권 뒤 본문이 바뀜");
    decl = declarationCheck(files.map((f) => ({ path: f.path, sql: f.sql })), declared);
  } catch (e) {
    return stop("declaration", `선언을 읽지 못함: ${msg(e)}`);
  }
  if (!decl.ok) {
    const first = decl.stopped[0];
    return stop("declaration", decl.statements === 0 ? "적용할 문장이 없음" : `${decl.stopped.length}개 문장이 선언과 맞지 않음 — ${first?.file}: ${first?.why} (${first?.sql})`);
  }
  done("declaration", true, `${decl.statements}개 문장, 버전 ${versions.join(", ")}`);

  // 2. 리허설: 시험 DB가 실전과 같은 버전에 있는지 보고(실전에서 새로 읽은 결과와 비교), 적용하고, 앱 점검을 돌린다
  try {
    const liveBefore = versionsOf(await io.live.query(VERSIONS_SQL));
    const testBefore = versionsOf(await io.test.query(VERSIONS_SQL));
    if (!same(liveBefore, testBefore)) return stop("rehearsal", `시험 DB가 실전과 같은 버전이 아님(실전 ${liveBefore.length}개, 시험 ${testBefore.length}개) — 실전에서 다시 가져와야 함`);
    const already = versions.filter((v) => liveBefore.includes(v));
    if (already.length) return stop("rehearsal", `이미 실전에 적용된 버전 ${already.join(", ")}`);
    for (const f of files) await io.test.query(applySql(f));
    for (const c of io.smoke) {
      const rows = await io.test.query(c.sql);
      if (c.expectRows && !rows.length) return stop("rehearsal", `점검 ${c.name}: 결과가 비어 있음`);
    }
    done("rehearsal", true, `시험 DB에 적용, 점검 ${io.smoke.length}개 통과`);
  } catch (e) {
    return stop("rehearsal", msg(e));
  }

  // 3. 복원점
  try {
    restorePoint = await io.restorePoint();
    done("restore-point", true, restorePoint);
  } catch (e) {
    return stop("restore-point", `복원점을 못 만듦: ${msg(e)}`);
  }

  // 4. 실전 적용: 파일마다 한 트랜잭션. 하나라도 실패하면 거기서 멈춘다(앞 파일은 이미 적용됨)
  const appliedLive: string[] = [];
  try {
    for (const f of files) {
      await io.live.query(applySql(f));
      appliedLive.push(f.version);
    }
    done("live-apply", true, `실전에 적용 ${appliedLive.join(", ")}`);
  } catch (e) {
    return stop("live-apply", `${appliedLive.length ? `적용됨 ${appliedLive.join(", ")} · ` : "실전은 그대로 · "}실패: ${msg(e)}`, appliedLive.length ? "live-changed" : "stopped");
  }

  // 5. 적용 뒤 검사: 버전 줄, 함수 본문·grant가 시험 DB와 같은지, 앱 건강
  try {
    const have = versionsOf(await io.live.query(VERSIONS_SQL));
    const missing = versions.filter((v) => !have.includes(v));
    if (missing.length) return stop("post-check", `버전 줄이 없음 ${missing.join(", ")}`, "live-changed");
    const diff = catalogDiff(await io.test.query(CATALOG_SQL), await io.live.query(CATALOG_SQL));
    if (!diff.same) return stop("post-check", `함수 본문·grant가 시험 DB와 다름(시험에만 ${diff.onlyTest.length}, 실전에만 ${diff.onlyLive.length}) — ${[...diff.onlyTest, ...diff.onlyLive].slice(0, 3).join(" ; ")}`, "live-changed");
    if (io.health && !(await io.health())) return stop("post-check", "앱 건강 확인 실패", "live-changed");
    done("post-check", true, "버전·함수 본문·grant·앱 건강 일치");
  } catch (e) {
    return stop("post-check", msg(e), "live-changed");
  }
  return { status: "applied", steps, failedStep: null, restorePoint };
}
