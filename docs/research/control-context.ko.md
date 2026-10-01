# 조사: 관제 세션의 컨텍스트를 무엇이 채우는가, 그리고 작게 유지하는 방법

[English](control-context.md) · **한국어**

> 상태: [ATC-274](https://linear.app/vocado/issue/ATC-274) SURVEY, 2026-10-01. 이 문서는 매뉴얼, guard, hook, 타이머, 설정, 세션을 하나도 바꾸지 않는다. 3절은 SUPERVISOR가 고를 권고안이고, 정해지거나 만들어진 것은 없다.

관련: [control-recycle.md](../control-recycle.md)(STOP + LAUNCH 설계와 1절의 사실. 여기서 다시 하지 않고 가져다 쓴다), [squelch.md](../squelch.md), [mcc.md](../mcc.md)(새 sub-agent 컨텍스트의 INSPECTION, ATC-135), [duty.md](../duty.md)(서버가 띄우는 `claude -p`, D2), [fuel.md](../fuel.md), [lost-comms-and-contingency.md](lost-comms-and-contingency.md)(7절, position handover).

## 질문

TOWER, OCC, MCC, CROSSCHECK, REVIEW는 `/loop <n>m /tick`으로 며칠씩 돈다. CONTROL RECYCLE은 이 증가를 cap에서의 STOP + LAUNCH로 답한다. 이 조사는 컨텍스트가 무엇으로 되어 있는지, 얼마나 빨리 차는지, 비용이 얼마인지, 그리고 목록의 16개 옵션(과 새로 찾은 것)이 컨텍스트를 작게 유지하는 데 어떻게 쓰이는지를 묻는다.

## 방법과 한계

- **트랜스크립트.** 사용량 필드, 레코드 종류, 블록 종류, 도구 이름, 시각, 글의 *길이*만 읽었다. 메시지 본문은 여기에 하나도 옮기지 않았다. 범위: 2026-09-26 ~ 10-01의 관제 폴더 다섯 곳 트랜스크립트 전부, 계정 폴더 셋(`~/.claude`, `acct-1`, `acct-3`) 모두. 요청 50개 이상인 세션 TOWER 16, OCC 13, MCC 13, CROSSCHECK 6, REVIEW 3개. 요청은 메시지 id로 합친다(마지막 스냅샷이 이김). sub-agent 요청은 이 파일들에 없다. 컨텍스트 = `input + cache_read + cache_creation`으로 `mcc/context-cap.mjs`와 같은 합이다.
- **글자에서 토큰으로.** 트랜스크립트에는 토큰이 아니라 글이 있다. 두 요청 사이의 컨텍스트 증가와 그 사이에 쓰인 글자 수를 비교해 구한 비율(1만 2천 구간)은 **TOWER 2.0 글자/토큰, OCC 1.7, MCC 1.8, CROSSCHECK 2.6, REVIEW 3.3**으로, 흔히 쓰는 4보다 훨씬 낮다. 매뉴얼과 로그가 대부분 한국어와 JSON이기 때문이다. 아래 토큰 수는 이 비율을 쓰고, 비중(%)은 글자 기준이라 비율이 필요 없다.
- **가격**은 `server/fuel-prices.json`(정가, 백만 토큰당: Sonnet 5.5 입력 2·출력 10, Opus 5.5 입력 4·출력 20, 읽기는 입력의 0.1배·0.05배, 1시간 캐시 쓰기는 입력의 2배)에서 가져왔다. 트랜스크립트의 메인 스레드 쓰기는 모두 1시간 캐시 등급이다. CROSSCHECK와 REVIEW는 `ocx`를 거친 비 Anthropic 모델이라 가격이 없어서 달러 줄이 일부만 계산됐다. 청구서가 아니라 요금제 사용량의 정가 환산이다.
- **실험**은 scratch만: 빈 임시 폴더의 Haiku와, 워크트리 하위 폴더의 scratch `--bg` job 하나(Claude Code **2.1.286**). 관제·팀 세션을 STOP, LAUNCH, compact하거나 메시지를 보낸 일은 없고 `~/.local/state/atc/`에 쓴 것도 없다. 총 비용은 **약 1 USD**(작은 Haiku 실행 열두 번쯤 0.4 USD, 하위 에이전트의 headless 기능 확인 약 0.3 USD, 멈춘 scratch job 0.1 USD 미만).
- **unverified**는 문서만 보고 도우미 에이전트가 말했거나 시험하지 못한 주장에 붙였다.

## 1. 현재 사실

### 1.1 바닥: tick 이전에 모든 요청이 지니는 것

| 부분 | 토큰 | 측정 |
|---|---|---|
| system prompt와 내장 도구 스키마(도구 29개, `--strict-mcp-config`, Haiku) | **22.5 k** | 빈 폴더의 `claude -p`, `usage` |
| 같은데 계정의 claude.ai 커넥터를 불러온 것(도구 206–269개) | 27–30 k | 같은 방법. 실행마다 도구 집합이 달라서 공유 캐시 접두부도 깨진다 |
| 루트 `CLAUDE.md` | **+7.1 k** | 그 파일을 복사해 넣은 같은 실행 |
| 폴더 `CLAUDE.md` | **+6.4 k**(TOWER), **+8.4 k**(OCC) | 같다(루트 파일을 바꿔 넣음) |
| skill 목록, deferred 도구 이름, hook·plugin 컨텍스트, 메모리 색인 | 약 **20 k**, 더 쪼개지 않음 | 첫 요청에서 위 줄들을 뺀 값 |
| **LAUNCH 첫 요청 중앙값** | **59 k** TOWER · 64 k OCC · 44 k MCC · 42 k CROSSCHECK · 37 k REVIEW | 트랜스크립트 |

새 세션은 40–65 k에서 시작한다. 컨텍스트를 "작게" 유지하는 어떤 방법도 이 바닥 위에서 일하고, 마지막 줄의 20 k가 아무도 들여다보지 않은 가장 큰 덩어리다.

### 1.2 얼마나 빨리, 무엇으로 자라는가

긴 세션의 시간당 증가(다시 측정, ATC-165와 일치): TOWER 중앙값 41 k(17–150), OCC 47 k(6–260), MCC 42 k, CROSSCHECK 31 k, REVIEW 10 k.

**tick은 대부분 비어 있고, 대부분 다시 읽기다.** tick은 `/loop`이 한 번 터지는 것이다. "busy"는 메시지를 보냈거나 쓰기 명령(`issue`, `readback`, `dispatch note|crosscheck|release|report`, `mcc inspect|land|rts`, `landing review`, SCHEDULE draft·mark, `SendMessage`)을 돌린 tick이다.

| 역할 | 모델에 닿은 tick | 시간당 | idle tick | idle / busy tick의 요청 수(중앙값) | idle / busy tick의 캐시 읽기 | idle / busy tick의 컨텍스트 증가(중앙값, 평균) | 증가·읽기 중 idle 몫 |
|---|---|---|---|---|---|---|---|
| TOWER | 1,779 | 15.6 | 88 % | 3 / 7 | 0.62 M / 1.40 M | 1.1 k, 2.6 k / 3.9 k, 6.6 k | 75 % / 79 % |
| OCC | 626 | 5.8 | 71 % | 3 / 9 | 0.92 M / 1.94 M | 1.0 k, 1.8 k / 7.9 k, 11.1 k | 28 % / 51 % |
| MCC | 701 | 10.8 | 64 % | 2 / 5 | 0.33 M / 1.13 M | 0.7 k, 0.7 k / 4.2 k, 8.8 k | 12 % / 30 % |
| CROSSCHECK | 510 | 5.9 | 88 % | 3 / 6 | 0.56 M / 0.75 M | 3.9 k, 3.1 k / 7.5 k, 11.9 k | 66 % / 81 % |
| REVIEW | 436 | 6.4 | 95 % | 2 / 9 | 0.16 M / 0.45 M | 0.3 k, 0.4 k / 18.9 k, 20.1 k | 28 % / 86 % |

(MCC의 "busy"에는 squelch.md 1절의 shadow 모드에서 반복된 `mcc land`·`mcc rts`가 들어 있다. 이 범위는 일부가 SQUELCH 전이다.)

TOWER의 흔한 idle tick은 도구 호출 셋, 곧 요청 셋이다: `manual check`, `brief`, `ack`(TOWER tick의 29 %가 `manual check > ack`, 23 %가 `manual > brief > ack`). 요청마다 컨텍스트 전체를 다시 읽는다. REVIEW, CROSSCHECK, MCC tick은 대개 호출 둘(`manual`, 그다음 queue나 brief)이고, CROSSCHECK·REVIEW tick의 78–91 %가 도구 호출 둘 이하다.

**자라는 부분의 구성**(세션당 쓰인 글자의 비중. system·지침 스냅샷, skill·도구 목록처럼 세션에 한 번 들어가는 블록은 뺐다):

| 역할 | `atcctl` 출력 | 다시 주입된 `/tick` 본문 | hook 출력¹ | Read 출력 | 들어온 메시지 | `gh` 출력 | 모델 글·thinking·도구 호출 |
|---|---|---|---|---|---|---|---|
| TOWER | **54 %** | **15 %** | 3 % | 0 | 2 % | 0 | 14 % |
| OCC | 17 % | **33 %** | **17 %** | 7 % | 4 % | 0 | 15 % |
| MCC | 16 % | 13 % | **19 %** | 11 % | 9 % | 6 % | 19 % |
| CROSSCHECK | **66 %** | 15 % | 2 % | 10 % | 0 | 0 | 5 % |
| REVIEW | 37 % | 15 % | 7 % | 3 % | 0 | 0 | 29 % |

¹ hook 레코드는 트랜스크립트의 attachment다. `hook_success`가 모델 컨텍스트에 들어가는지는 시험하지 않았다(**unverified**). `hook_additional_context`는 들어간다: OCC의 `PreToolUse:SendMessage` guard가 `SendMessage`마다 붙인다(151건, 한 건 약 2.6 k 글자).

**`/tick` skill 본문은 tick마다 다시 주입된다.** 루프가 터질 때마다 skill 본문 전체가 user 레코드로 다시 쓰인다(TOWER 약 170–220, OCC 약 1,700–1,900, MCC 약 280–310, CROSSCHECK 약 420–500, REVIEW 254 "글자/4 단위", 거기에 명령 레코드 18단위). 짧은 알림으로 줄지 않는다. 도우미 에이전트는 문서가 "같은 skill을 다시 부르면 짧은 알림만 붙는다"고 한다고 읽었는데, `/loop`이 터뜨리는 `/tick`은 트랜스크립트에서 반대다(**문서 해석은 Skill 도구에 대해서는 unverified이고 loop에 대해서는 여기서 반박됐다**). 위 비율로 환산하면:

| 역할 | tick당 본문(토큰) | 시간당 tick | 시간당 다시 주입 | 시간당 증가 중 몫 |
|---|---|---|---|---|
| TOWER | ≈ 440 | 15.6 | **6.9 k** | 17 % |
| OCC | ≈ 3,200 | 5.8 | **18.5 k** | **39 %** |
| MCC | ≈ 870 | 10.8 | 9.4 k | 22 % |
| CROSSCHECK | ≈ 770 | 5.9 | 4.5 k | 15 % |
| REVIEW | ≈ 310 | 6.4 | 2.0 k | 20 % |

OCC의 `/tick`은 12 KB(11.9 KB, 한국어)이고 TOWER는 1.7 KB다. 폴더 `CLAUDE.md`는 한 번만 불러오므로 본문이 그곳을 가리키는 포인터면 tick당 한 줄이면 된다. SQUELCH는 tick이 몇 번 오느냐를 바꾸지, 한 번이 얼마나 큰지를 바꾸지 않는다.

**SQUELCH는 일하지만 증가를 없애지는 못한다.** 2026-09-30 07:47Z쯤부터 `on`이다. 그 뒤 떨어뜨린 비율은 TOWER 28 %, OCC 29 %, MCC 63 %, REVIEW 79 %, CROSSCHECK 81 %(`squelch.jsonl`의 shadow가 아닌 줄). TOWER와 OCC의 fingerprint는 실제지만 작은 event에 열리고, SQUELCH `on` 뒤에 잰 세션도 TOWER 17–150 k/h, OCC 29–260 k/h로 자란다.

### 1.3 비용

달러는 각 역할의 가격이 있는 요청(Anthropic 모델)의 정가 환산이다.

| 역할 | 모델 구성 | 평균 컨텍스트 | 시간당 요청 | $/h | 읽기 / 쓰기 / 출력 |
|---|---|---|---|---|---|
| TOWER | Sonnet 5.5, Sonnet 5, 일부 Opus | 289 k | 42 | **2.82** | 2.43 / 0.29 / 0.10 |
| OCC | Sonnet 5.5, Sonnet 5, 일부 Opus | 332 k | 26 | **2.15** | 1.73 / 0.32 / 0.11 |
| MCC | Opus 5.5 | 234 k | 37 | **2.56** | 1.70 / 0.64 / 0.22 |
| CROSSCHECK, REVIEW | `ocx`의 비 Anthropic | 208 k, 155 k | — | 일부 | 캐시 읽기가 대부분 |

**TOWER·OCC 한 시간의 80–86 %가 캐시 읽기**(TOWER는 시간당 12 M 토큰)이고, 10–25 %가 캐시 쓰기, 3–9 %가 출력이다. 세 역할 합이 정가로 시간당 약 7.5 USD, 하루 약 180 USD다. 모델은 별로 중요하지 않다: Opus 5.5의 읽기 가격(0.05 × 4)이 Sonnet 5.5(0.1 × 2)와 같아서, MCC는 모델을 바꿔도 쓰기와 출력에서만 아낀다.

"cap에서 recycle" 단순 모델은 측정된 증가를 되풀이하고 매 재시작마다 44–64 k 바닥을 다시 쓴다. 지금 비용에 대한 비율은 아래와 같다(지금은 TOWER·OCC cap 500 k, MCC 150 k이고 이틀에 12번 recycle이 기록됐다):

| Cap | TOWER | OCC | MCC | 시간당 재시작(TOWER / OCC / MCC) |
|---|---|---|---|---|
| 100 k | 46 % | 49 % | 34 % | 2.0 / 2.0 / 1.1 |
| 150 k | 42 % | 40 % | 37 % | 0.8 / 0.8 / 0.6 |
| 250 k | 50 % | 47 % | 44 % | 0.3 / 0.3 / 0.2 |

세션을 약 150 k 아래로 두면 비용이 반이 되고, 바닥과 재시작 쓰기 때문에 어떤 cap도 40 % 아래로 크게 내려가지 않는다. FLIGHT RECORDER에는 TOWER를 내려 둔 `launch-failed`가 한 번(2026-09-30 12:19Z) 있고, 09-30 07:22Z ~ 10-01 01:27Z 사이에 성공 12번과 shadow `would` 3줄이 있다.

### 1.4 세션이 자기 과거에서 필요로 하는 것

역할별 표는 [control-recycle.md](../control-recycle.md) 1.2에 있고 그 결론이 그대로다: 지속되는 상태는 모두 서버에 있고, 대화에만 있는 것은 작다(TOWER의 FUEL "이미 알림" key와 RESEND 기억, OCC의 열린 CHARTER REQUEST. 지금은 `schedule wip`이 덮는다). 그래서 **stateless** 설계가 성립한다. 다섯 역할이 tick마다 하는 일은 매우 규칙적이다: TOWER 1,607 tick에 도구 호출 순서가 103가지, CROSSCHECK 497 tick에 59가지, REVIEW 419 tick에 33가지이고, 가장 흔한 순서는 "매뉴얼 확인, brief 읽기, ack"다.

### 1.5 실험(scratch, 2.1.286)

| 질문 | 결과 |
|---|---|
| 서로 다른 `claude -p` 실행이 캐시를 공유하는가? | **그렇다.** 같은 두 번째 실행이 22,500 토큰 중 22,490을 캐시에서 읽었다(쓰기 0). 이 계정에서 headless 쓰기는 **1시간 등급**이라 3–10분마다 tick을 돌리면 접두부가 따뜻하게 유지된다. 실행 사이에 도구 집합이 다르면(커넥터를 불러오거나 말거나) 공통 접두부만 맞는다(29 k 중 18 k) |
| sub-agent의 도구 호출에도 guard(`PreToolUse` hook)가 도는가? | **그렇다**(프로젝트 설정). sub-agent 호출의 hook 입력에는 `agent_id`와 `agent_type`이 있고 부모 호출에는 없어서 guard가 둘을 구별할 수 있다 |
| sub-agent에 `SendMessage`가 있는가? | **있다**, deferred 도구로(`ToolSearch`로 찾는다). 다른 ACCOUNT 세션에 닿는지는 시험하지 않았다(ATC-251은 세션이 안 닿는다고 한다) |
| `claude -p`에서 `SendMessage`를 쓸 수 있는가? | 도구 목록에 있다. 실제 세션으로의 전달은 시험하지 않았다(실제 세션에 메시지 금지) |
| `/compact <지시>` 프롬프트가 headless에서 되는가? | **된다**, 재개한 세션에서: `compactMetadata` `trigger: manual`, 22.8 k → 0.9 k 토큰, 이어서 모델이 남긴 사실로 답했다. 기록은 auto-compact가 쓰는 것과 같다 |
| cron이나 `/loop`이 `/compact`를 배달해도 되는가? | **확인하지 못했다.** scratch `--bg` 시도 하나는 첫 fire 전에 job이 `blocked`가 됐다(원인은 보지 않았다). **unverified** |
| auto-compact 임계값 환경 변수, hook이 `/compact`·`/clear`를 일으키기, tool-result 정리 | Claude Code에서 쓸 수 있다고 문서에 없다(도우미 에이전트, 2026-10-01 문서): **unverified**. 실측은 실제 auto-compact뿐이다(ATC-165 범위에서 9번, 모두 `auto`: 4번은 약 800–970 k, REVIEW 5번은 약 170 k) |
| 가격 | 1M 창 전체에 같은 요율, 긴 컨텍스트 할증 없음(문서, 도우미 에이전트 보고. **unverified**) |

## 2. 옵션

절감은 1.3의 모델(읽기 가격 × 컨텍스트 × 요청)로 구한 추정이고, 역할별로 지금 대비다. "Shadow"는 아무것도 쓰지 않고 살아 있는 세션 옆에서 돌릴 수 있다는 뜻이다. "CC"는 Claude Code다.

| # | 옵션 | 절감 | 잃는 것, 위험 | 공수 | Shadow | 판정 |
|---|---|---|---|---|---|---|
| 1 | 더 얇은 brief(tick card: 할 일만, delta, 크기 상한) | `atcctl` 출력이 증가의 54 %(TOWER)·66 %(CROSSCHECK). 반 크기 card는 증가를 약 25–30 % 늦춘다(추정) | 필요한 것을 가리는 card. 실제 brief로 시험해야 한다 | M(서버 view + 매뉴얼) | 가능(둘 다 쓰고 비교) | **5′ 뒤에 만든다** |
| 2 | `/tick` 본문을 `CLAUDE.md`(한 번 로드)를 가리키는 한 줄 포인터로 | 시간당 6.9 / 18.5 / 9.4 / 4.5 / 2.0 k 토큰(증가의 17–39 %). 요청이 늘지 않는다 | 규칙이 tick 프롬프트에서 메모리 파일로 옮겨 간다. 300 k 컨텍스트 위쪽의 규칙은 덜 지켜질 수 있고, `CLAUDE.md`는 바닥에서도 이미 6–8 k를 낸다 | S(SKILL.md 다섯 개와 CLAUDE.md 순서) | 가능(scratch 루프에서 둘 비교) | **가장 먼저 만든다** |
| 3 | 출력 규율: `gh`·`atcctl` 상한, 짧은 LOG 줄, 보낸 메시지 에코 없음 | `gh` 6 %(MCC), Read 7–11 %(OCC, MCC), OCC `SendMessage` guard 컨텍스트가 OCC 증가의 17 % | 잘린 근거 | S | 가능 | **1과 함께**(guard 문구는 작업 지시서 7) |
| 4 | event로만 깨우기 | SQUELCH가 이미 fire의 28–81 %를 떨어뜨린다. 진짜 event 깨우기는 `/loop`에 없다(문서: 고정 또는 모델이 고르는 간격, channels는 별개. 이 용도로는 **unverified**) | 새로 잃는 것 없음 | — | — | **새 메커니즘은 기각, SQUELCH를 유지·조정**(heartbeat 50분은 이미 1시간 캐시 등급 아래) |
| 5 | Stateless tick: 서버가 brief를 입력으로 새 `claude -p`를 돌린다 | 요청마다 바닥만 읽음: TOWER 시간당 15.6 tick × 1.7 요청 × 59 k를 0.2 USD/M으로, 새 토큰과 출력을 더해 **0.6 USD/h(지금 2.82)**(21 %), OCC 21 %, MCC 30 % | 실행 사이 캐시는 유지된다(1.5). 필요한 것: 전송 경로(`-p`에 도구는 있고 실제 세션·다른 ACCOUNT로의 전달은 미시험. ATC-251), `-p`의 guard(답할 프롬프트가 없으니 allow 목록과 guard뿐), 서버의 headless 런타임(DUTY D2가 선례), 답신의 신원, 대화에만 있던 작은 기억의 재구성(1.4) | L | 가능(전송 끔) | **CROSSCHECK·REVIEW를 shadow로 먼저**(전송 없음, 대화 상태 없음), 그다음 TOWER idle 경로 |
| 5′ | **합친 tick 명령**(새로 찾음): `atcctl tick` 하나가 매뉴얼 확인, brief, 비었을 때 ack를 한다 | idle tick이 요청 3 → 1: 같은 컨텍스트에서 TOWER 읽기 **−51 %**, OCC −30 %, MCC −21 % | 한 명령이 한 단계를 가릴 수 있다. ack가 서버로 간다 | S–M | 가능 | **가장 먼저 만든다** |
| 6 | Sub-agent tick: 긴 세션이 tick을 새 컨텍스트의 sub-agent에 넘기고 한 줄만 남긴다 | 부모는 tick당 2.6 k 대신 약 0.6 k 자란다. 추정 지금 비용의 TOWER 35 %, OCC 28 %, MCC 41 % | sub-agent에도 guard가 돌고(1.5) `SendMessage`도 있지만, 부모가 tick마다 컨텍스트를 두 번 다시 읽고 sub-agent는 폴더 상태 없이 시작한다. ATC-135(MCC INSPECTION)가 선례이고 무거운 단계는 이미 그렇게 돈다 | M | 일부(두 번째 세션) | **무거운 단계에만**(INSPECTION식), 모든 tick에는 아님 |
| 7 | 규칙 따르기 일을 서버로(모델 없이) | TOWER idle tick은 tick의 88 %, 읽기의 79 %다. "할 일 없음"을 서버가 처리하면 사라진다 | 지금은 세션만 `SendMessage`한다. GO AROUND·INFO 문구는 세션이 보내야 하므로 서버는 판단·기록만 하고 전달은 못한다. OCC·MCC는 판단이 남는다 | L(SQUELCH를 규칙 엔진으로 키우는 일) | 가능("했을 일"을 기록) | **SQUELCH가 이미 하는 부분만**(idle tick 버리기). 서버 전달 경로가 생기기 전까지 행동은 미룬다 |
| 8 | STOP + LAUNCH 대신 역할별 지시를 담은 정기 `/compact` | compact 시점의 recycle과 비슷한 비용. 새 세션도, job id·socket 변경도 없다 | 재개한 세션에서 headless로 된다(1.5). `/loop` 아래는 미시험. 규칙 따르기 역할의 요약은 지시만큼만 좋고, atc의 auto-compact 9번(10–22 k로)은 결과 데이터가 없다. compact 직후 요약에 캐시 미스가 난다 | M | scratch 루프 시험 필요 | **scratch 루프에서 먼저 시험**(작업 지시서 8) |
| 9 | CC 컨텍스트 제어 | auto-compact 임계값 env, hook이 일으키는 `/compact`, tool-result 정리, `/clear`: Claude Code에서 쓸 수 있다고 문서에 없다(**unverified**) | — | — | — | **만들 것 없음. 업그레이드 뒤 다시 확인** |
| 10 | recycle 전 스스로 쓰는 요약 handover | card에서 시작하는 recycle(차가운 시작 아님) | cap을 넘어 길어진 바로 그 상태의 세션이 요약을 쓴다. ATC-165가 보여 준 대로 잃는 것은 작고 서버에 있다 | M | 가능 | **11로 대체**(서버가 쓴다) |
| 11 | 서버가 만드는 position relief briefing | recycle을 싸고 안전하게 해서 cap을 150 k로 내릴 수 있다. control-recycle 1.2의 틈(TOWER FUEL key, RESEND)을 닫는다 | 맞게 유지할 요약이 하나 더 생긴다. 항공은 *떠나는* position이 멈추기 전에 기록에서 쓴다고 한다([lost-comms](lost-comms-and-contingency.md) 7절, F8) | M | 가능 | **2와 5′ 뒤에 만든다** |
| 12 | 겹치는 handover(새 세션이 shadow하다가 옛 세션이 멈춤) | 틈 없음, 이중 전송 없음 | 한 tick 동안 한 주파수에 세션 둘. guard에 read-only 모드가 필요하고 launch 한도와 ACCOUNT 여유도 쓴다. 11보다 복잡하다 | L | — | **지금은 기각**(11이 대부분 준다) |
| 13 | cap 대신 시간 기준 교대 | 지금 증가로 4시간 교대는 200–250 k에서 끝난다. 250 k cap과 비슷하다 | 한가해도 비용이 고정이고 증가를 따르지 않는다 | S | 가능 | **기각**. cap을 유지하고 최대 나이는 보루로만 추가 |
| 14 | 일상 tick은 싼 모델, 판단은 강한 모델 | TOWER를 Haiku로 하면 읽기 가격이 반(0.1 대 0.2 USD/M). MCC를 Opus→Sonnet로 하면 쓰기·출력만 준다(읽기는 같다) | 역할별 품질을 모른다. 단계별 모델은 5–6개 설정이 필요 | M | 가능(결정 비교) | **5′와 2 뒤에 시도**(컨텍스트가 작으면 싼 모델의 품질 손해가 작다. 큰 컨텍스트가 싼 모델에 가장 해롭다) |
| 15 | 세션을 줄이거나 작게(역할 합치기, lane 나누기) | TOWER와 MCC를 합치면 바닥은 하나지만 컨텍스트가 각각 두 배가 된다 | 매뉴얼, guard, 간격이 다르다. 한 번 고장에 둘이 같이 선다 | L | — | **기각** |
| 16 | 1M 대 200k 창 | 할증 없음. 비용이 컨텍스트에 선형이라 compact 지점 말고는 손익분기점이 없다 | 큰 창은 compact를 늦출 뿐이다 | — | — | **수단으로는 기각. cap으로 고른다** |
| N1 | **hook 출력 줄이기**(새로 찾음) | OCC `SendMessage` guard 컨텍스트가 OCC 증가의 17 %(전송마다 약 2.6 k 글자) | guard 문구는 안전 문구다. 바꾸려면 SUPERVISOR가 정해야 한다(guard는 fail-closed) | S | — | **SUPERVISOR에게 묻는다** |
| N2 | **바닥 점검**(새로 찾음) | 시작 59 k 중 20 k가 설명되지 않는다(skill·도구 목록, plugin·hook 컨텍스트). 10 k를 줄이면 모든 세션의 모든 요청에서 17 % 줄이는 값이다 | scratch 행렬 실행이 필요 | S | 가능 | **일찍 한다**(작업 지시서 6) |
| N3 | **TOWER·OCC cap 낮추기**(새로 찾음, 기존 장치) | 500 k → 150–250 k: 지금 비용의 50–58 %(1.3) | recycle이 늘고(TOWER는 150 k에서 하루 19번까지) 한 번 본 실패(`launch-failed`)가 늘어난다 | S | 이미 `shadow`가 있다 | **2, 5′, 11 뒤에**: 먼저 250 k |
| N4 | **heartbeat·SQUELCH 조정**(새로 찾음) | TOWER·OCC fingerprint는 fire의 71–72 %에 열린다 | 놓친 event | S | 가능(shadow 줄) | **나중에** |

## 3. 앞으로 2주의 권고

**무엇이 채우는가.** 40–65 k 바닥 위에서 컨텍스트는 시간당 30–47 k씩 자란다. tick마다 세 가지가 더해지기 때문이다: `atcctl` 출력(TOWER 증가의 54 %, CROSSCHECK 66 %), `/tick` 본문 전체 다시(TOWER 17 %, **OCC 39 %**), guard와 harness 글. 비용은 증가가 아니라 읽기다: 돈의 80–86 %가 캐시 읽기이고, idle tick은 아무것도 정하지 않으려고 300 k 토큰을 읽는 요청을 셋 한다.

**이 순서로 만든다**

1. **옵션 2, `/tick` 본문을 포인터로.** 몇 시간 일이고 새 메커니즘이 없으며, 증가의 17–39 %와 OCC의 시간당 약 18 k 토큰을 없앤다. OCC부터(tick당 3,200 토큰).
2. **옵션 5′, 역할별 합친 `atcctl tick`**(매뉴얼 확인, brief, 비었을 때 ack를 한 번에), TOWER부터. idle tick의 요청을 3에서 1로 줄여 컨텍스트 크기와 상관없이 TOWER의 읽기를 반쯤 줄인다.
3. **옵션 1과 3(tick card와 출력 상한)**, 위 둘이 한 주 돈 뒤에: 그때야 각 brief가 아직 무엇을 더하는지 보인다.
4. **옵션 11(서버가 쓰는 relief briefing), 그다음 cap 낮추기(N3)**: TOWER·OCC 250 k, MCC는 150 k 유지. 이 전에 cap을 낮추지 않는다: 지금 recycle은 차가운 시작이고 실제 13번 중 `launch-failed`가 한 번 났다.
5. **Shadow, 전송 없이: CROSSCHECK·REVIEW의 stateless tick(옵션 5).** 대화 상태가 없으니 같은 brief로 10분마다 headless 실행하고, 그 mark·review를 살아 있는 세션의 것과 비교한다. 그다음 TOWER의 idle 경로를 정한다.
6. **scratch에서 시험**: 옵션 8(loop가 배달하는 `/compact`)과 바닥(N2).

**지금 하지 않는다**: TOWER의 싼 모델(14: 컨텍스트가 작아질 때까지 기다림), 모든 tick에 sub-agent(6), 겹치는 handover(12), 시간 기준 교대(13), 역할 합치기(15), 1M 창(16).

**기대 효과**(모델 추정, 2절과 1.3). 지금 비용에 대한 비율로, 5′만 / 5′에 150 k cap: TOWER 56 % / 22 %, OCC 76 % / 30 %, MCC 86 % / 31 %. 옵션 2는 둘 모두에 더해지고 모델에 넣지 않았다.

**효과가 있었는지 재는 것**(모두 트랜스크립트에서, 역할별, 주 단위, 이 조사와 같은 스크립트. 작업 지시서 1):

- 시간당 캐시 읽기 토큰과 정가 달러(지금 TOWER 12 M·2.8 USD, OCC 8.7 M·2.2 USD, MCC 8.5 M·2.6 USD);
- 시간당 컨텍스트 증가(지금 41 k, 47 k, 42 k)와 tick당 다시 주입된 토큰;
- idle tick당 요청 수(지금 3, 3, 2);
- 하루 recycle 수, `launch-failed` 수, STOP에서 다음 tick까지 시간;
- 작은 기억의 정확성: 반복된 RESEND, 반복된 FUEL 보고, overdue CLEARANCE·FLIGHT PLAN, 빠진 ARRIVED 보고(모두 이미 기록에 있다);
- shadow 실행은 같은 brief에서 stateless 판단이 살아 있는 판단과 얼마나 같은가.

## 4. 후속 작업 지시서(Linear에는 만들지 않음)

| # | 제목 | 범위 | 예상 tier |
|---|---|---|---|
| 1 | 컨텍스트 장부: 관제 역할별 읽기 전용 일일 한 줄(시간당 읽기 토큰, 증가, idle tick당 요청, $/h, recycle) | 트랜스크립트를 보는 `server/` view. ATC-165·ATC-274 방법과 READABILITY 패턴을 재사용. 매뉴얼 변경 없음 | auto |
| 2 | `/tick` 본문을 포인터로(OCC부터, 그다음 MCC, TOWER, CROSSCHECK, REVIEW) | `.claude/skills/tick/SKILL.md` 다섯 개와 `CLAUDE.md`. 먼저 scratch 루프에서 shadow 확인 | 경로가 `.claude/` 아래면 user, 아니면 flagged(`deploy/landing-tier.mjs`로 확인) |
| 3 | 역할별 합친 `atcctl tick`, TOWER부터 | `controller/atcctl.mjs`, 서버 tick view, 매뉴얼. guard의 allow 목록이 허용해야 한다 | flagged(매뉴얼·CLI). guard가 바뀌면 user |
| 4 | tick card: delta와 크기 상한이 있는 brief view, `gh`·`atcctl` 출력 상한 | 서버 view와 매뉴얼 | flagged |
| 5 | recycle 때 서버가 쓰는 relief briefing(F8) | STOP 전에 서버가 상태에서 쓰고 새 세션이 먼저 읽는다 | flagged |
| 6 | SURVEY: 20 k 바닥 점검(skill·도구 목록, plugin·hook 컨텍스트)을 scratch에서 | scratch 실행만 | auto(문서) |
| 7 | OCC `SendMessage` guard 컨텍스트: 전송마다 붙는 문구 줄이기 | `occ/send-guard.mjs` 문구만, 검사는 그대로 | user(guard). 먼저 SUPERVISOR에게 묻는다 |
| 8 | SURVEY: loop가 배달하는 `/compact`와 규칙 따르기 역할의 compact 품질 | scratch `--bg` 루프. compact 뒤 행동을 recycle과 비교 | auto(문서) |
| 9 | CROSSCHECK·REVIEW의 shadow stateless tick 러너(전송 없음) | DUTY D2 같은 `server/` headless 러너. 비교 로그만 쓴다 | flagged |
| 10 | SQUELCH 조정(TOWER·OCC fingerprint가 fire의 71–72 %에 열림) | `server/squelch*.ts` fingerprint | flagged |
| 11 | TOWER·OCC cap을 250 k로 | SUPERVISOR가 설정 창에서 `control-recycle.json`을 바꾼다. 2, 3, 5 뒤 | 해당 없음(SUPERVISOR 설정) |

## 5. 이 조사가 하지 않은 것

- 관제·팀 세션은 어떤 식으로도 돌리지 않았고 메시지 본문도 읽지 않았다. 트랜스크립트 작업은 모두 개수와 길이다.
- 1.3과 2절의 sawtooth·옵션 비용은 측정한 입력(증가, tick당 요청, 바닥, 가격)으로 만든 모델이지 바꾼 시스템의 재생이 아니다. 글자/토큰 비율은 회귀로 구한 값이라, 한 역할의 실제 tick당 토큰은 수십 % 다를 수 있다.
- headless 실행에서 실제 세션으로의 전송, 실제 `/loop` 아래의 `/compact`, compact된 규칙 따르기 세션의 품질은 시험하지 않았다.
