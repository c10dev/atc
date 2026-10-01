import assert from "node:assert/strict";
import { test } from "node:test";
import { QRH_CODES, type QrhCondition, type QrhInput, qrhConditionsOf, qrhKey, qrhOf, qrhSweep } from "./qrh.ts";
import { sinceOf } from "./qrh-run.ts";

const AT = "2026-10-01T05:00:00.000Z";

test("qrhOf: 표의 코드는 체크리스트 ID(<kind>-<nn>-<slug>)로, 모르는 코드는 null", () => {
  assert.equal(qrhOf("STALLED")?.id, "qrh-02-stalled");
  assert.equal(qrhOf("undelivered")?.id, "qrh-03-undelivered");
  assert.equal(qrhOf("overdue")?.id, "qrh-03-undelivered");
  assert.equal(qrhOf("GO AROUND")?.id, "qrh-04-go-around");
  assert.equal(qrhOf("arrivalMissing")?.id, "qrh-05-arrival-missing");
  assert.equal(qrhOf("RESUME"), null); // 한도 뒤 잇기는 다른 절차
  assert.equal(qrhOf("no-pr"), null);
  assert.equal(qrhOf("constructor"), null); // 객체 상속 키로 새지 않는다
  for (const c of QRH_CODES) assert.match(qrhOf(c)!.id, /^(sop|cl|qrh|mel)-\d\d-[a-z0-9-]+$/);
  assert.equal(qrhOf("qrh-01-lost-comms"), null); // 서버 코드가 아직 없는 조건은 표에 없다
});

test("sweep: 같은 subject는 풀릴 때까지 한 번만, 풀리면 다시 참일 때 새로 적는다", () => {
  const c: QrhCondition = { code: "GO AROUND", subject: "C-0123", session: "s1", aircraft: "TEAM_A", flight: "ATC-1" };
  const first = qrhSweep([c], new Set(), AT);
  assert.deepEqual(first.lines, [{ t: AT, kind: "qrh", op: "named", id: "qrh-04-go-around", code: "GO AROUND", session: "s1", aircraft: "TEAM_A", flight: "ATC-1", subject: "C-0123" }]);
  const again = qrhSweep([c], first.open, AT);
  assert.deepEqual(again.lines, []); // 다음 tick: 적지 않는다
  assert.deepEqual([...again.open], [qrhKey("qrh-04-go-around", "C-0123")]);
  const cleared = qrhSweep([], again.open, AT);
  assert.deepEqual(cleared.lines, []);
  assert.equal(cleared.open.size, 0); // 풀림
  assert.equal(qrhSweep([c], cleared.open, AT).lines.length, 1); // 다시 생기면 다시 한 줄
});

test("sweep: 같은 체크리스트에 코드가 둘이어도 subject가 같으면 한 줄, subject가 다르면 각각", () => {
  const two = qrhSweep(
    [
      { code: "undelivered", subject: "D-0305" },
      { code: "overdue", subject: "D-0305" },
      { code: "overdue", subject: "D-0306" },
    ],
    new Set(),
    AT,
  );
  assert.deepEqual(two.lines.map((l) => `${l.code}:${l.subject}`), ["undelivered:D-0305", "overdue:D-0306"]);
});

test("sweep: 표에 없는 코드는 적지 않고, 선택 칸이 없으면 줄에도 없다(글은 싣지 않는다)", () => {
  const r = qrhSweep([{ code: "no-pr", subject: "X" }, { code: "STALLED", subject: "TEAM_B" }], new Set(), AT);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(Object.keys(r.lines[0]), ["t", "kind", "op", "id", "code", "subject"]);
});

test("sweep: 재시작 뒤 열린 키로 시작하면 아직 참인 조건을 다시 적지 않고 풀린 것은 빠진다", () => {
  const seed = new Set([qrhKey("qrh-02-stalled", "TEAM_B"), qrhKey("qrh-02-stalled", "TEAM_C")]);
  const r = qrhSweep([{ code: "STALLED", subject: "TEAM_B" }], seed, AT);
  assert.deepEqual(r.lines, []);
  assert.deepEqual([...r.open], [qrhKey("qrh-02-stalled", "TEAM_B")]);
});

const input = (over: Partial<QrhInput> = {}): QrhInput => ({
  sessions: [], proposals: [], overdue: [], undelivered: [], clearances: [], arrivalMissing: [], regOf: (n) => n.toUpperCase(), ...over,
});

test("조건 모으기: STALLED는 죽지 않은 세션만, REGISTRATION이 subject", () => {
  const out = qrhConditionsOf(
    input({
      sessions: [
        { id: "s1", name: "team_b", status: "idle", health: { code: "STALLED" } },
        { id: "s2", name: "team_c", status: "dead", health: { code: "STALLED" } },
        { id: "s3", name: "team_d", status: "idle", health: { code: "RESUME" } },
        { id: "s4", name: "team_e", status: "idle", health: null },
      ],
    }),
  );
  assert.deepEqual(out, [{ code: "STALLED", subject: "TEAM_B", session: "s1", aircraft: "TEAM_B" }]);
});

test("조건 모으기: overdue는 sent·recalling만(출발·도착 지연은 다른 절차), undelivered는 제안 id", () => {
  const proposals = [
    { id: "D-1", flight: "ATC-1", aircraftName: "team_a", status: "sent" },
    { id: "D-2", flight: "ATC-2", aircraftName: "team_b", status: "recalling" },
    { id: "D-3", flight: "ATC-3", aircraftName: "team_c", status: "accepted" },
    { id: "D-4", flight: "ATC-4", aircraftName: "team_d", status: "departed" },
  ];
  const out = qrhConditionsOf(input({ proposals, overdue: ["D-1", "D-2", "D-3", "D-4", "D-9"], undelivered: [{ id: "D-5", flight: "ATC-5", aircraft: "team_e" }] }));
  assert.deepEqual(out.map((c) => `${c.code}:${c.subject}`), ["undelivered:D-5", "overdue:D-1", "overdue:D-2"]);
  assert.equal(out[0].aircraft, "TEAM_E");
  assert.equal(out[0].flight, "ATC-5");
});

test("조건 모으기: GO AROUND는 열린 것만(READBACK·취소·UNABLE로 닫히면 풀림), arrivalMissing은 due만", () => {
  const cl = (id: string, over: Record<string, unknown> = {}) => ({ id, to: `s-${id}`, toName: "team_a", type: "GO AROUND", flight: "ATC-1", readbackAt: null, cancelledAt: null, ...over });
  const out = qrhConditionsOf(
    input({
      clearances: [cl("C-1"), cl("C-2", { readbackAt: AT }), cl("C-3", { cancelledAt: AT }), cl("C-4", { unableAt: AT }), cl("C-5", { type: "HOLD" })],
      arrivalMissing: [
        { flight: "ATC-7", aircraft: "team_b", due: true },
        { flight: "ATC-8", aircraft: null, due: false },
      ],
    }),
  );
  assert.deepEqual(out.map((c) => `${c.code}:${c.subject}`), ["GO AROUND:C-1", "arrivalMissing:ATC-7"]);
  assert.equal(out[0].session, "s-C-1");
  assert.equal(out[1].aircraft, "TEAM_B");
});

test("since: ISO·밀리초·없음·이상한 값", () => {
  const now = Date.parse("2026-10-01T05:00:00.000Z");
  assert.equal(sinceOf(undefined, now), now - 86_400_000);
  assert.equal(sinceOf("2026-10-01T00:00:00.000Z", now), Date.parse("2026-10-01T00:00:00.000Z"));
  assert.equal(sinceOf("1759290000000", now), 1759290000000);
  assert.equal(sinceOf("nonsense", now), now - 86_400_000);
});
