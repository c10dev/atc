// 화면이 서버를 부르는 유일한 문. `fetch("/api…")`는 이 파일 밖에 쓰지 않는다(web/src/api.test.ts가 지킨다).
// Response를 그대로 돌려줘서 호출부의 ok·status·오류 처리는 그대로다. JSON 본문은 apiSend가 직렬화한다.

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** GET. init에는 signal 같은 fetch 옵션만 넘긴다. */
export function apiGet(path: string, init?: Omit<RequestInit, "method" | "body">): Promise<Response> {
  return fetch(path, init);
}

// SUPERVISOR 자격(ATC-373, server/supervisor-auth.ts): 이 기기의 브라우저만 가진 비밀. 서버에는 해시만 있다. localStorage에만 두고 어디에도 쓰거나 로그하지 않는다
const SECRET_KEY = "atc.supervisor.secret";
export function supervisorSecret(): string | null {
  try {
    return localStorage.getItem(SECRET_KEY);
  } catch {
    return null;
  }
}
export function makeSupervisorSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    localStorage.setItem(SECRET_KEY, secret);
  } catch {
    // 저장하지 못하면 이 탭에서만 쓴다(다음에 다시 짝을 짓는다)
  }
  return secret;
}
export async function supervisorHash(secret: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** 이 기기의 자격을 서버가 받아들이나: valid · invalid · missing · unpaired · insecure. 서버에 닿지 못하면 null */
export async function apiSupervisorVerdict(): Promise<string | null> {
  const secret = supervisorSecret();
  try {
    const r = await fetch("/api/supervisor/auth", secret ? { headers: { "X-ATC-Supervisor": secret } } : undefined);
    return r.ok ? (((await r.json()) as { verdict?: string }).verdict ?? null) : null;
  } catch {
    return null;
  }
}

/** JSON 본문을 싣는 쓰기 호출. body를 생략하면 본문 없이 보낸다. */
export function apiSend(method: ApiMethod, path: string, body?: unknown): Promise<Response> {
  const secret = supervisorSecret();
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(secret ? { "X-ATC-Supervisor": secret } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
