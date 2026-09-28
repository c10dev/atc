import type { Context } from "hono";

// 이 화면(localhost)에서 온 JSON 요청만 받는다. 다른 사이트가 브라우저를 통해 설정을 바꾸지 못하게.
// 관제 세션의 CLI(atcctl)는 Origin을 보내지 않으니 이 검사를 통과하지 못한다(SUPERVISOR 전용 스위치, ATC-34)
export function fromThisApp(c: Pick<Context, "req">): boolean {
  if (!c.req.header("content-type")?.startsWith("application/json")) return false;
  const origin = c.req.header("origin");
  if (!origin) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}
