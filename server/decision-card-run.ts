import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { type Decision, type DecisionOp, decisionAnswerOf, decisionDefaultOf, decisionInputOf, duplicateOf, foldDecisions, isDecisionRole, nextDecisionId } from "./decision-card.ts";
import { fromThisApp } from "./origin.ts";
import { bustQueue } from "./queue-bust.ts";
import { record } from "./recorder.ts";

// DECISION 카드(ATC-352)의 쓰기·읽기. 계산은 decision-card.ts(순수). 추가만 하는 decision-cards.jsonl(create → answer | withdraw → ack)을 접어 상태를 만든다.
// 올리는 길(POST /api/decisions)은 atcctl이 쓴다: 카드를 올릴 뿐 승인·전송·머지를 하지 않는다. 답하는 길은 이 화면의 클릭뿐이다(fromThisApp).
const FILE = () => join(config.stateDir, "decision-cards.jsonl");

export function readDecisionOps(file = FILE()): DecisionOp[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const ops: DecisionOp[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

function append(op: DecisionOp, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(op) + "\n");
  bustQueue(); // 카드가 곧바로 뜨고 사라진다
}

export const allDecisions = (): Decision[] => foldDecisions(readDecisionOps());

export function mountDecisionCards(app: Hono) {
  // 관제 세션이 올린다. 같은 role·key의 카드가 있으면 새로 만들지 않고 그것을 돌려준다
  app.post("/api/decisions", async (c) => {
    const input = decisionInputOf(await c.req.json().catch(() => null));
    if ("error" in input) return c.json(input, 400);
    const ops = readDecisionOps();
    const dup = duplicateOf(foldDecisions(ops), input.role, input.key);
    if (dup) return c.json({ decision: dup, duplicate: true });
    const at = new Date().toISOString();
    const id = nextDecisionId(ops);
    append({ op: "create", id, at, ...input });
    record({ t: at, kind: "decision", op: "create", id, by: input.role, key: input.key, pr: input.pr?.number ?? null });
    return c.json({ decision: allDecisions().find((d) => d.id === id), duplicate: false });
  });

  // K1–K3가 아닌 결정을 기본값으로 진행했다는 기록: 카드를 만들지 않고 FLIGHT RECORDER에만 적는다
  app.post("/api/decisions/default", async (c) => {
    const input = decisionDefaultOf(await c.req.json().catch(() => null));
    if ("error" in input) return c.json(input, 400);
    record({ t: new Date().toISOString(), kind: "decision", op: "default", by: input.role, key: input.key, what: input.what, chose: input.chose });
    return c.json({ recorded: true, card: false });
  });

  // 그 역할의 카드(열린 것과 읽지 않은 답)
  app.get("/api/decisions", (c) => {
    const role = c.req.query("role");
    if (role !== undefined && !isDecisionRole(role)) return c.json({ error: "알 수 없는 role" }, 400);
    return c.json({ decisions: allDecisions().filter((d) => (role === undefined || d.role === role) && (d.status === "open" || (d.status === "answered" && !d.ackAt))) });
  });

  // SUPERVISOR가 화면에서 답한다
  app.post("/api/decisions/:id/answer", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const id = c.req.param("id").toUpperCase();
    const d = allDecisions().find((x) => x.id === id);
    if (!d) return c.json({ error: "그런 카드가 없음" }, 404);
    if (d.status !== "open") return c.json({ error: `${id}는 이미 ${d.status}` }, 409);
    const a = decisionAnswerOf(d, await c.req.json().catch(() => null));
    if ("error" in a) return c.json(a, 400);
    const at = new Date().toISOString();
    append({ op: "answer", id, at, ...a });
    record({ t: at, kind: "decision", op: "answer", id, by: "supervisor", role: d.role, choice: a.choice });
    return c.json({ decision: allDecisions().find((x) => x.id === id) });
  });

  // 세션이 거둔다(더 필요 없는 결정). 올린 role만 거둔다
  app.post("/api/decisions/:id/withdraw", async (c) => {
    const id = c.req.param("id").toUpperCase();
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
    const d = allDecisions().find((x) => x.id === id);
    if (!d) return c.json({ error: "그런 카드가 없음" }, 404);
    if (body.role !== d.role) return c.json({ error: `${id}는 ${d.role}의 카드` }, 403);
    if (d.status !== "open") return c.json({ error: `${id}는 이미 ${d.status}` }, 409);
    const at = new Date().toISOString();
    append({ op: "withdraw", id, at });
    record({ t: at, kind: "decision", op: "withdraw", id, by: d.role });
    return c.json({ decision: allDecisions().find((x) => x.id === id) });
  });

  // 세션이 답을 읽고 표시한다
  app.post("/api/decisions/:id/ack", async (c) => {
    const id = c.req.param("id").toUpperCase();
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
    const d = allDecisions().find((x) => x.id === id);
    if (!d) return c.json({ error: "그런 카드가 없음" }, 404);
    if (body.role !== d.role) return c.json({ error: `${id}는 ${d.role}의 카드` }, 403);
    if (d.status !== "answered") return c.json({ error: `${id}는 ${d.status}라 읽을 답이 없음` }, 409);
    if (!d.ackAt) append({ op: "ack", id, at: new Date().toISOString() });
    return c.json({ decision: allDecisions().find((x) => x.id === id) });
  });
}
