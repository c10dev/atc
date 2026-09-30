# 조사: atc의 ChatGPT 계정(여러 Codex CLI 로그인, 플랜 사용량, Codex 세션)

[English](chatgpt-codex-accounts.md) · **한국어**

> 상태: [ATC-237](https://linear.app/vocado/issue/ATC-237/survey-chatgpt-accounts-in-atc-run-several-codex-cli-logins-one-codex) SURVEY, 2026-09-30. 문서만 다뤘다. 코드·설정·`~/.codex*`·`~/.claude*` 폴더는 바꾸지 않았고, 로그인·로그아웃은 하지 않았고, 인증 파일(`auth.json`, `.credentials.json`)은 열거나 출력하지 않았고, ChatGPT 계정에 모델 호출을 하지 않았다. Codex 소스에 대한 사실은 태그 `rust-v0.154.0`(커밋 `6b9826e3`, 이 기계에 깔린 버전)에 맞춰 고정하고 permalink로 밝혔다. 다른 프로젝트에 대한 사실은 2026-09-30에 가져온 공개 저장소에서 왔다. 이슈·뉴스·검색 요약에서 가져온 것은 *unverified*로 표시했다. 로컬 측정은 비어 있고 로그인한 적 없는 스크래치 `CODEX_HOME`과 로컬 rollout 이벤트의 **칸 이름**만 썼다. ACCOUNT는 라벨로만 적는다.

## 1. 질문

SUPERVISOR는 Claude 계정 옆에 ChatGPT 계정을 두고 싶다. 설정 창에서 여러 개를 더하고, 하나의 ACCOUNTS 목록에서 플랜 사용량과 함께 보고, AIRCRAFT가 그 계정으로 Codex 세션을 날리게 하고 싶다([accounts.md](../accounts.md)). 지금 ACCOUNTS는 Claude뿐이다. `fleet.json`의 `accounts`는 `{label: {configDir}}`이고 `checkConfigDir`는 이름이 `.claude`로 시작하는 폴더만 받는다. Codex는 atc가 폴더 하나(`config.codexDir = ~/.codex`, `server/sources/codex.ts`: 오늘과 어제 rollout)만 읽는다. Codex 세션을 띄우거나 멈추지 않고, FUEL은 Codex `token_count`를 읽지 않는다([fuel.md](../fuel.md) 4장 "Not in F1").

이슈의 질문 넷: (1) 한 기계에서 ChatGPT 로그인 여럿, (2) 모델 호출 없는 플랜 사용량, (3) atc에서 Codex 세션 LAUNCH, (4) 약관이 말하는 것. 권고는 8장.

## 2. 방법과 여기서 잰 것

- 공개 출처: 고정한 태그의 Codex 소스, Codex 문서(`learn.chatgpt.com/docs`, `developers.openai.com/codex`의 새 주소), 6장 프로젝트의 공개 저장소, OpenAI가 공개한 약관.
- `codex --help`와 `codex <명령> --help`(0.154.0). `doctor`가 0.159.2가 나왔다고 알리므로 아래 프로토콜은 바뀔 수 있다.
- **`codex`를 돌린 것은 모두 `CODEX_HOME`을 비어 있는 스크래치 폴더**(작업 임시 폴더 아래)로 두고 돌렸다. `~/.codex`는 한 번도 대상이 아니었다. 명령: `codex login status`, `codex doctor --summary`, `codex app-server generate-json-schema --out <스크래치>`, 그리고 `codex app-server`(stdio)를 띄워 `initialize`, `account/read`, `account/rateLimits/read`, `account/usage/read`를 보내 보는 작은 스크립트. 모델 호출은 없고 로그인도 될 수 없는 명령들이다.
- **로컬 rollout**(`~/.codex/sessions`, 445개)은 칸 이름과 개수만 읽었고 내용은 읽지 않았다.
- 재지 못한 것과 이유: 로그인된 홈이 필요한 모든 것. 로그인된 `app-server` 읽기는 `~/.codex`에 돌리면(금지: 토큰을 갱신하고 상태를 쓸 수 있다) 안 되고, 로그인이 필요하다(금지). 구현 이슈가 SUPERVISOR가 로그인한 ACCOUNT에서 재야 한다(9장).

### 2.1 측정(스크래치 `CODEX_HOME`)

| 무엇 | 결과 |
|---|---|
| `codex login status`(로그아웃) | `Not logged in`을 찍고 종료 코드 1 |
| `codex doctor --summary` | `auth` 실패("no Codex credentials were found"), `app-server`는 "not running (ephemeral mode)", `websocket`은 이 호스트에서 경고(HTTPS 대체 경로는 될 수 있음) |
| `login status`, `doctor`, `generate-json-schema`, `app-server` 한 번을 돌린 뒤 빈 폴더에 생긴 파일 | `installation_id`, SQLite `state_5`·`logs_2`·`goals_1`·`memories_1`·`queue_1`(각각 `-shm`, `-wal` 포함), `skills/.system/…`(내장 시스템 skill, 수십 개 파일), `.tmp/`(플러그인 잠금과 git 임시 폴더), `tmp/arg0/`. `auth.json`, `config.toml`, `sessions/`는 **없다** |
| stdio의 `codex app-server` | `initialize` 응답 **167 ms**, RSS **약 50 MB**. 알림 하나(`remoteControl/status/changed`), stderr에는 아무것도 없음 |
| `account/read`(로그아웃) | 약 2 ms에 로컬로 답함: `{account: null에 가까운 객체, requiresOpenaiAuth: boolean}` |
| `account/rateLimits/read`, `account/usage/read`(로그아웃) | 오류 `-32600` "codex account authentication required to read rate limits" / "…token usage", 네트워크 호출 전에 0~1 ms에 로컬로 답함 |
| `codex app-server generate-json-schema` | 최상위 스키마 파일 39개와 `v1/`, `v2/`. `ClientRequest`에 4장에서 쓰는 메서드(`account/*`, `thread/*`, `turn/*`)가 있다 |
| 실제 `~/.codex` 파일 이름(이름만) | `auth.json`, `config.toml`(과 백업), `history.jsonl`, `sessions/`, `archived_sessions/`, `memories/`, `plugins/`, `app-server-control/`, SQLite 상태 파일(`logs_2.sqlite`는 약 410 MB), opencodex 프록시 설정과 카탈로그 |

### 2.2 로컬 rollout: `rate_limits`는 모델 provider에 달렸다

로컬 rollout 445개의 칸 이름에서(내용은 읽지 않음):

- `token_count` 이벤트의 payload 키: `info`(`last_token_usage`, `model_context_window`, `total_token_usage`)와 `rate_limits`(`credits`, `individual_limit`, `limit_id`, `limit_name`, `plan_type`, `primary`, `rate_limit_reached_type`, `secondary`, `spend_control_reached`). `primary`·`secondary`는 `resets_at`, `used_percent`, `window_minutes`를 가진다.
- `session_meta.model_provider`는 `openai` 431개, `opencodex` 13개, 그 밖 하나. `openai`의 `token_count` 49,547건 중 **40,239건(81 %)은 `primary`가 null이 아니고**, `opencodex`는 **373건 중 0건**이다. `openai` rollout 가운데 가장 새 것은 2026-09-21이고, 그 뒤의 rollout은 이 기계에서 모두 `opencodex`이며 `primary`가 null이 아닌 것은 없다.
- 본 창 길이: 300분과 10,080분 한 쌍(5시간 창과 주간 창), 그리고 10,080분, 43,200분 단독 창. 어느 플랜이 어떤 모양인지는 자료로는 모른다. FUEL은 창을 이름이 아니라 길이로 읽어야 한다.
- 그래서 "opencodex 프록시가 두 번째 로그인에 영향을 주는가"의 답: **rollout을 수동으로 읽을 때는 그렇고, app-server 읽기에는 아니다.** 이 스냅숏은 provider가 OpenAI 자신의 ChatGPT 백엔드(`requires_openai_auth`, 4.2)일 때만 만들어진다. `config.toml`에 `model_provider = "opencodex"`가 있는 폴더는 한도가 null인 rollout을 만든다. atc가 만든 새 ACCOUNT 폴더에는 `config.toml`이 없어 기본 provider를 쓰므로 FUEL에 필요한 대로 된다. 이 기계의 `~/.codex/config.toml`을 복사하면 프록시가 따라간다.

## 3. Codex 쪽(`CODEX_HOME`에 든 것, 로그인, status, 갱신)

permalink는 커밋 `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`을 쓴다. 줄임: `storage.rs` = `codex-rs/login/src/auth/storage.rs`, `manager.rs` = `codex-rs/login/src/auth/manager.rs`, `server.rs` = `codex-rs/login/src/server.rs`.

**3.1 계정마다 `CODEX_HOME` 하나는 기능이 아니라 통하는 방법이다.** `find_codex_home()`은 `CODEX_HOME`(있는 폴더여야 함)을 읽고 없으면 `~/.codex`다([home-dir/src/lib.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/utils/home-dir/src/lib.rs)). Codex에는 계정 프로필이 없다. 이슈 [#4432](https://github.com/openai/codex/issues/4432)(`--auth-profile`, 2025-09-29)는 여전히 열려 있고 maintainer의 약속이 없으며, 그 PR #4457은 머지 없이 닫혔고, 비슷한 요청(#43190, #44891, #9648)이 열려 있다(*unverified*: GitHub API로 읽었을 뿐 maintainer의 말이 아님). 공식 문서는 자격 증명 보관만 설명한다([auth](https://learn.chatgpt.com/docs/auth)).

**3.2 홈에 든 것.** `auth.json`([storage.rs L257](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/auth/storage.rs#L257)), `config.toml`과 프로필 파일 `<이름>.config.toml`, rollout `sessions/YYYY/MM/DD/rollout-<시각>-<uuid>.jsonl`과 `archived_sessions/`([rollout/src/lib.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/rollout/src/lib.rs)), `session_index.jsonl`(스레드 이름, 마지막 것이 이김, [session_index.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/rollout/src/session_index.rs#L21-L49)), `history.jsonl`, SQLite 상태(`state_5`, `logs_2`, `goals_1`, `memories_1`, `queue_1`, `thread_history_1`, [state/src/sqlite.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/state/src/sqlite.rs)), `installation_id`, `memories/`, `skills/`와 `skills/.system`, 전역 `AGENTS.md`, `app-server-control/`(제어 소켓), `app-server-daemon/`(pid, 잠금, 설정, [app-server-daemon/src/lib.rs L269-L293](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-daemon/src/lib.rs#L269-L293)).
- **계정마다 따로, 절대 공유하지 않는다:** `auth.json`(또는 keyring 항목), `sessions/`, `archived_sessions/`, `session_index.jsonl`, `history.jsonl`, `memories/`, SQLite 파일, `installation_id`. 한 계정의 대화와 사용량이 들어 있다(소스를 읽은 결론이고 문서에는 없다).
- **공유해도 안전:** `config.toml`과 `<이름>.config.toml`(모든 곳에 주고 싶지 않은 `model_provider`는 빼고, 2.2 참고), `AGENTS.md`, `skills/`.
- `CODEX_SQLITE_HOME`은 상태 DB만 옮긴다([state/src/lib.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/state/src/lib.rs)). sessions만 옮기는 설정은 찾지 못했다.

**3.3 자격 증명 보관.** `cli_auth_credentials_store`는 `file`(기본, `CODEX_HOME/auth.json`), `keyring`, `auto`, `ephemeral`이다([config/src/types.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/config/src/types.rs)). keyring 항목은 service `Codex Auth`, secret `CODEX_AUTH`, account는 `cli|`와 정규화한 `CODEX_HOME` 경로의 SHA-256 앞 16자리 16진수다([storage.rs L163-L173](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/auth/storage.rs#L163-L173), 이 조사 중 다시 읽음). 그래서 홈 둘이 부딪히지 않는다. 화면 없는 Linux 호스트에는 보통 Secret Service가 없으니 `file` 모드가 현실적이다. `file` 모드는 `truncate(true)`와 `0600`으로 쓰고, 임시 파일과 rename이 **아니며** 잠금도 없다([storage.rs L188-L204](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/auth/storage.rs#L188-L204), 이 조사 중 다시 읽음).

**3.4 TTY 없이 웹 페이지에서 로그인.**

| 흐름 | 사실 | 설정 창에 맞는가 |
|---|---|---|
| 브라우저(`codex login`, `account/login/start` type `chatgpt`) | `127.0.0.1:1455`(대체 1457)의 콜백 서버, 경로 `/auth/callback`. `AddrInUse`면 두 번째 로그인이 1455에서 듣는 쪽에 취소 요청을 보내 첫 로그인을 멈춘다([server.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/server.rs#L880-L965), 상수와 취소는 이 조사 중 다시 읽음) | **나쁘다.** 콜백은 호스트의 `localhost`인데 SUPERVISOR의 브라우저는 Mac에 있고, 로그인 둘이 부딪힌다 |
| 기기 코드(`codex login --device-auth`, `account/login/start` type `chatgptDeviceCode`) | 확인 링크(`…/codex/device`)와 "expires in 15 minutes"인 일회용 코드를 찍고, 시간 제한은 15분이다([device_code_auth.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/device_code_auth.rs)). `app-server`로 하면 답이 구조화돼 있다: `{type, loginId, userCode, verificationUrl}`, 이어 알림 `account/login/completed {loginId, success, error}`, 취소는 `account/login/cancel {loginId}` | **좋다.** 포트가 없고, 어느 브라우저에서나 되고, stdout을 긁지 않고, 완료가 이벤트로 온다. stdout 형태는 돌려 보지 않았다(시작하면 로그인 서비스에 닿는다) |
| `--with-api-key`, `--with-access-token`(stdin) | stdin에서 키나 워크스페이스 access token을 읽는다([cli/src/login.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/cli/src/login.rs)). access token은 Business·Enterprise 워크스페이스용으로만 문서화됨([access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)) | 범위 밖: atc가 비밀을 쥐게 된다 |

**3.5 `codex login status`.** stderr에 찍고, 어느 방법으로든 로그인돼 있으면 종료 코드 0(`Logged in using ChatGPT`, `Logged in using an API key - <가린 키>`, access token 변형), 아니면 `Not logged in`과 종료 코드 1이다([cli/src/login.rs L469-L530](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/cli/src/login.rs#L469-L530), 로그아웃 출력과 종료 코드는 2.1에서도 봤다). 이메일과 플랜은 찍지 않는다. atc가 보관해도 되는 것은 `loggedIn`(종료 코드)과 짧은 `authMethod`(`chatgpt`, `apikey`, 그 밖)뿐이고, 가린 API 키 글과 나머지는 버린다. 이메일과 플랜은 app-server의 `account/read` 답(`Account::Chatgpt{email, planType}`, [v2/account.rs L32-L52](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L32-L52))에만 있다: atc는 저장하거나 보이기 전에 떼어 내야 한다(ACCOUNTS 원칙 3).

**3.6 토큰 갱신과 로그인 둘.**
- Codex는 ChatGPT access token을 만료 5분 전에 미리, HTTP 401이면 그때 갱신한다. 갱신 endpoint는 `auth.openai.com/oauth/token`이고, 답에 새 refresh token이 있으면 옛것을 바꾼다([manager.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/auth/manager.rs#L290), `persist_tokens`). CI 문서는 오래된 토큰을 "roughly every 8 days" 갱신한다고 한다([ci-cd-auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth)).
- **홈 하나에 프로세스 둘:** 갱신은 한 프로세스 안에서는 semaphore로 직렬화되지만, 프로세스 사이에는 **파일 잠금이 없고 쓰기는 원자적이지 않다**(3.3). Codex는 갱신 전에 `auth.json`을 다시 읽어 다른 프로세스가 이미 갱신했으면 건너뛴다(`reload_if_account_id_matches`, [manager.rs L2608](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/login/src/auth/manager.rs#L2608)). 경합을 줄일 뿐 잠금은 아니다.
- **홈 둘:** 공유하는 전역 잠금은 찾지 못했다. 홈마다 자기 `installation_id`, 자기 keyring 키, 자기 daemon 파일이 있다. 서로 다른 `CODEX_HOME`의 로그인 둘은 동시에 세션을 돌릴 수 있다. 나눠 쓰면 안 되는 것은 SQLite 홈(`CODEX_SQLITE_HOME`)이다.
- **`auth.json` 복사본**은 그 access token이 만료될 때까지만 된다. 그 사이 원본이 갱신되고 서버가 refresh token을 돌렸다면 복사본은 실패하고 새 로그인이 필요하다. 프로젝트들도 이를 적어 둔다(6장). atc가 인증 파일을 바꿔 끼우거나 복사하면 안 되는 이유다.

## 4. 모델 호출 없는 플랜 사용량

### 4.1 숫자가 어디서 오나

| 출처 | 문서화? | 부르는 쪽이 다루는 자격 증명 | 모델 호출 | 주는 것 |
|---|---|---|---|---|
| **(a)** rollout `token_count` 이벤트의 `rate_limits` | 모양은 소스에 있다([protocol.rs L2323-L2338](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/protocol/src/protocol.rs#L2323-L2338)). 파일 형식은 문서화된 인터페이스가 아니다 | 없음(로컬 파일) | 없음(세션 자신의 요청에 얹힘) | `primary`·`secondary` `{used_percent, window_minutes, resets_at}`, `credits`, `plan_type`, `rate_limit_reached_type`. ChatGPT 백엔드 세션에, 응답을 받은 뒤에만(2.2) |
| **(b)** `codex app-server`의 `account/rateLimits/read` | 프로토콜은 experimental이고 생성되는 스키마가 있다(`generate-json-schema`). [문서](https://learn.chatgpt.com/docs/auth)는 다루지 않는다 | 없음: Codex가 자기 `auth.json`을 읽음 | **없음**(ChatGPT 백엔드 사용량 endpoint에 HTTP GET 둘, [account_processor.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server/src/request_processors/account_processor.rs), 이 조사 중 다시 읽음) | `rateLimits`(`primary`·`secondary` `{usedPercent, windowDurationMins, resetsAt}`, `credits`, `planType`, `rateLimitReachedType`), `rateLimitsByLimitId`, `ordinaryUsageAllowed`, 초기화 크레딧. ChatGPT 로그인이 필요하고 아니면 오류(2.1). 서버가 떠 있는 동안 알림 `account/rateLimits/updated` |
| **(c)** `account/usage/read` | (b)와 같다 | 없음 | 없음 | 토큰 사용 요약, 일별 구간, 스레드별 사용. 플랜 퍼센트는 아니다 |
| **(d)** access token으로 `GET chatgpt.com/backend-api/wham/usage` | **아니오**(내부용) | **예**, access token | 없음 | (b)와 같은 숫자. 여러 프로젝트가 쓴다(6장) |
| **(e)** TUI의 `/status`, 사용량 대시보드 | 문서에 `/status`가 "displays remaining limits"이고 사용량 대시보드가 있다고 함([pricing](https://learn.chatgpt.com/docs/pricing)) | 없음 | 없음 | 사람을 위한 것이지 기계용 인터페이스가 아니다. 화면 없는 `/status`는 찾지 못했다 |

`claude -p "/usage"`에 해당하는 것은 없다. 가장 가까운 화면 없는 읽기는 (b)다. 비용은 빈 홈에서 잰 대로 시작 167 ms, RSS 약 50 MB, 네트워크 호출 전 요청당 몇 ms다. 로그인된 호출은 HTTP 요청 둘이 더해지고 재지 못했다(9장).

### 4.2 rollout에 `rate_limits`가 있는 때

스냅숏은 모델 응답 헤더(`x-codex-primary-used-percent` 같은 것과 SSE `codex.rate_limits` 이벤트, [codex-api/src/rate_limits.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/codex-api/src/rate_limits.rs#L57-L102))에서 파싱되고, 인증이 ChatGPT 관리형이고 provider가 OpenAI 자신의 것이며 `requires_openai_auth`일 때만 쓰인다([core/src/client.rs L1060-L1069](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/client.rs#L1060-L1069)). 2.2의 로컬 자료와 맞는다. 그래서 (a)는 Claude statusline과 같은 사각이 있다: 돌고 있는 세션이 없는 ACCOUNT는 기록이 없다.

## 5. Codex 세션 LAUNCH

| 모드 | 무엇 | 세션 이름 / 멈춤 / 이어 하기 | 파일이 놓이는 곳 |
|---|---|---|---|
| `codex exec`(`-C`, `-s`, `--json`, `-o`, `--ephemeral`, `-p`) | 턴이 끝나면 끝나는 비대화 실행 한 번([exec/src/cli.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/exec/src/cli.rs#L15-L80)) | 식별은 스레드 id. `codex exec resume <UUID 또는 스레드 이름>`. **멈춤 명령은 없다**(프로세스를 끈다) | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<시각>-<uuid>.jsonl`, 이름은 `session_index.jsonl` |
| `codex app-server`(`--listen stdio://`, `unix://`, `ws://`) | JSON-RPC 서버: `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/steer`, `turn/interrupt`, `thread/name/set`, `thread/archive`, `account/*`, 알림 `thread/*`·`turn/*`(이 조사에서 스키마를 생성해 봄) | 스레드는 서버 프로세스 안에 있다(rollout으로도 남음). 턴은 `turn/interrupt`로 중단. 서버를 끝내면 멈춘다 | 같은 rollout |
| `codex app-server daemon` | 관리되는 로컬 app-server, **`CODEX_HOME`마다**(`app-server-daemon/`에 pid, 잠금, 설정). `bootstrap\|start\|restart\|stop\|version`. `codex agents`가 그 세션을 훑고 `codex queue --thread <id 또는 이름> --message`가 돌고 있는 서버에 메시지를 더한다 | 위와 같다 | 위와 같다 |
| 터미널 멀티플렉서의 대화형 `codex` | 사람이 돌리는 것 | 밖에서는 없음 | 같은 rollout |

Claude의 `claude --bg`처럼 `state.json`, `needs`, `suggestedReply`가 있는 job 표에 해당하는 것은 없다.

- **세션 → ACCOUNT.** rollout이 있는 폴더가 어느 홈인지 말해 준다(Claude와 같은 규칙). `session_meta`에는 폴더 칸이 없다. `readCodex`는 등록된 모든 Codex 홈을 훑어야 한다. 지금은 폴더 하나에 오늘과 어제 날짜만 읽는다.
- **Hook.** Codex 0.154에는 `config.toml`에 선언하는 수명주기 hook(`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Interrupt`. "prompt and agent hook handlers are parsed but skipped")와, 턴이 끝날 때마다 부르는 옛 `notify` 프로그램이 있다([config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [hooks/src](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/hooks/src/events)). 그래서 claim·health hook에 대응물이 있다. **statusline은 없다**: FUEL의 세션별 기록(fuel.md 6장)에는 Codex 출처가 없고, 사용량은 4.1의 (a)나 (b)에서 온다.
- **Codex의 AIRCRAFT가 Claude보다 잃는 것.** 팀이 정의하는 CREW 서브에이전트(Codex에는 spawn 관계와 `SubagentStart` hook이 있지만 사용자가 서브에이전트를 정의하는 길은 이 태그에서 찾지 못했다), `CLAUDE.md`(Codex는 `AGENTS.md`를 읽는다. 전역, 그다음 프로젝트 루트에서 cwd까지, 32 KiB 한도, [agents_md.rs](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/agents_md.rs)), skill(전역 `skills/` 폴더. 프로젝트 안 경로는 확인하지 못함), `/clear`와 CREW BRIEFING 흐름, NEEDS YOU 뒤의 job state 파일, Remote Control(Codex에는 app-server daemon용 `remote-control`이 따로 있고 다른 것이다).

## 6. 다른 프로젝트

별과 날짜는 2026-09-30의 GitHub API 값이다. "코드" 링크는 적어 둔 커밋의 permalink다.

| 프로젝트 | 로그인 | 사용량 출처 | 여러 계정 방식 | 토큰 다루기 |
|---|---|---|---|---|
| [Loongphy/codex-auth](https://github.com/Loongphy/codex-auth)(2,767 ★, MIT, Zig, 2026-09-15 push, `1c1c623`) | `codex login`/`--device-auth`를 돌려 `auth.json`을 들인다 | 기본: access token으로 `GET chatgpt.com/backend-api/wham/usage`([usage.zig](https://github.com/Loongphy/codex-auth/blob/1c1c623/src/api/usage.zig)). `--skip-api`는 rollout을 읽음 | 홈 하나를 바꿔 끼운다: 계정별 스냅숏을 `~/.codex/auth.json` 위에 복사([account_ops.zig](https://github.com/Loongphy/codex-auth/blob/1c1c623/src/registry/account_ops.zig)) | `auth.json`과 id 토큰 claim을 읽는다. 복사본 0600. 갱신은 안 한다. README 경고: 이것이 "may be detected by OpenAI and could violate their terms of service, potentially leading to account suspension" |
| [omarhoumz/codex-accounts](https://github.com/omarhoumz/codex-accounts)(0 ★, MIT, shell, 보관됨, `9f636ab`) | 계정마다 `CODEX_HOME`을 두고 `codex login` | 없음 | `codex-run <이름>`은 계정별 `CODEX_HOME`(동시에 가능), `use`는 `~/.codex/auth.json`을 그 계정 파일로 symlink해 갱신이 거기에 쓰이게 함 | `auth.json`에서 토큰을 읽는다. README: 공유 홈의 로그인은 이전 것을 "invalidates the previous one server-side" |
| [marivaldojr/codex-accounts](https://github.com/marivaldojr/codex-accounts)(1 ★, MIT, TypeScript, VS Code, `d64ae73`) | `codex app-server` JSON-RPC로 | app-server의 `account/rateLimits/read`([app-server.ts](https://github.com/marivaldojr/codex-accounts/blob/d64ae73/src/app-server.ts)). README: "there is no public HTTP endpoint that does the same" | 프로필은 `auth.json` 복사본. 켜져 있지 않은 계정은 그 `auth.json`만 든 임시 `CODEX_HOME`에서 조회 | 토큰은 VS Code SecretStorage에. app-server가 갱신할 수 있고 새 토큰은 되써진다. README에 rotation이 적혀 있다 |
| [ndycode/oc-codex-multi-auth](https://github.com/ndycode/oc-codex-multi-auth)(193 ★, MIT, TypeScript, OpenCode 플러그인, `924127c`) | 자체 OAuth PKCE, 루프백 1455, 기기 코드, 수동 | bearer 토큰으로 `GET …/backend-api/wham/usage`([codex-usage.ts](https://github.com/ndycode/oc-codex-multi-auth/blob/924127c/lib/codex-usage.ts)) | 토큰 풀, 요청마다 상태·할당량을 보는 rotation | 자체 JSON 파일(옵션으로 OS keychain). 단일 사용 토큰을 조율해 스스로 갱신. 0600은 README에만 있음(*unverified*) |
| [egigoka/opencode-openai-multi-auth](https://github.com/egigoka/opencode-openai-multi-auth)(0 ★, fork, TypeScript, `37b9b16`) | OAuth PKCE, 루프백 1455 | README는 계정마다 백엔드를 조회한다고 함. `wham/usage` 코드는 찾지 못함(*unverified*) | sticky / round-robin / hybrid 풀, 429에서 rotation | `~/.config/opencode/openai-accounts.json`과 OpenCode의 `auth.json`, 0600으로 씀 |
| [ndycode/codex-multi-auth](https://github.com/ndycode/codex-multi-auth)(525 ★, MIT, TypeScript, `328343b`) | OAuth PKCE 루프백 1455, `--device-auth`, 수동 | `codex app-server`의 `account/rateLimits/read`([native-rate-limits.ts](https://github.com/ndycode/codex-multi-auth/blob/328343b/lib/runtime/native-rate-limits.ts)) | 풀에 더해 모델 트래픽을 가장 나은 계정으로 보내는 루프백 rotation **프록시**. 비대화 명령은 그림자 `CODEX_HOME` | 풀 파일 0600이 켜진 계정을 `~/.codex/auth.json`에도 맞춰 쓴다. 단일 사용 토큰을 묶어 스스로 갱신 |
| [Davidcreador/opencode-openai-sub-switcher](https://github.com/Davidcreador/opencode-openai-sub-switcher)(11 ★, MIT, `5ada3fa`) | OpenCode 자체 | 없음 | OpenCode `auth.json` 항목의 스냅숏을 되써서 전환 | README: 원본 토큰을 암호화 없이 저장, 파일 모드 0600 |
| opencode 본체([anomalyco/opencode](https://github.com/anomalyco/opencode), 211k ★, MIT, `2fa3363`) | provider별 OAuth | 없음 | **없음**: `auth.json`은 provider를 키로 하는 맵이고 provider마다 항목 하나([auth/index.ts](https://github.com/anomalyco/opencode/blob/2fa3363/packages/opencode/src/auth/index.ts)) | 0600으로 씀. 갱신은 OpenCode 몫 |
| [steipete/CodexBar](https://github.com/steipete/CodexBar)(22,072 ★, MIT, Swift, 메뉴 막대, `5de8b9c`) | 있는 세션을 재사용. 관리되는 홈은 `codex login` 흐름 | **둘 다**: access token으로 `GET …/wham/usage`, 그리고 `codex -s read-only -a never app-server`로 `initialize`, `account/read`, `account/rateLimits/read`([docs/codex.md](https://github.com/steipete/CodexBar/blob/5de8b9c/docs/codex.md), 이 조사 중 다시 읽음). 앱 기본 순서: OAuth API, 그다음 CLI RPC | 프로필 홈: `providers[].codexProfileHomePaths`, 조회마다 `CODEX_HOME`으로 범위를 한정 | `auth.json`을 읽는다. "never publishes refreshed native tokens into `auth.json`"이고 갱신은 Codex CLI에 맡긴다 |
| [ccusage](https://github.com/ccusage/ccusage)(18,812 ★, Rust, `9bff6b8`) | 없음 | 토큰·비용용 rollout `token_count`뿐. `rate_limits` 코드는 **없다**(Codex 어댑터에서 0건) | `CODEX_HOME`을 쉼표로 이은 목록으로 줄 수 있음(보고용) | `auth.json`을 읽지 않는다 |

패턴:
- 플랜 사용량을 읽는 방법은 셋이다: access token을 쓰는 비공식 HTTP endpoint(codex-auth, oc-codex-multi-auth, CodexBar의 첫 경로), 공식 app-server RPC(marivaldojr, codex-multi-auth, CodexBar의 둘째 경로), rollout 이벤트(codex-auth `--skip-api`, atc의 Claude transcript FUEL). 뒤의 둘만 부르는 쪽이 토큰을 쥐지 않는다.
- 여러 계정의 모양도 셋이다: 계정마다 `CODEX_HOME`(omarhoumz, CodexBar, marivaldojr의 임시 홈), 홈 하나에 `auth.json`을 바꿔 끼우거나 symlink(codex-auth, omarhoumz `use`), 프로세스 안 토큰 풀과 rotation(OpenCode 플러그인들, 프록시가 붙은 codex-multi-auth).
- 토큰을 복사하거나 풀에 모으는 도구는 모두 단일 사용 refresh token rotation을 다뤄야 한다. README에 가장 많이 나오는 실패다.
- `auth.json`을 읽는 것은 공통이고, 자격 증명을 피하는 것은 ccusage뿐이다.
- OpenAI는 프로필을 내놓지 않았다(3.1). 이슈 [#41664](https://github.com/openai/codex/issues/41664)("multi-account 프록시가 지원되는지 밝혀 달라")는 열려 있고 답이 없다(API 읽기 이상은 *unverified*).

## 7. OpenAI 약관이 말하는 것(문구만. atc가 판단하지 않는다)

직접 가져온 글(`learn.chatgpt.com/docs`, 날짜 없는 쪽): "Treat `~/.codex/auth.json` like a password: it contains access tokens. Don't commit it, paste it into tickets, or share it in chat."([auth](https://learn.chatgpt.com/docs/auth)). 같은 쪽이 화면 없는 기계로 `scp`로, 컨테이너로 `docker cp`로 옮기는 예를 보인다. "The right way to authenticate automation is with an API key." 그리고 CI runner의 ChatGPT 관리형 `auth.json`에 대해 "Do not use this workflow for public or open-source repositories", "trusted private infrastructure"에 해당([ci-cd-auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth)). Codex access token은 "are currently supported for ChatGPT Business and Enterprise workspaces"이고 "intended for trusted scripts, schedulers, and private CI runners"([access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)). 플랜에는 Codex가 5시간 창과 주간 한도로 들어 있고, "check your usage dashboard for current limits and reset times", `/status`는 "displays remaining limits"([pricing](https://learn.chatgpt.com/docs/pricing)).

정책 쪽(`openai.com`과 `help.openai.com`은 직접 가져오기에 403이라 이 문구는 검색 요약을 거쳤다: *정확한 원문으로는 unverified*): 소비자 약관은 "You may not share your account credentials or make your account available to anyone else"(https://openai.com/policies/row-terms-of-use/), 계정 공유 안내는 계정이 "is meant for you—the individual who created it", 약관과 사용 정책은 "circumvent[ing] any rate limits or restrictions or bypass[ing] any protective measures"를 금지, 사업자용 Services Agreement는 다르다("will not share account access credentials or individual login credentials between multiple users", 접근권의 재판매·임대 금지).

뉴스(*unverified*, OpenAI 쪽이 아님): 이름이 알려진 출시 파트너와 앱별 주간 상한이 있는, 제3자 개발 도구용 "Sign in with ChatGPT" 프로그램.

**문구가 말하지 않는 것.** 받아 본 글 어디에도 ChatGPT 계정이나 유료 플랜을 둘 이상 갖는 것 자체가 금지라고 적혀 있지 않다. 우려는 자격 증명 공유와 "circumvent rate limits" 조항으로만 닿고, 이 조항들은 여러 계정을 이름으로 말하지 않는다. 한 ChatGPT 로그인을 여러 기계나 도구에서 동시에 써도 되는지, 사람 자신의 스크립트가 ChatGPT 로그인으로 돌아도(`codex exec`, app-server) 되는지는 자동화에는 API 키를 쓰라는 권고와 private runner 문구 말고는 적혀 있지 않다. 한도를 피하려고 계정을 돌려 쓰는 것이 되는지도, 복사한 `auth.json`을 쓰는 제3자 도구도 말하지 않는다. atc의 사용(같은 사람의 로그인 여럿을 그 사람의 자동화에 쓰는 것)이 약관 안인지는 Claude 계정처럼 SUPERVISOR가 정할 일이다([accounts.md](../accounts.md) 4장 5단계).

## 8. atc와의 비교와 권고

### 8.1 Codex에 대한 ACCOUNTS 원칙([accounts.md](../accounts.md) 2장)

| # | 원칙 | Codex에서는 |
|---|---|---|
| 1 | ACCOUNT마다 설정 폴더 하나, 폴더마다 daemon 하나 | **바뀐다.** ACCOUNT마다 `CODEX_HOME` 하나는 그대로다. "폴더마다 daemon"은 아니다: Codex 세션은 daemon이 필요 없다(`codex exec`는 평범한 프로세스). 선택으로 홈마다 app-server가 있다. "ACCOUNT마다 홈 하나, 프로세스는 그 홈으로 띄운다"로 고친다 |
| 2 | 등록부에는 라벨과 폴더뿐 | 그대로. 비밀이 아닌 `provider`를 더한다 |
| 3 | 자격 증명을 읽거나 복사하거나 출력하지 않는다. 상태는 `loggedIn`과 `authMethod`만 | 그대로, Codex 특유의 것을 더해서: atc는 `auth.json`이나 keyring 항목을 열지 않는다(여는 것은 Codex 프로세스다). `codex login status`는 종료 코드와 방법만 준다. `account/read`에는 이메일과 플랜이 있다: 파서에서 버린다. 기기 `userCode`와 `verificationUrl`은 페이지에 한 번 보이고 저장·기록하지 않는다(Claude 로그인 URL처럼) |
| 4 | 추측이 아니라 관찰 | 그대로: ACCOUNT는 rollout이 발견된 홈이다 |
| 5 | 계정 설정은 SUPERVISOR | 그대로 |
| 6 | 진행 중인 FLIGHT는 옮기지 않는다 | 그대로. **새 규칙:** ACCOUNT CHANGE는 같은 provider 안에서만. Codex ACCOUNT는 Claude AIRCRAFT의 옮길 곳이 아니다 |
| 7 | 세션마다 토큰을 주지 않고 인증 파일을 바꿔 끼우지 않는다 | 그대로이고 더 중요하다: `auth.json` 바꿔 끼우기는 커뮤니티 도구 대부분이 하는 일이고, 소스는 왜 위험한지 보여 준다(원자적이지 않은 쓰기, 잠금 없음, 도는 refresh token) |
| 8 | 둘에 한정하지 않는다 | 그대로 |

이 조사가 제안하는 새 규칙: (R9) 라벨은 provider를 가로질러 유일하다(FUEL과 FLEET PLAN이 라벨로 묶는다). (R10) atc는 Codex 자신의 표면(app-server, rollout, `login status`)만 쓰고 토큰으로 비공식 백엔드 endpoint를 부르지 않는다. (R11) 홈마다 로그인 프로세스는 한 번에 하나, 그리고 기기 코드 흐름만. (R12) Codex ACCOUNT 사이에 memory도 SQLite 홈도 공유하지 않는다(SHARE MEMORY는 해당 없음). (R13) 새 Codex 홈에는 `model_provider` 재정의를 주지 않는다(2.2).

### 8.2 권고

**등록부 모양: 등록부 하나, 항목마다 `provider`.** `fleet.json`의 `accounts` 항목을 `{provider?: "claude" | "codex", configDir}`로 한다. `provider`가 없으면 `claude`라서 옛 파일은 그대로 읽힌다. `codex`에서는 `configDir`이 `CODEX_HOME`이고, `checkConfigDir`는 그 provider에 대해 `.codex`로 시작하는 폴더 이름을 받는다. SUPERVISOR가 ACCOUNTS 목록 하나를 원했고, FUEL과 FLEET PLAN은 이미 라벨로 묶고, 등록부를 둘로 나누면 라벨 검사, 설정 블록, `maxLaunched`가 겹친다. 위험: `accountFolders()`를 도는 모든 reader는 Claude를 가정한다(세션, `jobs/`, `projects/`, `claude agents`, `claude auth status`). 첫 단계에서 Codex 항목이 생기기 전에 그 루프를 provider를 아는 것으로 바꾸고, Codex 항목이 Claude reader에 아무 변화도 주지 않는다는 시험을 둔다. 대안인 별도 `codexAccounts`는 Claude 경로를 그대로 두지만 목록 둘, 라벨 공간 둘, 맞춰야 할 자리 둘이 생긴다. 권하지 않는다.

**Codex 폴더의 ADD ACCOUNT / LOGIN / status.**
- ADD ACCOUNT: 라벨, provider `codex`, 폴더 `~/.codex-<라벨>`(모드 0700). 다른 것은 쓰지 않는다: `auth.json`도, 복사한 `config.toml`도 없다(R13). "`AGENTS.md`와 `skills/` 복사"는 안전하지만 나중 일이다. Claude처럼 등록은 마지막에.
- 설정 창에서 LOGIN: atc가 `CODEX_HOME=<폴더>`와 `cleanEnv`로 `codex app-server`를 띄우고, `initialize`와 `account/login/start {type: "chatgptDeviceCode"}`를 보내고, 돌아온 `verificationUrl`과 `userCode`를 보이고, `account/login/completed`(또는 `account/login/cancel`)를 기다린다. 알림이 오거나 15분(코드 수명)이 지나면 서버를 끝낸다. Claude 흐름의 URL 긁기와 코드 붙여넣기를 구조화된 칸으로 바꾸고, 브라우저 흐름의 1455 포트도 피한다. stdout 형태인 `codex login --device-auth`는 대안이다. 위험: 프로토콜은 experimental이고 0.154는 이미 한 발 늦다(0.159가 나옴). 쓰는 칸을 `generate-json-schema` 출력에 맞춰 시험으로 고정하고 모르는 칸은 무시한다.
- Status: 폴더마다 `codex login status`(종료 코드, 그다음 첫 줄에서 방법. 아는 글이 아니면 `unknown`), `claude auth status`처럼 캐시한다. `loggedIn`과 `authMethod`만 보관한다.
- `.claude.json` 같은 onboarding 단계는 찾지 못했다. 새 홈의 첫 세션이 무엇을 묻는지(신뢰, 모델)는 재지 못했다(9장).

**FUEL과 플랜 사용량.** 사용량은 짧게 사는 `codex app-server`(`CODEX_HOME=<폴더>`)의 `account/rateLimits/read`로 읽는다. 느린 주기(예: 5분, 그리고 설정 창에서 필요할 때)로, 한 번에 한 계정씩. `primary`·`secondary` 창은 `windowDurationMins`로 FUEL의 창에 맞추고(본 것: 300과 10,080분, 그리고 단독 10,080 또는 43,200분), `usedPercent`, `windowDurationMins`, `resetsAt`, `rateLimitReachedType`, `ordinaryUsageAllowed`만 보관한다. `planType`, `accountId`, 크레딧 잔액은 버린다. 도는 세션과 토큰 비용에는 rollout `token_count`를 수동 출처로 쓴다(Claude transcript에 FUEL이 하듯이). null `rate_limits`는 "모름"이지 0 %가 아니다. 기록 없는 ACCOUNT는 모름으로 둔다([claude-usage-accounts.ko.md](claude-usage-accounts.ko.md)와 같은 규칙). 비공식 `wham/usage` endpoint를 부르거나 토큰을 읽지 않는다(R10): 공식 읽기가 있고 atc 손에 토큰이 필요 없다. 위험: app-server 프로토콜이 experimental이다. 읽는 동안 Codex가 토큰을 갱신할 수 있고, 같은 홈의 세션이 같은 순간에 갱신하면 잠금도 없고 쓰기도 원자적이지 않다(3.3, 3.6). 그래서 주기를 성기게 하고, 홈마다 poller를 둘 두지 않고, 나중에 `login status`가 실패하면 NOT LOGGED IN과 LOGIN 버튼을 보인다. 또 프록시를 거치도록 `config.toml`을 쓴 홈도 이 읽기에는 답한다(provider와 무관). 다만 그 rollout의 한도는 null이다.

**Codex 세션 LAUNCH의 첫 범위: 가장 작은 것만.**
- 먼저: **FLIGHT마다 `codex exec --json` 한 번 돌리는 CODEX FLIGHT.** atc가 systemd scope(`launchCommandOf`처럼)에서 `CODEX_HOME=<폴더>`, `-C <STAND>`, `-s workspace-write`, 프롬프트는 CREW BRIEFING, JSON 이벤트 스트림은 파일로. 멈춤 = scope를 끝냄. 한도나 재시작 뒤 이어 하기 = `codex exec resume <스레드 id>`. ACCOUNT는 rollout이 있는 홈이라 관찰 규칙이 그대로다. experimental 프로토콜도, 세션마다 떠 있는 프로세스도 필요 없다.
- 함께 필요한 것: 등록된 모든 Codex 홈을 읽는 reader(`readCodex`는 지금 폴더 하나, 이틀치), 그 홈의 `config.toml`에 Codex hook으로 두는 `claim`·`health` 대응물(`Stop`, `SessionStart`, `PostToolUse` 이벤트가 있다. `StopFailure` 같은 LIMIT 감지는 확인하지 못했다), 규칙이 `CLAUDE.md`에 있는 곳에 AGENTS.md 포인터.
- 당분간 뺄 것: 턴 중간 조종과 메시지 큐(`codex queue`, `turn/steer`는 세션마다 app-server가 필요), Codex의 NEEDS YOU(job state 파일이 없다), Codex로 또는 Codex에서 ACCOUNT CHANGE, CREW 서브에이전트, SHARE MEMORY, `app-server daemon`. 조종이 필요해지면 app-server 스레드를 나중에 더한다.
- 위험: 턴이 끝나면 끝나는 실행은 다음 메시지를 기다리는 AIRCRAFT가 아니다. 그래서 Codex AIRCRAFT는 처음에는 떠 있는 CAPTAIN이 아니라 FLIGHT 모양의 일꾼이다. FLEET와 DISPATCH는 떠 있는 세션을 가정한다(끝난 백그라운드 세션을 idle로 보고 다시 LAUNCH한다). 그러니 첫 이슈가 LAUNCH를 만들기 전에 Codex AIRCRAFT에게 "idle"이 무엇인지 정해야 한다.

**권하는 순서**(이슈 하나씩. 등급은 평소 규칙대로이고 등록부와 LAUNCH 환경은 `user`): (C1) 등록부의 `provider`와 provider를 아는 reader 루프, Codex 코드 경로는 아직 없이. (C2) Codex 홈 reader(세션, 폴더로 ACCOUNT)와 `login status` 상태. (C3) Codex용 ADD ACCOUNT. (C4) app-server 기기 코드로 LOGIN. (C5) FUEL: 사용량 읽기와 Codex `token_count`. (C6) `codex exec` FLIGHT의 LAUNCH. (C7) hook. 그 뒤 app-server 스레드.

## 9. 확인하지 못한 것

- **로그인된 측정.** 로그인된 홈에서 `account/rateLimits/read`의 지연·RSS·payload, 그것이 토큰을 갱신하는지(그래서 `auth.json`을 쓰는지), `refreshToken: false`인 `account/read`가 그러는지. SUPERVISOR가 로그인하는 ACCOUNT가 필요하고 구현 이슈에서 잰다.
- **기기 코드 흐름 전체**: 이 환경에서 `codex login --device-auth`의 stdout이 무엇을 찍는지, 그리고 TTY 없는 stdio app-server에서 `account/login/start`가 되는지(스키마는 된다고 하지만 돌려 보지 않았다. 기기 흐름을 시작하면 로그인 서비스에 닿는다).
- **한 홈에서 프로세스 둘이 갱신하는 경합**: 소스로 읽었을 뿐 재현하지 않았다.
- **새 홈의 첫 `codex exec`**: 신뢰나 onboarding을 묻는지, 2.1 말고 무엇을 쓰는지. 또 Codex hook이 Claude `StopFailure` hook처럼 사용량 LIMIT을 알아챌 수 있는지.
- **약관**: 정책 쪽 문구는 검색 요약을 거쳤다(7장).
- **다른 프로젝트의 unverified**: oc-codex-multi-auth의 파일 모드, egigoka fork의 사용량 코드, 이슈에서 온 모든 것. `gh api` 읽기로 별·push·라이선스를 얻었고, 코드 링크는 적은 커밋에서 따라갔다.
- **화면 없는 `/status`**: 비대화 형태를 찾지 못했다. 시도하지 않았다.
- opencodex 프록시: 설정의 키 이름만 읽었다. 두 번째 로그인이 프록시를 거쳐야 하는지는 SUPERVISOR의 선택이다.

## 10. SUPERVISOR가 정할 것

1. **등록부**: `provider`가 있는 하나(권장) 또는 별도의 `codexAccounts`.
2. **사용량 출처**: 공식 app-server 읽기와 rollout(권장), 비공식 endpoint는 뺀다. 또는 돌고 있는 세션이 없는 ACCOUNT에는 그 endpoint도 허용(atc가 토큰을 쥐어야 해서 원칙 3에 어긋난다).
3. **약관**: 이런 방식으로 ChatGPT 로그인 여럿을 쓰는 것이 괜찮은지. atc는 문구를 적을 뿐 판단하지 않는다.
4. **첫 LAUNCH 범위**: `codex exec` FLIGHT(권장) 또는 처음부터 세션마다 떠 있는 app-server.
5. **프록시**: 새 Codex ACCOUNT 폴더에는 `model_provider` 재정의를 주지 않는다(권장). 그래야 사용량이 읽힌다. 어느 계정이 프록시를 써야 하면 알려 달라.
