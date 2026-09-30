// macOS 메뉴 막대(SwiftBar) 표시 줄을 만드는 순수 함수(ATC-149). 읽기만 하고 입출력은 atc.15s.mjs가 한다.
// 입력: GET /api/supervisor-alerts(alerts: 항목 목록)와 GET /api/supervisor-summary(summary: 숫자·FUEL·RTS·일하는 수, ATC-153).
// 숫자는 서버가 센다(server/supervisor-summary.ts) — 여기서는 세지 않고 그대로 보인다. 토큰·CORS 없음.

const LEVEL_ORDER = ["warning", "caution", "advisory"];
const LEVEL_LABEL = { warning: "WARNING", caution: "CAUTION", advisory: "ADVISORY" };
// 제목 색: warning 빨강, caution 호박. advisory만 있으면 기본색(색 지정 없음)
const LEVEL_COLOR = { warning: "#FF3B30", caution: "#FF9500" };
const MAX_TEXT = 110;
const MAX_PER_LEVEL = 15; // 등급마다 이만큼만 펼친다(메뉴가 화면을 넘지 않게). 나머지는 atc에서

export const DEFAULT_BASE = "http://localhost:7700";

// SwiftBar 한 줄: `제목 | 이름=값 …`. 제목의 `|`는 매개변수 구분자라서 닮은 글자(¦)로 바꾸고, 줄바꿈은 공백으로,
// 맨 앞 `-`는 하위 메뉴 표시라서 en dash로 바꾼다. 너무 길면 자른다.
export function esc(text) {
  let t = String(text ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "¦");
  if (t.length > MAX_TEXT) t = `${t.slice(0, MAX_TEXT - 1)}…`;
  return t.replace(/^-/, "–");
}

// 매개변수 값에도 `|`나 공백이 있으면 안 된다(주소는 그대로 쓰되 공백·`|`만 막는다)
const hrefOf = (base, link) => `${base.replace(/\/+$/, "")}/${String(link ?? "").replace(/^\/+/, "")}`.replace(/\s/g, "%20").replace(/\|/g, "%7C");
const line = (text, params = {}) => {
  const p = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" ");
  return p ? `${esc(text)} | ${p}` : esc(text);
};

const rank = (level) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);
export const itemsOf = (alerts) => (Array.isArray(alerts?.items) ? alerts.items.filter((i) => i && typeof i.key === "string") : []);

// 요약의 fuel(가장 많이 쓴 ACCOUNT)의 5시간·7일 사용률: `5h 33% · 7d 53%`. 없으면 null
export function fuelOf(summary) {
  const windows = summary?.fuel?.windows ?? [];
  const win = (name) => windows.find((w) => w.name === name)?.pct;
  const parts = [["5h", win("five_hour")], ["7d", win("seven_day")]].filter(([, pct]) => typeof pct === "number").map(([k, pct]) => `${k} ${Math.round(pct)}%`);
  return parts.length ? parts.join(" · ") : null;
}

// 시각은 화면(atc)과 같이 UTC `HH:MMZ`로 보인다(ATC-152). Mac의 시간대에 따라 다르게 읽히지 않게
export function zTime(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

// 마지막 RTS: `RTS ok 15:21Z · aaaaaaa → bbbbbbb`
const short = (sha) => (sha ? String(sha).slice(0, 7) : "?");
export function rtsLine(summary) {
  const r = summary?.rts;
  if (!r?.at) return null;
  return `RTS ${r.result ?? "?"} ${zTime(r.at)} · ${short(r.from)} → ${short(r.to)}`;
}

// 제목 줄. 조치가 필요한 WARNING·CAUTION 수(화면 상단 숫자와 같다), advisory가 있으면 `+n`, 그리고 FUEL. 색은 요약의 master
export function titleOf({ summary }) {
  const c = summary?.counts ?? { warning: 0, caution: 0, advisory: 0 };
  const act = c.warning + c.caution;
  const fuel = fuelOf(summary);
  const text = `✈ ${act}${c.advisory ? ` +${c.advisory}` : ""}${fuel ? ` ${fuel}` : ""}`;
  return line(text, LEVEL_COLOR[summary?.master] ? { color: LEVEL_COLOR[summary.master] } : {});
}

// 메뉴 전체(SwiftBar 출력 줄)
export function menuLines({ alerts, summary, base = DEFAULT_BASE }) {
  const items = itemsOf(alerts);
  const out = [titleOf({ summary }), "---"];
  if (!items.length) out.push(line("지금 알릴 것 없음"));
  for (const level of LEVEL_ORDER) {
    const group = items.filter((i) => i.level === level);
    if (!group.length) continue;
    out.push(line(`${LEVEL_LABEL[level]} ${group.length}`, LEVEL_COLOR[level] ? { color: LEVEL_COLOR[level] } : {}));
    for (const i of group.slice(0, MAX_PER_LEVEL)) {
      out.push(line(`${i.text}${i.next ? ` — ${i.next}` : ""}`, { href: hrefOf(base, i.link) }));
    }
    if (group.length > MAX_PER_LEVEL) out.push(line(`외 ${group.length - MAX_PER_LEVEL}개 — atc에서 보기`, { href: hrefOf(base, "#radar") }));
  }
  // 등급이 없는 옛 항목은 맨 끝에
  const rest = items.filter((i) => !LEVEL_ORDER.includes(i.level));
  if (rest.length) {
    out.push(line(`기타 ${rest.length}`));
    for (const i of rest) out.push(line(`${i.text}${i.next ? ` — ${i.next}` : ""}`, { href: hrefOf(base, i.link) }));
  }
  out.push("---");
  out.push(line(`DISPATCH 승인 대기 ${summary?.pending?.dispatch ?? 0}`, { href: hrefOf(base, "#dispatch") }));
  const rts = rtsLine(summary);
  if (rts) out.push(line(rts, { href: hrefOf(base, "#radar") })); // UPDATE 바가 있는 탭(RTS 알림 항목의 link와 같다)
  const w = summary?.working;
  const parts = [typeof w?.aircraft === "number" && `AIRCRAFT ${w.aircraft}`, typeof w?.control === "number" && `관제 세션 ${w.control}`].filter(Boolean);
  if (parts.length) out.push(line(`일하는 중: ${parts.join(" · ")}`, { href: hrefOf(base, "#fleet") }));
  out.push("---", line("Open atc", { href: hrefOf(base, "") }), line("Refresh", { refresh: "true" }));
  return out;
}

// atc에 닿지 않을 때: 오류 덩어리 대신 한 줄
export function unreachableLines({ base = DEFAULT_BASE } = {}) {
  return ["✈ —", "---", line("atc 연결 안 됨: SSH 포워딩 확인"), "---", line("Open atc", { href: hrefOf(base, "") }), line("Refresh", { refresh: "true" })];
}

// 알림: 이번에 처음 본 key 가운데 level이 warning이거나 cue가 call인 것. seen은 { key: 본 시각(ms) }
// 처음 실행(seen이 null)이면 지금 있는 것을 모두 본 것으로 치고 알리지 않는다(켜자마자 수십 개가 쏟아지지 않게)
export function newAlerts(items, seen) {
  if (!seen) return [];
  return items.filter((i) => !(i.key in seen) && (i.level === "warning" || i.cue === "call"));
}

// 본 key를 갱신한다: 지금 있는 key를 모두 넣고, 7일 지난 것은 지운다
export const SEEN_TTL_MS = 7 * 24 * 60 * 60_000;
export function nextSeen(items, seen, now) {
  const out = {};
  for (const [k, at] of Object.entries(seen ?? {})) if (now - at < SEEN_TTL_MS) out[k] = at;
  for (const i of items) out[i.key] ??= now;
  return out;
}

// SwiftBar 알림 주소(swiftbar://notify). 눌러서 열 곳은 그 항목의 탭
export function notifyUrl({ plugin, item, base = DEFAULT_BASE }) {
  const q = new URLSearchParams({
    plugin,
    title: `atc ${item.level ? LEVEL_LABEL[item.level] ?? "" : ""}${item.cue === "call" ? " CALL" : ""}`.replace(/\s+/g, " ").trim(),
    body: esc(item.text),
    href: hrefOf(base, item.link),
  });
  return `swiftbar://notify?${q.toString().replace(/\+/g, "%20")}`;
}
