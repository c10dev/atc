# 조사: Claude 플랜 사용량 읽기와 여러 Claude 계정 운용

[English](claude-usage-accounts.md) · **한국어**

> 상태: [ATC-188](https://linear.app/vocado/issue/ATC-188/survey-how-other-projects-read-claude-plan-usage-and-run-several) SURVEY, 2026-09-30. 문서만 다뤘다. 코드·설정·`~/.claude*` 폴더를 바꾸지 않았고, 로그인·로그아웃도, 자격 증명 파일 읽기도, 모델 호출도 하지 않았다. 다른 프로젝트에 관한 내용은 모두 2026-09-30에 가져온 공개 README·문서·소스에서 왔다. 별 수는 대략치(저장소 화면에서 읽음)이고 마지막 활동일은 모두 확인하지는 못했다. 권고는 SUPERVISOR의 결정이 필요하다.

## 1. 질문

atc는 Claude 구독 ACCOUNT를 여러 개 돌린다([accounts.md](../accounts.md)). FUEL은 ACCOUNT의 플랜 사용량을 돌고 있는 세션의 statusline `rate_limits`로만 안다([fuel.md](../fuel.md) 6절). 돌고 있는 세션이 없는 ACCOUNT는 "no record"로 읽히고 FLEET PLAN은 0 %로 센다. 2026-09-30에 한 ACCOUNT가 주간 한도 100 %였는데도 ENTRY와 ACCOUNT CHANGE에서는 가장 비어 있는 것처럼 보였다.

이슈의 세 질문: 다른 프로젝트는 모델 호출 없이 플랜 사용량을 어떻게 읽는가, 여러 계정을 어떻게 돌리는가, 문서화된 안정된 방법이 있는가.

## 2. 방법

- 공개 자료만 봤다: 프로젝트 README·소스, Claude Code 문서(`code.claude.com/docs`), Claude Code changelog, Anthropic 공개 약관 쪽, 이슈 글.
- 아래 메커니즘은 모두 가져온 글에서 읽었다. 코드나 문서가 아니라 이슈 글이나 검색 요약에서 나온 사실은 *unverified*로 표시했다.
- 로컬 측정은 이슈 본문의 것 하나뿐이다(Claude Code 2.1.285): `CLAUDE_CONFIG_DIR=<폴더> claude -p "/usage" --no-session-persistence --output-format json`은 `Current session: N% used · resets …`와 `Current week (all models): N% used · resets …`를 찍고, `num_turns` 0, `total_cost_usd` 0, 약 3.9초, 최대 RSS 275 MB다. 이 세션은 다시 돌리지 않았다.

## 3. 플랜 사용량을 읽는 길

| 출처 | 문서화? | 자격 증명 | 모델 호출 | 주는 것 |
|---|---|---|---|---|
| **(a)** statusline stdin JSON `rate_limits` | **예**, [statusline](https://code.claude.com/docs/en/statusline) | 없음(세션이 명령에 넘겨 줌) | 없음(세션 자기 요청에 실려 옴) | `five_hour`·`seven_day`의 `{used_percentage, resets_at}`(epoch 초), 게이트웨이 로그인이면 `spend_limit`. Pro·Max에만, 세션의 첫 API 응답 뒤에만 있고 창마다 없을 수 있다 |
| **(b)** `/usage` 글(`claude -p "/usage"`) | 명령은 문서화([commands](https://code.claude.com/docs/en/commands), [costs](https://code.claude.com/docs/en/costs)), **글은 스키마가 아니다** | 부르는 쪽은 읽지 않음 | 없음(측정: 0 턴, 0 USD) | 세션·주간 퍼센트와 reset 글. 모델별 주간 창도 `/usage`에 나온다 |
| **(c)** OAuth 토큰으로 `GET /api/oauth/usage` | **아니오**(내부용. 문서는 "the usage endpoint"라고만 쓴다) | **필요**, access token | 없음 | `five_hour`, `seven_day`, 모델별 주간, `extra_usage`: `utilization` 0–100과 ISO `resets_at`((a)와 이름이 다르다) |
| **(d)** transcript 합산(ccusage 방식) | 해당 없음(자기 파일) | 없음 | 없음 | 토큰·비용 추정. 서버의 플랜 퍼센트가 **아니다** |
| **(e)** `anthropic-ratelimit-unified-*` 응답 헤더 | **아니오**(공개 rate-limit 문서에는 API 헤더만 있다) | **필요** | **있음**: 실제 요청(출력 약 1 토큰) | 5h·7d utilization, reset, status |
| **(f)** 브라우저 쿠키로 claude.ai 웹 API | 아니오 | 웹 `sessionKey` 쿠키 | 없음 | 웹 계정 수치. Claude Code CLI 로그인이 아니다 |
| **(g)** 공개 사용량 API | Admin Usage & Cost API는 **개인 계정 불가**("The Admin API is unavailable for individual accounts"), Enterprise는 별도 Analytics API | Admin·Analytics 키 | 없음 | 조직 자료. Pro·Max용은 없다 |

headless 출력에는 없다: `--output-format json`과 Agent SDK 결과에는 비용·토큰 필드(`total_cost_usd`, `usage`, `modelUsage`)만 있고 플랜 한도는 없다.

각각에 대해:

- **(a)**는 스키마로 문서화된 유일한 출처다. `/usage`의 60분 "last-known usage" 대체(문서: costs)는 프로세스 안의 일이다. 이슈에서는 설정 폴더에 캐시 파일이 없었다.
- **(c)**는 어떤 공식 페이지에도 없다. Anthropic이 아니라 프로젝트들이 보고한 것: `user:profile` 범위가 필요해서 `setup-token`(추론 범위만)은 403이 난다(CodexBar 이슈 #1894, *unverified*). 429가 심해서 여러 도구가 `User-Agent: claude-code/<version>`을 보내고 3–5분 캐시와 backoff를 쓴다(Claude Code 이슈 #31021, 원인은 *unverified*). Claude Code changelog(2.1.281–2.1.284)에도 "Fixed repeated calls to the plan-usage endpoint after it rate-limits or rejects your login"가 있다.
- **(e)**는 작은 프로젝트 둘과 알려진 메뉴 막대 앱 하나가 쓴다. 어떤 토큰으로든 되지만 그 ACCOUNT에 대한 실제 모델 요청이다.
- statusline `rate_limits`는 Claude Code 2.1.80에서 처음 나왔다고 보고된다(*unverified*). atc는 2.1.283에서 있음을 확인했다([fuel.md](../fuel.md) 6.1).

## 4. 사용량을 읽는 프로젝트

별은 대략치. 메커니즘 칸의 글자는 위 표의 것이다.

| 프로젝트 | 메커니즘 | 주기 | 토큰 |
|---|---|---|---|
| [ccusage](https://github.com/ccusage/ccusage) (~19k, MIT) | (d) | 필요할 때 | 없음. 플랜 퍼센트는 읽지 않는다 |
| [ccstatusline](https://github.com/sirmalloc/ccstatusline) (~13k, MIT) | (a) 먼저, (c) 대체 | statusline 10초, API 캐시 180초 | (c)를 위해 토큰을 읽는다 |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) (~8.7k, MIT) | (a) `--statusline`, (c) 선택 `--api`, (d) | TUI | 선택 |
| [Claude-Usage-Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker) (~3.6k, MIT, macOS) | (e) 헤더(와 (c)) | 타이머 | 토큰을 읽는다 |
| [claude-dashboard](https://github.com/uppinote20/claude-dashboard) (~580, MIT) | (c) | 캐시 300초, `retry-after` 존중 | 토큰을 읽는다 |
| [claude-pulse](https://github.com/NoobyGains/claude-pulse) (~460, MIT) | (a)만("no OAuth") | statusline 다시 그릴 때 | 없음 |
| [weekstat](https://github.com/butschster/weekstat) (~2, MIT) | (a)만, 일부러 | 데몬 5초 | 없음 |
| [claude-code-usage-guard](https://github.com/eltonylfgi-blip/claude-code-usage-guard) (~3, MIT) | (a), 없으면 (d) 대용 | statusline 30초 | 없음 |
| [itsPG/claude-code-statusline](https://github.com/itsPG/claude-code-statusline) (~3, MIT) | (a), (c) 대체 | 120초 | (c)를 위해 토큰을 읽는다 |
| [cc-usage-cli](https://github.com/abruption/cc-usage-cli) (~0, MIT) | (e): `max_tokens: 1`짜리 Haiku 요청 | 60초 | 토큰을 읽는다 |
| [claude-limits](https://github.com/figueiredouc/claude-limits) (~1, MIT) | (c) | 180초, 429 backoff 5–30분 | 메모리에만 |
| [claude-usage-limits](https://github.com/eduardo-veras/claude-usage-limits) (~0, MIT) | **(b)** `claude -p "/usage" --output-format json`, 글을 파싱 | 필요할 때 | 없음. README가 스스로 "depends on the wording of /usage"라고 쓴다 |
| [ClaudeMeter](https://github.com/eddmann/ClaudeMeter), [usage4claude](https://github.com/f-is-h/usage4claude), [AgentLimits](https://github.com/Nihondo/AgentLimits) | (f) | 약 60초 | 웹 쿠키, OS keychain에 둔다 |

서른 개 남짓 프로젝트의 공통점:

- 최근 도구는 **(a)를 먼저** 쓰고(네트워크도 자격 증명도 없음), statusline에 없는 것(모델별 주간 창, extra usage)에만 (c)를 쓴다.
- `/usage` 글을 파싱하는 것(b)은 하나뿐이다. `/status`를 파싱하는 것은 없다.
- **형식 변경 대처:** 이중 출처 대체(stdin → 엔드포인트 → transcript), 관대한 파싱(`jq`의 `// empty`, 없으면 0이나 "unknown"), TTL 캐시, 실패 캐시와 `retry-after` backoff. (c) 도구들은 엔드포인트가 "can change or disappear without notice"라고 스스로 적는다.
- **토큰 보관:** 대부분 폴링마다 자격 증명을 읽고 사용량 숫자만 캐시한다. 예외는 토큰을 돌려 쓰고 다시 쓰는 claude-swap이다.
- **macOS 메뉴 막대 앱**은 대부분 CLI의 keychain 항목(`Claude Code-credentials`)으로 (c)를 쓴다. ACL 창을 피하려고 `/usr/bin/security`로 읽는다. 토큰 갱신에서는 갈린다: 셋은 토큰을 스스로 갱신해 다시 쓰고, 셋은 일부러 갱신하지 않는다. 그중 둘은 Claude Code도 쥔 refresh token을 돌리면 OAuth 서버의 재사용 감지에 걸려 Claude Code가 로그아웃될 수 있다고 적는다. atc가 토큰을 쥐거나 돌리지 않아야 하는 이유가 하나 더 는다.
- [AgentUsageMonitor](https://github.com/chocolatechipscookiecrumbles/AgentUsageMonitor) (~3, MIT, macOS)가 아래 권고에 가장 가까운 선례다: (a) 먼저, (c)는 keychain 창을 띄우지 않는 대체, 마지막으로 (b) `claude -p /usage`를 명시적 동의 버튼 뒤에 둔다(소스 확인: `ClaudeCLIUsageProbe.swift`).
- ccusage 메인테이너는 statusline에 플랜 퍼센트를 넣자는 요청을 받아들이지 않았다(이슈 #658, not planned로 닫음): transcript 토큰은 서버의 계기가 아니다.

## 5. 여러 계정을 돌리는 길

| 프로젝트 | 방법 | 한도에서 계정 고르기 | 약관 언급 |
|---|---|---|---|
| **Claude Code 자체**([authentication](https://code.claude.com/docs/en/authentication)) | 계정마다 `CLAUDE_CONFIG_DIR` 하나. 폴더마다 설정·기록·로그인이 따로 | 사람이 고른다 | 문서화됨: "give each account its own configuration directory" |
| [claude-profile-manager](https://github.com/JakubKontra/claude-profile-manager) (~22, MIT) | 프로필마다 `CLAUDE_CONFIG_DIR`, 런처, skills 심볼릭 링크, settings 복사 | 사람이 고른다 | 없음 |
| [account-switcher-for-claude-code](https://github.com/timvgl/account-switcher-for-claude-code) (~0, MIT) | 계정마다 `CLAUDE_CONFIG_DIR`, 동시에 | 사람이 고른다 | "make sure your use of multiple accounts complies with Anthropic's terms of service" |
| [claude-multiprofile](https://github.com/jmdarre-v/claude-multiprofile) (~87, MIT) | `--user-data-dir`(Desktop), `CLAUDE_CONFIG_DIR`(Code) | 사람이 고른다 | 둘을 동시에 열면 토큰이 엉뚱한 인스턴스에 갈 수 있다고 경고 |
| [claude-swap](https://github.com/realiti4/claude-swap) (~2.9k, MIT) | 저장된 로그인(keychain·`.credentials.json`)을 바꿔 끼우고 암호화 백업. `setup-token`과 API 키도 | 임계(기본 5h·7d의 90 %)에서 남은 몫이 가장 큰 계정으로 자동 전환 | 없음 |
| [clauth](https://github.com/uwuclxdy/clauth) (~245, MIT) | 프로필별 스냅샷 교체, 그리고 격리된 `CLAUDE_CONFIG_DIR`에서 `clauth start` | 계정이 한도에 닿으면 대체 사슬 | 없음 |
| [clyde](https://github.com/abiroot/clyde) (~2, MIT) | keychain 로그인을 제자리에서 다시 쓴다. 게이지는 `/api/oauth/usage` | 수동 | 명시: 돌려 쓰기는 "may run against Anthropic's Terms of Service" |
| [teamclaude](https://github.com/KarpelesLab/teamclaude) (~360, MIT) | OAuth 토큰을 모으는 로컬 프록시, 갱신해 다시 쓴다 | 5h·7d 98 %에서 회전, 주간 reset이 가장 빠른 쪽 우선 | `docs/compliance.md`: "Anthropic hasn't explicitly blessed *automated* pooling" |
| [claude-rotate](https://github.com/doxaras/claude-rotate) (~29, MIT), [CC-Router](https://github.com/VictorMinemu/CC-Router) (~34, MIT), [claude-proxy](https://github.com/p4u/claude-proxy) (~1, AGPL) | `ANTHROPIC_BASE_URL` 프록시, 계정별 `setup-token`이나 저장된 OAuth 토큰 | 한도 헤더나 429. claude-proxy는 대화마다 고정 | 모두 경고(회색 지대, 정지 가능성, "you must only use credentials you personally own") |

메커니즘 넷: **폴더 격리**(동시에 됨, 문서화됨), **자격 증명 교체**(한 번에 로그인 하나, 토큰 갱신과 경합), **프록시 모으기**(토큰을 쥐고 회전을 자동화), **API 키**. 한도에서 계정을 저절로 고르는 것은 프록시와 교체 도구뿐이고, 격리 도구는 고르는 일을 사람에게 둔다.

## 6. Anthropic이 말하는 것

[legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)와 [소비자 약관](https://www.anthropic.com/legal/consumer-terms)에서 그대로 옮긴다:

- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- Anthropic은 "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users"이고, 개발자는 "may not collect, store, or intermediate Claude.ai credentials or session tokens"다.
- 소비자 약관: "account login information … or account credentials"를 남과 공유하지 않는다, 그리고 "bots, scripts or other automated or non-human means"로 접근하지 않는다("except where you access our Services through your Anthropic API key or where we explicitly permit it").
- Anthropic은 "reserves the right to take measures to enforce these restrictions and may do so without prior notice".
- 한 사람이 구독을 몇 개까지 가질 수 있는지 제한하는 글은 찾지 못했다. 따로 둔 `CLAUDE_CONFIG_DIR` 폴더와, 자기 스크립트를 위한 `claude setup-token`은 둘 다 문서화되어 있다.
- Agent SDK: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products".

플랜 약관이 무엇을 허용하는지는 atc가 정하지 않는다([accounts.md](../accounts.md) 4절 5단계). 이 조사는 문구만 적는다.

## 7. atc와 견주면

- **계정:** atc는 문서화된 방식(ACCOUNT마다 폴더 하나, 폴더마다 daemon 하나)을 따르고, 거기에 SUPERVISOR만 하는 설정, 토큰 교체 없음, 프록시 없음을 더한다([accounts.md](../accounts.md) 원칙 3·5·7). 토큰을 쥐거나 중개하지 않고, ACCOUNT는 저절로 바뀌지 않는다: ACCOUNT CHANGE는 FLEET PLAN이 제안하고 SUPERVISOR가 승인한다. 표에서 폴더 격리 쪽이고 교체나 모으기 쪽이 아니다.
- **사용량:** atc는 (a)를 쓴다. 이름난 도구들이 먼저 고르는 것이고 문서화된 유일한 스키마다. 빈틈도 그들과 같다: (a)는 그 ACCOUNT에서 도는 세션이 있어야 하므로 놀고 있는 ACCOUNT는 기록이 없다.
- **(c)·(e)·(f)는 atc의 원칙이 이미 막는다:** OAuth 토큰이나 웹 쿠키가 필요하고(원칙 3), (e)는 읽으려는 ACCOUNT에 모델 호출까지 한다. 이 SURVEY의 제약("no model calls on another ACCOUNT")도 이를 막는다.

## 8. 권고

권고: **statusline을 기준 출처로 두고, 기록이 없는 ACCOUNT에는 `/usage`를 필요할 때 읽는 대체를 더한다.** SUPERVISOR가 정할 항목:

1. **statusline은 (a) 그대로.** 돌고 있는 세션이 있는 ACCOUNT는 바뀌는 것이 없다.
2. **REFRESH 읽기 (b)를 더한다:** FUEL ACCOUNT 블록의 REFRESH 버튼, 그리고 FLEET PLAN이 기록 없는 ACCOUNT를 쓰기 직전의 한 번 읽기. 그 ACCOUNT의 `CLAUDE_CONFIG_DIR`을 넣고 깨끗한 환경에서 `claude -p "/usage" --no-session-persistence --output-format json`을 돌려 퍼센트·reset 두 줄만 읽고, ACCOUNT마다 30분 캐시, 동시에 한 번만. atc가 토큰을 읽지 않고, 모델 호출도 없고(측정: 0 턴, 0 USD), `claude`가 문서화한 자기 명령이다.
3. **읽기가 실패하거나 파싱이 안 되면 "unknown"이지 0 %가 아니다.** 위와 별개로 FLEET PLAN은 "no record"를 비어 있음이 아니라 모름으로 다루고 ENTRY·ACCOUNT CHANGE를 거기서 멈추거나 묻는 게 좋다. 2026-09-30의 잘못은 이것만으로 막혔을 것이고 비용이 들지 않는다.
4. **출처를 표시한다.** 숫자 옆에 `statusline`이나 `/usage (12 min ago)`를 붙여 캐시 값을 실시간으로 읽지 않게 한다.

선택지별 위험:

| 선택지 | 위험 |
|---|---|
| statusline만(지금) | 놀고 있는 ACCOUNT는 계속 "no record". 3번을 하지 않으면 잘못된 ENTRY 선택이 이어진다. 새 비용은 없다 |
| `/usage` 필요할 때(권고) | 글이 스키마가 아니라 바뀔 수 있으므로 파서는 관대해야 하고 실패하면 "unknown"으로 떨어져야 한다. 한 번 읽을 때 약 3.9초, 최대 275 MB. `claude` 프로세스가 그 ACCOUNT의 로그인으로 돌지만 통상적 사용이다. `--no-session-persistence`면 세션이 남지 않을 것이나 이 조사는 다시 재지 않았다. 이 방식을 쓰는 프로젝트가 하나뿐이라 현장 경험이 적다 |
| OAuth usage 엔드포인트 (c) | 문서에 없고, 429가 잦고, `user:profile` 토큰 범위가 필요하다. atc가 `.credentials.json`을 읽고 비밀을 쥐어야 하는데 원칙 3·7이 막는다 |
| 헤더 탐침 (e) | 그 ACCOUNT에 실제 모델 요청, 그리고 또 토큰. 제약이 막는다 |
| 웹 쿠키 (f) | 다른 로그인(CLI가 아니라 claude.ai), 쿠키 보관, 문서 없는 API |

새 읽기를 전혀 원하지 않으면 3번만 해도 최소한은 된다: 출처를 바꾸지 않고도 잘못된 ACCOUNT 선택이 사라진다.

## 9. 확인하지 못한 것

- 별 수는 대략치다. 조사 도중 GitHub REST API가 403을 돌려줘서 대부분 프로젝트의 마지막 커밋일을 확인하지 못했다.
- `rate_limits`가 처음 나온 버전, (c)의 응답 모양과 429 대처, CodexBar의 (e) 사용은 Anthropic이 아니라 커뮤니티 출처다.
- 한 프로젝트는 README가 MIT라 하지만 저장소 라이선스 칸이 비어 있다. 여기 적은 라이선스는 저장소 화면에서 읽었다.
- 도구를 직접 돌려 보지 않았다. 2절의 `/usage` 줄(이슈 본문의 측정)을 빼면 이 문서의 어떤 것도 측정이 아니다.
