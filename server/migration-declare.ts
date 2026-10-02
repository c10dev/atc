// 마이그레이션 선언 검사(ATC-368 1단계). 순수 함수만 둔다. 빌드한 SQL을 발권 때 선언한 K1 효과와 견준다.
// 기계가 잘 잡는 것은 파괴적 종류와 선언에 없는 DML이다. WHERE 조건이 틀렸거나 backfill 로직이 틀린 것은 못 잡는다 — 그것은 리허설과 복원점의 몫이다.
// 규칙(PILOT'S DISCRETION, docs/dispatch.md "Migration rehearsal"):
//  - K1이 선언되지 않았으면 멈춘다(undeclared).
//  - 추가형 DDL(CREATE, ALTER … ADD, ENABLE RLS, GRANT, COMMENT …)은 K1이 선언돼 있으면 통과한다.
//  - DROP·TRUNCATE·REVOKE·열 타입 변경·이름 바꿈·DISABLE RLS, WHERE 없는 UPDATE·DELETE는 파괴적이라 멈춘다.
//  - 접근을 넓히거나 기존 동작을 바꾸는 문장(정책, GRANT, 역할, SECURITY, OWNER TO, CREATE OR REPLACE)은 선언 글이 그 낱말(policy·grant·role·security·owner·replace)을 적었을 때만 통과한다.
//  - INSERT·UPDATE·DELETE(DML)는 선언 글이 그 표 이름을 적었을 때만 통과한다.
//  - 위에 없는 문장은 분류할 수 없어 멈춘다.

export type StatementKind = "additive" | "sensitive" | "dml" | "destructive" | "unknown" | "txn";

export interface Classified {
  sql: string; // 문장 앞부분(오류 표시용, 최대 80자)
  kind: StatementKind;
  table?: string; // dml의 대상 표(소문자, 스키마 뺌)
  needs?: string[]; // sensitive: 선언 글에 이 낱말이 모두 있어야 통과한다
  why?: string;
}

// `;`로 문장을 나눈다. 따옴표('…', "…"), 달러 따옴표($tag$…$tag$), 주석(-- …, /* … */) 안의 `;`는 무시한다. 빈 문장은 버린다
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const e = sql.indexOf("\n", i);
      const end = e < 0 ? n : e;
      cur += sql.slice(i, end);
      i = end;
    } else if (two === "/*") {
      const e = sql.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      cur += sql.slice(i, end);
      i = end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2; // 따옴표 두 개는 따옴표 문자
          else break;
        } else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        const end = e < 0 ? n : e + m[0].length;
        cur += sql.slice(i, end);
        i = end;
      } else {
        cur += c;
        i++;
      }
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 문장 맨 앞 주석을 걷고 공백을 줄인 소문자 머리. 따옴표·달러 본문은 분류에 쓰지 않으려고 머리(앞 240자)만 본다
const headOf = (stmt: string) =>
  stmt
    .replace(/^(\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "")
    .slice(0, 240)
    .replace(/\s+/g, " ")
    .toLowerCase();

const bare = (name: string) => name.replace(/"/g, "").split(".").pop()!.trim();

const ADDITIVE = [
  /^create (or replace )?(unique )?(table|index|view|materialized view|function|procedure|trigger|type|schema|sequence|policy|domain|role)\b/,
  /^create (temp|temporary|unlogged) table\b/,
  /^alter table (if exists )?(only )?[\w."]+ (add column|add constraint|add primary key|add foreign key|add unique|add check|enable row level security|force row level security|enable trigger|alter column [\w"]+ (set default|drop default|set not null|drop not null)|owner to)\b/,
  /^alter policy\b/,
  /^alter function [\w."(),\s]+ (owner to|set|security)/,
  /^grant\b/,
  /^comment on\b/,
  /^create or replace\b/,
  /^alter (table|view|function|sequence) [\w."(),\s]+ owner to\b/,
];
// 접근·기존 동작을 바꾸는 추가형: 선언이 그 낱말을 적어야 한다. 머리(240자) 안의 SECURITY DEFINER까지 본다
const SENSITIVE: [RegExp, string][] = [
  [/^(create (or replace )?policy|alter policy)\b/, "policy"],
  [/^grant\b/, "grant"],
  [/^(create|alter) role\b/, "role"],
  [/^create extension\b/, "extension"],
  [/^alter function [\w."(),\s]+ security\b/, "security"],
  [/\bowner to\b/, "owner"],
  [/^create or replace\b/, "replace"],
  [/^alter function [\w."(),\s]+ set\b/, "replace"], // search_path 같은 설정은 기존 함수의 동작을 바꾼다
  [/^create (or replace )?(constraint )?trigger\b/, "trigger"], // 기존 표의 쓰기 동작을 바꾼다
];
const TXN = /^(begin|commit|end|start transaction)\b/;

export function classify(stmt: string): Classified {
  const head = headOf(stmt);
  const sql = head.slice(0, 80);
  if (TXN.test(head)) return { sql, kind: "txn" };
  if (/^(drop|truncate|revoke)\b/.test(head)) return { sql, kind: "destructive", why: `${head.split(" ")[0]!.toUpperCase()}는 파괴적` };
  if (/^alter table [\w."]+ (if exists )?(rename|drop)\b/.test(head) || /^alter table (if exists )?(only )?[\w."]+ (rename|drop)\b/.test(head))
    return { sql, kind: "destructive", why: "표·열 이름 바꿈이나 지움" };
  if (/^alter table [\w."]+ (if exists )?alter column [\w"]+ (set data )?type\b/.test(head) || /^alter table (if exists )?(only )?[\w."]+ alter column [\w"]+ (set data )?type\b/.test(head))
    return { sql, kind: "destructive", why: "열 타입 변경" };
  if (/^alter table (if exists )?(only )?[\w."]+ (disable row level security|no force row level security|disable trigger)\b/.test(head))
    return { sql, kind: "destructive", why: "보안·트리거를 끔" };
  if (/^alter .* rename\b/.test(head)) return { sql, kind: "destructive", why: "이름 바꿈" };
  let m: RegExpExecArray | null;
  if ((m = /^insert into ([\w."]+)/.exec(head))) return { sql, kind: "dml", table: bare(m[1]!) };
  if ((m = /^update (only )?([\w."]+)/.exec(head))) {
    // WHERE는 머리(240자)보다 뒤에 있을 수 있어 전체 문장에서 본다(따옴표 안의 낱말은 걷어 낸다)
    return hasWhere(stmt) ? { sql, kind: "dml", table: bare(m[2]!) } : { sql, kind: "destructive", table: bare(m[2]!), why: "WHERE 없는 UPDATE" };
  }
  if ((m = /^delete from (only )?([\w."]+)/.exec(head))) {
    return hasWhere(stmt) ? { sql, kind: "dml", table: bare(m[2]!) } : { sql, kind: "destructive", table: bare(m[2]!), why: "WHERE 없는 DELETE" };
  }
  // SECURITY DEFINER는 달러 본문 뒤(`as $$ … $$ language sql security definer`)에도 올 수 있어 본문을 걷어 낸 전체 문장에서 본다
  // 맞는 낱말은 모두 필요하다(`create or replace function … security definer`는 replace와 security 둘 다)
  const needs = new Set(SENSITIVE.filter(([r]) => r.test(head)).map(([, w]) => w));
  if (/\bsecurity (definer|invoker)\b/.test(unquoted(stmt).replace(/\s+/g, " ").toLowerCase())) needs.add("security");
  if (needs.size && (ADDITIVE.some((r) => r.test(head)) || /^(alter role|create extension)\b/.test(head))) return { sql, kind: "sensitive", needs: [...needs] };
  if (ADDITIVE.some((r) => r.test(head))) return { sql, kind: "additive" };
  return { sql, kind: "unknown", why: "분류할 수 없는 문장" };
}

// 따옴표·달러 본문·주석을 지운 문장
const unquoted = (stmt: string): string =>
  stmt
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/"(?:[^"]|"")*"/g, " "); // 큰따옴표 식별자("where" 열)도 걷어 낸다

// 따옴표·달러 본문·주석을 지운 문장에 `where`가 낱말로 있나
const hasWhere = (stmt: string): boolean => /\bwhere\b/i.test(unquoted(stmt));

export interface DeclarationResult {
  ok: boolean;
  statements: number;
  stopped: { file: string; sql: string; why: string }[]; // 멈춘 이유(문장마다)
}

const mentions = (declared: string, table: string) => new RegExp(`(^|[^\\w])(?:[\\w"]+\\.)?"?${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?($|[^\\w])`, "i").test(declared);

// 낱말이 K1 글에 "쓰였나": 부정("no grant changes", "without role")으로만 나오면 쓴 것이 아니다
export function usesWord(k1: string, word: string): boolean {
  const stripped = k1.replace(new RegExp(`\\b(?:no|not|never|without|non|nor)\\b(?:\\W+\\w+){0,2}?\\W+${word}`, "gi"), " ");
  return new RegExp(`\\b${word}`, "i").test(stripped);
}

// 선언 글의 K1 부분: `K1`부터 다음 `K2`·`K3` 앞까지. K1이 없으면 null
export function k1Of(declared: string): string | null {
  const m = /\bK1\b[\s\S]*?(?=\bK[23]\b|$)/i.exec(declared);
  return m ? m[0] : null;
}

// files: 새 마이그레이션 파일(경로 → SQL). declared: 이슈 본문 `## K effects` 글
export function declarationCheck(files: readonly { path: string; sql: string }[], declared: string): DeclarationResult {
  const stopped: DeclarationResult["stopped"] = [];
  let statements = 0;
  // 민감한 낱말과 DML 표 이름은 K1 부분에서만 찾는다(K2·다른 글에 우연히 있는 낱말로 통과하지 않게)
  const k1text = k1Of(declared);
  const k1 = k1text !== null;
  for (const f of files) {
    const all = splitStatements(f.sql);
    // 맨 앞 BEGIN과 맨 뒤 COMMIT은 적용기가 떼어 내고 한 트랜잭션으로 감싼다(bodyStatements). 그 밖의 트랜잭션 문장(파일 중간의 COMMIT·BEGIN 등)은
    // 감싼 트랜잭션 밖에서 일부를 확정해 버려 "실전은 그대로"가 거짓이 되므로 멈춘다
    const lead = all.length > 0 && /^(begin|start transaction)\b/.test(headOf(all[0]!)) ? 1 : 0;
    const tail = all.length > lead && /^(commit|end)\b/.test(headOf(all[all.length - 1]!)) ? 1 : 0;
    for (const [i, s] of all.entries()) {
      const c = classify(s);
      if (c.kind === "txn") {
        if (i < lead || i >= all.length - tail) continue;
        statements++;
        stopped.push({ file: f.path, sql: c.sql, why: "파일 중간의 트랜잭션 문장(적용기가 감싼 트랜잭션 밖에서 확정됨)" });
        continue;
      }
      statements++;
      if (!k1) {
        stopped.push({ file: f.path, sql: c.sql, why: "K1 효과가 선언되지 않음" });
      } else if (c.kind === "destructive" || c.kind === "unknown") {
        stopped.push({ file: f.path, sql: c.sql, why: c.why ?? "" });
      } else if (c.kind === "sensitive" && (c.needs ?? []).some((w) => !usesWord(k1text!, w))) {
        const miss = (c.needs ?? []).filter((w) => !usesWord(k1text!, w));
        stopped.push({ file: f.path, sql: c.sql, why: `K1 선언에 ${miss.map((w) => `\`${w}\``).join(", ")}가 없음(접근·기존 동작을 바꾸는 문장)` });
      } else if (c.kind === "dml" && !(c.table && mentions(k1text!, c.table))) {
        stopped.push({ file: f.path, sql: c.sql, why: `선언에 없는 DML(표 ${c.table ?? "?"})` });
      }
    }
  }
  return { ok: stopped.length === 0 && statements > 0, statements, stopped };
}

// 적용할 문장 목록: 파일 자체의 맨 앞 BEGIN과 맨 뒤 COMMIT은 떼어 낸다(적용기가 파일마다 한 트랜잭션으로 감싸고 버전 줄을 같이 넣는다)
export function bodyStatements(sql: string): string[] {
  const all = splitStatements(sql);
  const first = all[0];
  if (first && TXN.test(headOf(first)) && /^(begin|start transaction)/.test(headOf(first))) all.shift();
  const last = all[all.length - 1];
  if (last && /^(commit|end)\b/.test(headOf(last))) all.pop();
  return all;
}
