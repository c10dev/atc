#!/usr/bin/env node
// MCC 한 구간의 비용 보고(ATC-135): 호출당 평균 컨텍스트, 시간당 $, INSPECTION한 PR당 $(하위 에이전트 기록 포함).
// 읽기만: MCC 세션 대화 기록(~/.claude/projects/<MCC 폴더>/*.jsonl, <세션>/subagents/*.jsonl)과 GET /api/mcc.
// 사용: node mcc/cost-report.mjs --since 2026-09-30T00:00:00Z [--until 2026-10-01T00:00:00Z] [--label after] [--dir <대화 기록 폴더>] [--base http://localhost:7700]
// 가격은 server/fuel-prices.json. 값 없는 모델은 $에서 빠지고 unpriced로 센다. 표의 한 줄(마크다운)과 JSON을 찍는다.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { costOf, parsePriceTable, rateOf } from "../server/fuel-cost.ts";
import { dedupeFuel, parseFuelLines } from "../server/fuel.ts";

const HOUR = 3_600_000;

// 순수: 요청 기록(중복 제거 뒤)과 구간 → 보고
// records: FuelRecord[], inspected: 구간 안 INSPECTION(head 단위 하나) 수, table: PriceTable
export function report(records, { since, until, inspected, table }) {
  const inWin = records.filter((r) => Date.parse(r.t) >= since && Date.parse(r.t) < until);
  const main = inWin.filter((r) => !r.sidechain);
  const sub = inWin.filter((r) => r.sidechain);
  const usd = (rs) => {
    let total = 0;
    let unpriced = 0;
    for (const r of rs) {
      const rate = rateOf(table, r);
      if ("unpriced" in rate) unpriced++;
      else total += costOf(r, rate.rate).total;
    }
    return { total, unpriced };
  };
  const ctx = (r) => r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
  const m = usd(main);
  const s = usd(sub);
  const hours = (until - since) / HOUR;
  const all = m.total + s.total;
  return {
    hours: round(hours, 2),
    mainCalls: main.length,
    subCalls: sub.length,
    avgContext: main.length ? Math.round(main.reduce((a, r) => a + ctx(r), 0) / main.length) : 0,
    maxContext: main.reduce((a, r) => Math.max(a, ctx(r)), 0),
    usdMain: round(m.total, 2),
    usdSub: round(s.total, 2),
    usdPerHour: hours > 0 ? round(all / hours, 2) : null,
    inspected,
    usdPerInspected: inspected > 0 ? round(all / inspected, 2) : null,
    unpriced: m.unpriced + s.unpriced,
  };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// 순수: /api/mcc 기록 → 구간 안 INSPECTION 수(PR+head 하나씩)
export function inspectedIn(mccRecords, since, until) {
  const seen = new Set();
  for (const r of mccRecords) if (r.op === "inspect" && Date.parse(r.at) >= since && Date.parse(r.at) < until) seen.add(`${r.pr}@${r.head}`);
  return seen.size;
}

// 마크다운 표의 한 줄
export const rowOf = (label, r) => `| ${label} | ${r.avgContext} | ${r.usdPerHour ?? "—"} | ${r.usdPerInspected ?? "—"} | ${r.inspected} | ${r.mainCalls} + ${r.subCalls} |`;

function loadRecords(dir) {
  const map = new Map();
  const read = (file, opts) => {
    try {
      dedupeFuel(parseFuelLines(readFileSync(file, "utf8"), opts).records, map);
    } catch {}
  };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".jsonl")) read(join(dir, e.name), { session: e.name.slice(0, -6) });
    else if (e.isDirectory()) {
      try {
        for (const f of readdirSync(join(dir, e.name, "subagents"))) if (f.endsWith(".jsonl")) read(join(dir, e.name, "subagents", f), { session: e.name, crew: true, agent: f.replace(/^agent-|\.jsonl$/g, "") });
      } catch {}
    }
  }
  return [...map.values()];
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const since = Date.parse(opt("--since", ""));
  if (!Number.isFinite(since)) throw new Error("--since <ISO 시각>이 필요하다");
  const until = opt("--until") ? Date.parse(opt("--until")) : Date.now();
  const dir = opt("--dir", join(homedir(), ".claude/projects/-home-c10-projects-atc-mcc"));
  const base = opt("--base", "http://localhost:7700");
  const table = parsePriceTable(JSON.parse(readFileSync(new URL("../server/fuel-prices.json", import.meta.url), "utf8")));
  const mcc = (await (await fetch(`${base}/api/mcc`)).json()).records;
  const r = report(loadRecords(dir), { since, until, inspected: inspectedIn(mcc, since, until), table });
  console.log(rowOf(opt("--label", "window"), r));
  console.log(JSON.stringify(r));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
