// AUTOLAND 마이그레이션 게이트(ATC-329). 순수 함수만 둔다. 읽기는 sources/supabase-migrations.ts, 결과를 쓰는 곳은 autoland.ts.
// hostedDb가 없으면 게이트는 끼지 않는다(오늘과 같음). atc는 마이그레이션을 적용하지 않는다: 호스티드 DB에 이미 적힌 버전을 읽기만 한다.

export interface HostedDb {
  provider: "supabase";
  projectRef: string;
  migrationsDir: string;
}

export const DEFAULT_MIGRATIONS_DIR = "supabase/migrations";
const REF = /^[a-z0-9][a-z0-9-]{3,39}$/;

// airports.json 한 AIRPORT의 hostedDb 칸. 모양이 틀리면 null(게이트 없음, 오늘과 같음)
export function hostedDbOf(raw: unknown): HostedDb | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.provider !== "supabase" || typeof r.projectRef !== "string" || !REF.test(r.projectRef)) return null;
  const dir = typeof r.migrationsDir === "string" ? r.migrationsDir.trim().replace(/^\/+|\/+$/g, "") : "";
  if (r.migrationsDir !== undefined && (!dir || dir.split("/").includes(".."))) return null;
  return { provider: "supabase", projectRef: r.projectRef, migrationsDir: dir || DEFAULT_MIGRATIONS_DIR };
}

// 파일 이름 `<version>_<name>.sql`의 version(숫자). 아니면 null
export const migrationVersionOf = (path: string, dir: string): string | null => {
  const m = path.startsWith(`${dir}/`) ? path.slice(dir.length + 1).match(/^(\d+)_[^/]*\.sql$/) : null;
  return m ? m[1] : null;
};

export interface MigrationGate {
  involved: boolean; // 이 PR이 migrationsDir 아래 파일을 바꾸나. false면 게이트와 상관없다
  ok: boolean; // involved일 때 모든 버전이 호스티드 DB에 적혀 있고 다른 문제가 없을 때만 true
  reason: string | null; // ok가 아닐 때 제외 사유
  versions: string[]; // 새 마이그레이션 버전
  missing: string[]; // 호스티드 DB에 아직 없는 버전
  paths: string[]; // 게이트가 맡은(새 마이그레이션) 파일
}

const none: MigrationGate = { involved: false, ok: true, reason: null, versions: [], missing: [], paths: [] };

// files: PR이 바꾼 파일 전부(못 읽었으면 null), added: 그 가운데 새로 더한 파일(못 읽었으면 null), applied: 호스티드 DB에 적힌 버전(못 읽었으면 null)
export function migrationGateOf(x: { hostedDb: HostedDb | null; files: readonly string[] | null; added: readonly string[] | null; applied: readonly string[] | null }): MigrationGate {
  if (!x.hostedDb || !x.files) return none; // 파일을 못 읽은 PR은 mergeExclusionOf가 이미 막는다
  const dir = x.hostedDb.migrationsDir;
  const under = x.files.filter((f) => f.startsWith(`${dir}/`));
  if (!under.length) return none;
  const fail = (reason: string, extra: Partial<MigrationGate> = {}): MigrationGate => ({ ...none, involved: true, ok: false, reason, ...extra });
  if (!x.added) return fail("마이그레이션 파일이 새 파일인지 못 읽음");
  const added = new Set(x.added);
  // 새 파일이 아닌 것(고침·지움·이름 바꿈)이나 `<version>_<name>.sql`이 아닌 것이 하나라도 있으면 맡지 않는다
  const edited = under.filter((f) => !added.has(f) || migrationVersionOf(f, dir) === null);
  if (edited.length) return fail(`기존 마이그레이션 수정·삭제 또는 형식 밖 파일 ${edited.length}개`);
  const versions = under.map((f) => migrationVersionOf(f, dir) as string);
  if (!x.applied) return fail("호스티드 DB의 적용 버전을 못 읽음(모름은 제외)", { versions, paths: [...under] });
  const have = new Set(x.applied);
  const missing = versions.filter((v) => !have.has(v));
  if (missing.length) return fail(`호스티드 DB에 아직 없는 마이그레이션 ${missing.length}개`, { versions, missing, paths: [...under] });
  return { involved: true, ok: true, reason: null, versions, missing: [], paths: [...under] };
}
