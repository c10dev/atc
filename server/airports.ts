import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Airport } from "./model.ts";

// 저장소 = 공항. ICAO 공항 코드처럼 대문자 4자. airports.json(저장소 폴더 이름 → 코드)이 우선이고,
// 없는 저장소는 이름에서 만든다. 파일은 스냅샷마다 다시 읽으므로 고치면 재시작 없이 반영된다.
const CODE = /^[A-Z]{4}$/;
const OVERRIDES = new URL("../airports.json", import.meta.url);

function readOverrides(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(OVERRIDES, "utf8"));
  } catch {
    return {};
  }
}

// 첫 글자 + 이어지는 자음, 모자라면 나머지 글자, 그래도 모자라면 X. 겹치면 마지막 글자를 바꾼다.
export function deriveCode(name: string, taken: Set<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "") || "X";
  const base = (letters[0] + letters.slice(1).replace(/[AEIOU]/g, "") + letters.slice(1)).slice(0, 4).padEnd(4, "X");
  if (!taken.has(base)) return base;
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const alt = base.slice(0, 3) + c;
    if (!taken.has(alt)) return alt;
  }
  return base;
}

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[atc] airports.json: ${message}`);
}

export function assignAirports(repos: string[], overrides = readOverrides()): Airport[] {
  const sorted = [...new Set(repos)].sort((a, b) => basename(a).localeCompare(basename(b)));
  const taken = new Set<string>();
  const codes = new Map<string, string>();
  for (const repo of sorted) {
    const code = overrides[basename(repo)];
    if (code === undefined) continue;
    if (!CODE.test(code)) warnOnce(`${basename(repo)}: "${code}"는 대문자 4자가 아니라 자동 코드를 씀`);
    else if (taken.has(code)) warnOnce(`${basename(repo)}: "${code}"가 이미 쓰여 자동 코드를 씀`);
    else {
      taken.add(code);
      codes.set(repo, code);
    }
  }
  for (const repo of sorted) {
    if (codes.has(repo)) continue;
    const code = deriveCode(basename(repo), taken);
    taken.add(code);
    codes.set(repo, code);
  }
  return sorted.map((repo) => ({ repo, name: basename(repo), code: codes.get(repo)! }));
}
