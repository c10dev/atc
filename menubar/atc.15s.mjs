#!/usr/bin/env node
// <xbar.title>atc</xbar.title>
// <xbar.version>v1.0</xbar.version>
// <xbar.desc>SUPERVISOR 알림, DISPATCH 승인 대기, FUEL, RTS를 메뉴 막대에 보인다. 읽기만 한다(GET).</xbar.desc>
// <xbar.dependencies>node</xbar.dependencies>
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
// <swiftbar.environment>[ATC_URL:http://localhost:7700]</swiftbar.environment>
//
// SwiftBar 플러그인(ATC-149). Mac의 node가 15초마다 돌린다. atc는 localhost:7700으로 닿아야 한다(SSH 포워딩, docs/guide/menubar.md).
// 쓰기는 없다: GET만 하고, 항목을 누르면 브라우저로 atc 탭을 연다. 승인·ACK·스위치는 브라우저에서 한다.
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BASE, itemsOf, menuLines, newAlerts, nextSeen, notifyUrl, unreachableLines } from "./format.mjs";

const BASE = (process.env.ATC_URL || DEFAULT_BASE).replace(/\/+$/, "");
const PLUGIN = "atc";
const TIMEOUT_MS = 5000;

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
};
// 알림 목록은 꼭 있어야 하고(없으면 연결 안 됨), 나머지는 없으면 그 줄만 빠진다
const optional = (path) => get(path).catch(() => null);

// 본 key 캐시: SwiftBar의 플러그인 캐시 폴더(SWIFTBAR_PLUGIN_CACHE_PATH). atc 상태 폴더에는 쓰지 않는다
const cacheDir = process.env.SWIFTBAR_PLUGIN_CACHE_PATH || join(tmpdir(), "atc-menubar");
const seenFile = join(cacheDir, "seen.json");
const readSeen = () => {
  try {
    const v = JSON.parse(readFileSync(seenFile, "utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null; // 처음 실행이거나 읽을 수 없음
  }
};
const writeSeen = (seen) => {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(seenFile, JSON.stringify(seen));
  } catch {} // 캐시를 못 써도 메뉴는 보인다(다음 바퀴에 같은 알림이 다시 갈 수 있다)
};

let alerts;
try {
  alerts = await get("/api/supervisor-alerts");
} catch {
  console.log(unreachableLines({ base: BASE }).join("\n"));
  process.exit(0);
}
const [fleet, update, control] = await Promise.all([optional("/api/fleet"), optional("/api/update"), optional("/api/control/sessions")]);

console.log(menuLines({ alerts, fleet, update, control, base: BASE }).join("\n"));

const items = itemsOf(alerts);
const seen = readSeen();
for (const item of newAlerts(items, seen)) {
  execFile("open", ["-g", notifyUrl({ plugin: PLUGIN, item, base: BASE })], () => {});
}
writeSeen(nextSeen(items, seen, Date.now()));
