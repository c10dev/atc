# LINEAR RETRY (ATC-561)

[English](linear-retry.md) · **한국어**

Linear 호출이 가끔 `fetch failed`로 실패하면 SUPERVISOR의 일이 막혔다. `duty flight`, MCC INSPECTION 자료(`flight ATC-n: fetch failed`), DUTY 쓰기가 한 번 실패해 손으로 다시 해야 했고, 글에는 어느 구간이 실패했는지 없었다. 이 문서는 만든 것이다.

## 구간 둘

`fetch failed`는 글만으로는 가를 수 없는 두 곳에서 올 수 있고, 둘 다 실패할 수 있다:

| 구간 | 위치 | 오류 글의 이름 |
|---|---|---|
| atc 서버 → Linear | `server/sources/linear.ts`, `linear-write.ts`, `linear-labels.ts`, `linear-projects.ts`(모두 `server/linear-call.ts`를 지난다) | `(atc server → Linear)` |
| atcctl → atc 서버 | `controller/atcctl.mjs`의 `call()`(127.0.0.1:7700) | `(atcctl → atc server)` |

오류는 이제 `fetch failed (atc server → Linear) [dns ENOTFOUND]`처럼 구간, 원인 종류, 코드를 적는다. 200 응답 안의 GraphQL 오류는 자기 글을 그대로 둔다(네트워크 실패가 아니다).

## 다시 시도

`server/net-retry.ts`(순수, 의존성 없음, `atcctl.mjs`도 가져온다).

- **다시 시도하는 것.** 네트워크 수준 실패(`fetch failed`: DNS `ENOTFOUND`·`EAI_AGAIN`, 연결 `ECONNREFUSED`·`ECONNRESET`, 연결 시간 초과, 머리·본문 시간 초과)와 HTTP 429·502·503·504. 다시 시도하지 않는 것: 그 밖의 4xx, 500, 200 응답 안의 GraphQL 오류, TLS 오류.
- **방법.** 설정한 횟수(기본 2)까지, 지수 백오프에 ±20 % 지터: 약 250 ms, 약 1 s(셋째는 4 s). 429·503은 `Retry-After`가 더 길면 그 값(상한 5 s, 호출이 오래 매이지 않게). 시도마다 따로 10 s 시간 제한(`AbortSignal.timeout`)이라 다시 시도가 서버의 이벤트 루프를 붙들지 않는다.
- **설정.** `linearRetries`(`0`~`3`, 기본 `2`), `linear-retry.json`(원자적 JSON), 설정 → OPERATIONS → LINEAR RETRY, SUPERVISOR만(`fromThisApp`, `atcctl` 명령 없음, 바꾸면 `policy linear-retry-count`로 기록). `0`은 지금까지와 같다. `atcctl`은 상태 폴더의 같은 파일을 읽는다.
- **atcctl 구간.** GET은 다시 시도할 만한 실패(네트워크 실패, 429, 503)면 모두 다시 한다. 쓰기(POST 등)는 요청이 서버에 닿았을 수 없을 때(연결 거절·DNS·연결 시간 초과)만 다시 보내고, 끊김이나 시간 초과 뒤에는 보내지 않는다(서버가 이미 했을 수 있다). atc 서버가 돌려준 502·504는 `atcctl`이 다시 시도하지 않는다(서버가 자기 구간을 이미 다시 시도했다).

## 다시 보낸 쓰기는 두 번 생기지 않는다

Linear에 닿았을 수 있는 쓰기만 조심하면 된다. 요청이 컴퓨터를 떠나기 전에 실패했다면 그냥 다시 보낸다.

- **이슈 만들기.** 요청에 클라이언트가 고른 UUID를 `IssueCreateInput.id`로 싣는다. Linear에 닿았을 수 있는 실패 뒤 다시 보내기 전에 `issue(id)`를 물어 있으면 그 이슈가 결과이고 아무것도 보내지 않는다. 마지막 시도가 실패한 뒤에도 한 번 더 확인해, Linear가 받은 만들기를 실패로 알리지 않는다. Linear가 `id` 필드를 모른다고 거절하면(아무것도 만들어지지 않은 검증 오류) id 없이 다시 보내고, 다시 보내기 전마다 팀·제목·생성 시각(최근 5분)으로 이슈를 찾는다. 열린 ATC 이슈 제목 검사(409, ATC-488)는 그대로다.
- **댓글.** 같은 방식으로 `CommentCreateInput.id`와 `comment(id)`. `id`를 못 쓰면 그 이슈의 마지막 댓글 다섯 개에서 최근 2분 안의 같은 본문을 찾는다.
- **관계(`blocks`).** 다시 보내기 전에 그 이슈의 관계를 읽는다. 이미 `blocks` 관계가 있으면 끝난 것이다.
- **상태·라벨·필드 고치기**는 값을 정하는 것이라 되풀이해도 바뀌는 것이 없다.
- 읽기는 늘 되풀이해도 안전하다.

## 기록과 셈

실패한 시도, 다시 시도, 복구, 최종 실패마다 FLIGHT RECORDER에 `linear-call` 한 줄: `hop`, `op`(`read`·`create`·`update`·`comment`), `attempt`, `outcome`(`retry`·`recovered`·`gave-up`), `cause`(`dns`·`connect`·`timeout`·`tls`·`network`·`http`), `code`(`ENOTFOUND`, `ECONNRESET`, `UND_ERR_HEADERS_TIMEOUT`, `503` …)와 이슈 key가 있으면 key. 이슈 글·제목·토큰은 없다. 200 안의 GraphQL 오류는 기록하지 않는다.

`atcctl`은 기록기에 직접 쓸 수 없다. 한 번이라도 실패한 호출 뒤 그 시도들을 `POST /api/linear-calls/note`로 보낸다(값마다 정해진 목록으로 검사, 한 번에 8개까지, 그 밖은 받지 않는다). 서버에 아예 닿지 못하면 그 시도는 기록되지 않는다. 오류 글에는 원인이 그대로 있다.

`GET /api/linear-calls?days=N`(읽기만)이 구간·원인별 하루 셈을 준다: 실패한 시도, 다시 시도해 복구한 호출, 포기한 호출. METRICS → MISFIRE의 `LINEAR CALLS`가 지난 7일을 보인다. 이 셈이 misfire 카운터다.

## 쓰는 곳

MCC INSPECTION 자료와 `atcctl duty flight`는 같은 다시 시도하는 읽기(`fetchIssueDrawer` → `linearGql`)를 지나므로, 일시적 실패 한 번이 더는 `flight ATC-n: fetch failed`로 보이지 않는다. 모든 다시 시도를 넘긴 실패는 자료 글에 구간과 원인 종류가 적힌다.

## PILOT'S DISCRETION

- Linear 문서는 `id`를 `IssueCreateInput`·`CommentCreateInput`의 선택 필드로 적는다. 실제 API로는 확인하지 않았다(쓰기 시험은 진짜 이슈를 만든다). 위의 대체 길이 `id`를 거절하는 Linear를 덮는다.
- 시도마다 시간 제한 10 s(옛 고정값은 15 s), 지터 ±20 %, `Retry-After` 상한 5 s, `atcctl`은 429·503만.
- 새 알림 종류는 없다: 셈은 METRICS와 FLIGHT RECORDER에 있다.
