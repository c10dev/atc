// 화면이 서버를 부르는 유일한 문. `fetch("/api…")`는 이 파일 밖에 쓰지 않는다(web/src/api.test.ts가 지킨다).
// Response를 그대로 돌려줘서 호출부의 ok·status·오류 처리는 그대로다. JSON 본문은 apiSend가 직렬화한다.

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** GET. init에는 signal 같은 fetch 옵션만 넘긴다. */
export function apiGet(path: string, init?: Omit<RequestInit, "method" | "body">): Promise<Response> {
  return fetch(path, init);
}

/** JSON 본문을 싣는 쓰기 호출. body를 생략하면 본문 없이 보낸다. */
export function apiSend(method: ApiMethod, path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
