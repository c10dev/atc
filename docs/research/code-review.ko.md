# 코드 리뷰와 머지 전 검사: 다른 곳은 어떻게 하나, atc는 무엇을 바꿔야 하나

[English](code-review.md) · **한국어**

상태: SURVEY 결과물(ATC-332), 2026-10-01 작성. 조사만 했다: 코드도 설정도 실제 PR도 바꾸지 않았다. 숫자는 2026-10-01 ~17:10Z까지 7일의 스냅샷이다. 로그가 계속 쌓이므로 다시 돌리면 몇 줄 다르다.

**아래에서 쓰는 표시.** *[observed]*는 atc 자체 로그나 GitHub에서 읽기만 해서 얻은 것. *[replay]*는 계산이다: 이미 머지된 PR에 atc 규칙을 다시 돌렸다(atc가 다른 곳에 두는 자료가 필요한 규칙은 하한). *[outside]*는 날짜가 있는 공개 출처. *[assumed]*는 측정이 아닌 내 추론. *unverified*는 확인하지 못했다는 뜻.

atc는 공개 저장소다. AUTOLAND AIRPORT는 여기서 **AIRPORT A**라 부르고, 그 PR·파일·사람·워크플로 이름은 쓰지 않는다. atc 자신의 AIRPORT는 ATCC.

## 요약

- **병목은 리뷰 품질이 아니라 머지에 이르는 길이다.** AIRPORT A에서 7일간 PR 121건이 머지됐고(열고 나서 머지까지 중앙값 150분, p90 45시간) 머지 없이 닫힌 PR은 0건이었다 [observed]. 한 계정이 전부 머지했다: 약 117건은 손으로, AUTOLAND는 4건(그중 2건은 오늘 16:25Z에 `reviewedSecurity: delegate`를 켠 뒤). GitHub 리뷰 중 사람의 승인은 없었다 [observed]. 모델(MCC INSPECTION)과 LANDING 등급이 정하는 ATCC에서는 중앙값이 5분이다 [observed]. 느린 것은 모델 레인이 아니다.
- **AIRPORT A 길의 시간을 먹는 세 가지:** (1) 보안 게이트: 머지된 PR의 79%에 어떤 규칙이든 걸리고 [replay], 키워드 규칙 하나만으로 42%에 걸린다 [replay]. 오늘 `reviewedSecurity: delegate`가 켜지기 전까지 그 PR은 SUPERVISOR 몫이었고, 손 머지 약 117건이 거기서 나왔다 [replay와 스위치 시각에서 추정]. 위임 뒤에는 머지 리뷰가 통과한 head에 결정적 규칙만 PR을 붙잡는다. 그래도 SUPERVISOR에게 오는 수는 제외 사유를 기록하지 않아서 재지 못했다. (2) `Require up to date`와 한 번에 하나씩 하는 update 대기열: AUTOLAND 머지 4건에 update 53번, 27건 CLEARED, 24건 blocked, 그 막힘의 절반쯤은 리뷰 모양(update가 head의 유효한 리뷰를 없앰) [observed]. (3) Codex에 기댄 리뷰 용량: Codex는 머지된 121건 중 30건만 리뷰했고 [observed], 재리뷰 요청 13건 중 11건이 REVIEW로 갔으며, 리뷰한 PR의 35%는 둘째 head를 다시 리뷰받아야 했다.
- **바깥 관행은 모양은 같고 숫자는 다르다.** 에이전트 코드를 많이 내는 팀은 아직 머지에 사람을 두지만(Stripe, Shopify, Google) 위험으로 가른다(Meta RADAR의 깔때기, Cloudflare의 등급). 리뷰어 에이전트를 여럿 두고 검증 단계를 붙이며(Anthropic, Cloudflare), AI가 불안정을 키우므로 rework와 incident를 잰다(DORA 2025). 모델 둘은 독립이 아니다: 오류가 겹친다(ICML 2025). GitHub merge queue는 개인 소유 비공개 저장소에서 쓸 수 없다.
- **권고(첫 걸음): AIRPORT A `main`의 "Require up to date"를 끄고 필수 CI 체크는 두며, PR이 CLEARED가 되는 즉시 AUTOLAND가 머지하게 한다.** 안전망은 머지 뒤 main 체크와 GROUND STOP(ATC-330이 걸리게 고친다), 매주 보는 다섯 숫자는 빨간 main head, revert·hotfix PR, 뒤늦은 리뷰 지적, 독립 감사 표본, AUTOLAND가 머지한 비율이다. 기준선: strict일 때 main head 118개 중 2개가 빨강(1.7%) [observed]. 되돌림 조건은 미리 정한다(4절). 이것은 SUPERVISOR의 저장소 설정이다. 솔직한 한계: 가장 큰 절감인 위임은 오늘 켜서 몇 시간치 자료뿐이다. 그래서 새 코드가 필요 없는 마지막 측정된 비용을 첫 걸음으로 골랐고, 같은 주의 자료(W1)가 다음 한계가 리뷰 용량인지 알려 준다.
- **둘째, shadow로 먼저:** 키워드 게이트를 리뷰어가 diff를 보고 내리는 판단으로 바꾼다. 결정적 규칙(비밀 경로, migration, Risk 라벨, FLIGHT 없음)은 그대로 둔다.

## 어떻게 만들었나

- 1부: 웹 조사 sub-agent 셋(AI 리뷰어, 에이전트 PR의 리뷰어·라우팅·지표, merge queue·보안 리뷰·머지 뒤 검증)이 2026-10-01에 벤더 문서, 엔지니어링 블로그, 논문을 읽었다. 출처는 내가 다시 열어 보지 않았다. 날짜가 없는 쪽은 날짜 칸에 그렇게 적었고, 확신이 서지 않으면 *unverified*다. 벤더가 쓴 벤치마크는 표시했다.
- 2부: `autoland.jsonl`, `landing-reviews.jsonl`, `autoland-reviews.jsonl`, `mcc.jsonl`, `logbook.jsonl`, `human-checks.jsonl`, 운영 중인 서비스의 `GET /api/autoland`를 읽기만 했고, 머지·닫힌 PR과 `main` push 실행을 `gh`로 읽기만 했다. 코드를 읽는 sub-agent가 레인과 게이트를 파일·줄과 함께 정리했고, 게이트 규칙은 `server/landing.ts`와 대조했다. `~/.local/state/atc/` 아래 어떤 파일도 쓰지 않았고, 세션에 메시지를 보내지 않았고, PR에 댓글·라벨을 달지 않았고, 앱이나 Action을 설치하지 않았다. 이 문서 밖으로 나가는 것은 개수뿐이다.
- **하지 않은 것:** 선택 항목인 실험(머지된 PR 10–20건을 후보 리뷰어에 다시 돌리기). 작은 표본에 돈을 쓰는 일이고 권고에 필요하지 않았다. 후속 W8이다.
- **지출:** sub-agent 4개, 합쳐 약 35만 토큰(7.59만, 8.40만, 7.60만, 11.51만). 외부 리뷰 제품이나 유료 API는 부르지 않았다. 달러는 재지 않았다. 정가로 3달러 안쪽이라고 추정한다 *[assumed]*.

## 1. atc 밖의 현재 관행

날짜는 출처에 있으면 발행일이다. "날짜 없음"은 쪽에 날짜가 없다는 뜻이며 2026-10-01 현재로 본다.

### 1.1 AI 코드 리뷰어

| 도구 | 무엇을 보고 어떻게 순위를 매기나 | 오탐, 재리뷰 | 게이트, 개인 비공개 저장소의 요금 | 출처 · 날짜 |
|---|---|---|---|---|
| GitHub Copilot code review | diff와 관련된 바뀐 파일, PR 글. High / Medium / Low. | 오탐 수치 없음. 재리뷰는 수동(자동 리뷰를 켜지 않으면). 기각한 댓글을 되풀이할 수 있음. | Comment 리뷰라서 승인으로 세지 않는다. 유료 Copilot 플랜 필요. 비공개 저장소 리뷰는 2026-06-01부터 Actions 분을 쓴다. | GitHub 문서(날짜 없음), GitHub changelog 2026-04-27 |
| OpenAI Codex review | `AGENTS.md` 규칙에 비춘 PR diff. P0·P1만 표시. | 오탐 수치 없음. PR이 열리면 자동, 요청은 `@codex review`. push 재리뷰는 *unverified*. | Plus/Pro 기능. 가격표상 Free/Go/Business는 아님(2차 출처는 다르게 말함: *unverified*). 필수 체크로 쓴다는 문서는 없다. | OpenAI 문서·가격표(날짜 없음) |
| Claude Code review(관리형) | 에이전트 여럿이 병렬로 보고 검증 단계를 둔다. 코드베이스와 `CLAUDE.md`/`REVIEW.md`를 읽는다. Important / Nit / Pre-existing. | 오탐 수치 없음. 저장소별로 한 번, push마다, 수동. push 리뷰는 고친 스레드를 닫는다. | 체크 런이 늘 neutral로 끝나 막지 않는다. 막으려면 자체 CI에서 출력을 해석해야 한다. Team/Enterprise만, 토큰 과금으로 리뷰당 $15–25쯤. 로컬 `/code-review`는 모든 플랜. | Claude Code 문서("July 2026" 변경 메모 뒤 갱신) |
| CodeRabbit | 저장소를 복제해 코드 그래프를 만들고 린터 40개 이상을 돌린다. 프로필 chill/assertive, 머지 전 체크 off/warning/error. | 벤더 오탐 수치 없음. push마다 증분 리뷰. | error 수준 체크에 request-changes를 켜면 branch protection으로 막는다. 비공개 저장소는 14일 체험 뒤 개발자 월 $24–72. | CodeRabbit 문서·가격표(날짜 없음) |
| Greptile | 코드베이스 전체 그래프. P0–P2 배지와 0–5 신뢰 점수, 심각도 문턱. | 벤더 오탐 수치 없음. 새 커밋에 다시 돈다(트리거 표현은 불분명). | 게이트: 문서 없음. 무료 월 50 크레딧, Pro 좌석당 $30. | Greptile 문서·가격표(날짜 없음) |
| Graphite(Diamond, 지금은 Graphite Agent) | 코드베이스를 아는 리뷰. 순위 기준은 공개 안 됨. | 공개 수치 없음. | 게이트: 문서 없음. 개인 저장소용 Hobby 무료, Team 사용자당 $40. Diamond는 2025-10-08에 이름이 바뀜. | Graphite 블로그 2025-03-19, 2025-10-07 |
| Cursor Bugbot | diff 댓글, 심각도. | 오탐 수치 없음. 기본이 증분, PR당 한 번 옵션. | CI 체크의 지적은 기본이 neutral이라 필수로 걸어도 막지 않는다. 사용량 과금. | Cursor 문서(날짜 없음) |
| Qodo(PR-Agent) | 저장소 전체 맥락을 주장, 심각도 순위. | 수치 없음, 기각된 지적에서 배운다(벤더 주장). 커밋마다 트리거. | 결정적인 Quality Gate를 필수 체크로 쓸 수 있다. PR-Agent 자체는 LLM 오류에도 0으로 끝난다(커뮤니티 보고, *unverified*). 무료 플랜은 조직당 월 30회(2차). | Qodo 문서(날짜 없음) |

**벤치마크.** 방법과 함께 오탐 수치를 낸 벤더는 없고 제3자만 낸다. Martian Code Review Bench(독립, 오프라인: PR 50건과 사람이 쓴 정답 댓글 136개와 LLM 심판, 온라인: 약 20–30만 PR에서 개발자의 수용, 2026-01~02)는 상위 도구의 F1을 51–64%로 보고하고, 벤더들의 설명은 순위가 서로 다르다(CodeAnt·CodeRabbit 블로그, 2026). 벤더가 쓴 벤치마크(Augment, 2026, 정확한 날짜 없음)는 Codex를 정밀도 68%/재현율 29%, Claude Code를 23%/51%, Copilot을 20%/34%로 둔다 *[vendor, 편향]*. 여기서 정밀도는 "그 댓글이 코드 변경으로 이어졌다"이며 대리 지표이지 정답이 아니다. 요점: 도구마다 재현율 차이가 가장 크고, 기본으로 막는다고 문서에 적힌 것은 없으며, Copilot·Bugbot·관리형 Claude 리뷰는 설계상 neutral이다.

### 1.2 에이전트가 쓴 PR을 누가 어떻게 리뷰하나

| 관행 | 증거 | 출처 · 날짜 |
|---|---|---|
| 머지에서는 아직 사람이 승인 | Stripe: 사람이 쓴 코드가 없는 PR이 주 1,300건 이상, "전부 사람이 리뷰"(2차, 원문 못 찾음, *unverified*). Shopify: 선임 리뷰가 이제 병목, revert 비율은 안정. Google: 새 코드의 75%가 AI가 쓰고 엔지니어가 승인. | tenki.cloud 블로그, Medium 2026-02(2차), BVP 2026-04-02, DevOps.com 2026-04 |
| 리뷰어는 사람을 대체가 아니라 보완하는 검증자, 재현율보다 정밀도 | OpenAI: 저장소 전체 맥락과 실행과 리뷰 전용 학습이 diff만 보는 것보다 낫다. 내부 댓글의 52.7%가 코드 변경으로 이어졌다. | OpenAI alignment 블로그 2025-12-01 |
| 쓴 쪽과 리뷰하는 모델을 다르게 | "변경을 쓴 에이전트는 그 변경을 인증하지 않는다", LLM 리뷰의 자기 선호. 벤더를 가로지르는 짝짓기가 늘고 있다. | Augment 가이드(날짜 *unverified*), OpenAI Codex 업그레이드 2025-09 |
| 리뷰어 여럿에 검증과 중복 제거 | Anthropic Code Review: 병렬 에이전트, 검증 필터, 점수 문턱 80, "지적의 1% 미만이 틀림", 실질 댓글이 달린 PR 비율 16%에서 54%(벤더 자기 보고). Cloudflare: 조정자가 중복을 없애고 거른다. 131,246회, 중앙값 3분 39초, 평균 $1.19, break-glass 우회 0.6%. | claude.com/blog/code-review 2026-03-09, Cloudflare 블로그 2026-04-20 |
| **주의: 모델 둘은 독립이 아니다** | LLM 둘이 같이 틀리면 60%는 같은 오답을 고른다. 같은 벤더와 더 새 모델일수록 더 겹친다. 심판 패널 연구는 명목상 독립성의 약 3/4을 잃었다. | arXiv 2506.07962(ICML 2025), arXiv 2605.29800(2026) |
| 읽기와 돌리기 | "읽으면 소스에 보이는 것을 찾고, 돌리면 실행 때만 나타나는 것을 찾는다", 서로의 빈틈을 못 덮는다. Veracode: AI 코드 표본의 45%에 OWASP Top 10 결함. | specstory(날짜 *unverified*), Veracode 2025-07-30 |
| 에이전트 PR의 리뷰는 얇다 | 에이전트 PR 33,596건 연구: 61%에 사람 리뷰 기록이 없고 리뷰 비율이 약 48%에서 21%로 떨어졌다. AI 코드의 리뷰 댓글은 정확성보다 문서·스타일·테스트에 몰린다. | arXiv 2607.01904(2026), arXiv 2601.19287(2026-01-27) |

### 1.3 위험 기반 라우팅

| 관행 | 증거 | 출처 · 날짜 |
|---|---|---|
| Ship / Show / Ask | Ship = 바로 mainline(문서, 별것 없는 수정), Show = PR을 올리고 기다리지 않고 머지, Ask = PR을 올리고 기다림. "승인이 PR 머지의 요건이어서는 안 된다." | martinfowler.com 2021-09-08 |
| 위험 점수 깔때기(가장 큰 규모의 글) | Meta RADAR: 출처 분류, 자격 게이트, 정적 휴리스틱, ML 위험 점수, LLM 리뷰, 결정적 검증. diff 535k건 리뷰, 331k건 landing. RADAR가 아닌 diff 대비 revert 비율 1/3, incident 비율 1/50, 닫는 시간 중앙값 330% 넘게 개선. | arXiv 2605.30208, 2026-05-28 |
| 크기 등급, 보안 경로는 늘 올림 | Cloudflare: Trivial(10줄 이하) 에이전트 2, Lite(100줄 이하) 4, Full(100줄 초과나 50파일 초과) 7+. auth·crypto 같은 경로는 늘 Full. | Cloudflare 블로그 2026-04-20 |
| 경로 소유는 위험이 아니다 | CODEOWNERS에서 위험을 뽑지 말고 위험 라벨 파일을 따로 둔다. 문서만 바뀌면 변경 경로 허용 목록으로 자동 승인, 크기 상한, 파일 목록이 잘리면 닫힌 채로 둔다. | GitHub 이슈(2026, 날짜 *unverified*), 마켓플레이스 Action 문서(날짜 *unverified*) |
| 승인 에이전트 | Cursor의 "PR Routing & Approval"이 위험으로 분류하고 에이전트가 승인할 수 있는 위험의 상한을 둔다. | cursor.com/docs/approval-agents(날짜 *unverified*) |
| **키워드 오탐 피하기** | GitHub secret scanning이 LLM 맥락 확인("이 값이 비밀로 쓰이나")을 더해 오탐을 75.76% 줄였다. "패턴 매칭은 값이 비밀처럼 보인다고는 말하지만 비밀로 쓰이는지는 말하지 못한다." diff를 보는 스캔은 추가된 줄만 점수를 매긴다. token·key 이름 근처의 키워드 매칭은 "정밀도가 무너지는 곳". | GitHub 블로그 2026-06-11, cremit.io(날짜 *unverified*) |

### 1.4 브랜치를 최신으로 두기

| 방식 | 증거 | 출처 · 날짜 |
|---|---|---|
| "Require up to date"(strict 체크) | 문서의 대가: 다른 머지 뒤마다 head를 최신으로 맞춰야 해서 빌드가 늘어난다. 실제로는 머지 하나가 열린 모든 PR의 초록 체크를 무효로 만든다: "merge-queue tax"는 커밋 속도 곱하기 열린 PR 수로 커진다. | GitHub 문서(2026-10-01에 열람, 날짜 없음), 커뮤니티 이슈 보고 2026 |
| GitHub merge queue | 각 PR을 앞의 PR들 뒤에 머지한 것처럼 시험한다. main은 실패하는 커밋으로 갱신되지 않는다. GitHub: 평균 대기 33% 감소, 엔지니어 500명 이상이 월 2,500 PR. **조직 소유 공개 저장소와 Enterprise Cloud 조직의 비공개 저장소에서만 쓸 수 있다. 개인 소유 저장소는 안 되고 Team도 안 된다.** | GitHub 블로그 2023-07, 커뮤니티 토론 51483·131130(문서를 인용, 2023–2025), 원문 가용성 문단은 *unverified* |
| 제3자 queue | Mergify: 활성 기여자 5명 이하의 비공개 팀은 무료, queue 포함. Graphite: Team 등급(사용자당 $40)에 queue. Aviator: 개발자당 $20부터 queue. 셋 다 개인 계정 저장소에 붙는지는 *unverified*. bors-ng는 보관됨(2024-04-04). | 벤더 가격 쪽 2026-10-01 열람, bors-ng README(보관 2024-04-04) |
| Stacked PR | GitHub stacked PR은 공개 미리보기이고 2026-07-30부터 모든 저장소에 열렸으며 같은 저장소 안에서만 된다. merge queue 지원은 순차 적용 중. Graphite: GitHub queue는 "stack을 이해하지 못한다". | GitHub 문서(2026-10-01 열람), InfoQ 2026-08, Graphite 문서 |
| 현장 보고(실패 모양) | 열린 에이전트 PR 15개 이상이 사람 한 명의 머지 용량을 넘어섰다. "플릿 전체 열린 PR 96개". | cncf/endusers 이슈 58(2026), prlens.dev |

### 1.5 리뷰 품질을 재는 법

| 지표 | 팀이 추적하고 공개하는 것 | 출처 · 날짜 |
|---|---|---|
| DORA | 2025 보고서: AI는 증폭기, 처리량도 불안정도 오른다. 다섯째 지표 rework rate가 있는 까닭은 change-failure rate가 머지된 뒤 조용히 고쳐지는 코드를 놓치기 때문. "리뷰 시간 +441%, PR당 incident +242.7%, PR 크기 +51.3%" 묶음은 DORA가 아니라 Faros 요약에 Faros 자료가 섞인 것(*unverified*). 2024 등급: elite의 change fail rate 0–5%. | DevOps.com 2025-09-29, RedMonk 2025-12-18, Faros 2025-09, dora.dev(2026-01-05 갱신, 등급 없음) |
| 주기 벤치마크 | Swarmia: elite는 PR 주기 24시간 미만, 배치 200줄 미만, change failure rate 5% 미만. LinearB(PR 610만, 2025-01-08): PR 크기가 가장 큰 요인, elite는 150줄 미만, 착수 1시간 미만. | swarmia.com 2026-02-06, linearb.io 2025-01-08, exceeds.ai(날짜 *unverified*) |
| 댓글 수용률 | Codex 내부 2025-12: PR의 36%에 댓글, 그중 46%가 변경으로 이어짐. Graphite(벤더): 지적의 55%가 변경으로 이어짐, 사람은 49%. 기업의 AI 제안 수용률 27–35%(2차). | OpenAI 2025-12-01, Graphite(contrary.com 경유, 날짜 *unverified*), softwareseni(날짜 *unverified*) |
| 빠져나간 결함 | 빠져나간 결함 비율 = 운영 결함 / 전체 결함, elite는 10% 미만. 사람 리뷰의 효과는 약 400줄을 넘으면 무너진다. | devstats 용어집, Endor Labs(날짜 *unverified*) |
| 그 밖의 효과 | METR 2025-07-10: 숙련 개발자가 AI로 19% 느려졌는데 본인은 20% 빨라졌다고 느꼈다. GitClear 2025-02: 복붙 줄 8.3%에서 12.3%, 리팩터한 줄 25%에서 10% 미만. | metr.org 2025-07-10, gitclear.com 2025-02 |

### 1.6 보안 리뷰

| 통제 | 머지 전 게이트인가 참고인가, 개인 비공개 저장소에서 쓸 수 있나 | 출처 · 날짜 |
|---|---|---|
| Secret scanning과 push protection | 공개 저장소는 무료. 비공개는 GitHub Secret Protection이 필요하고 Team이나 Enterprise 조직에만 판다: **개인 비공개 저장소에서는 쓸 수 없다.** push 자체를 막는다. | GitHub 문서(2026-10-01 열람), changelog 2025-12-02 |
| CodeQL 코드 스캔 | 공개 저장소는 무료. 비공개는 Code Security(조직 Team 이상). Free·Pro는 공개 저장소만. 오픈소스 CodeQL CLI는 자체 CI에서 돌릴 수 있다. | GitHub 문서(검색 경유, 2026-10-01) |
| Dependency review | Action이 취약한 새 의존성에서 체크를 실패시키고 필수 체크로 걸 수 있다. 비공개 저장소는 Advanced Security 라이선스가 필요. | actions/dependency-review-action README |
| Semgrep | Community는 무료이고 직접 돌릴 수 있으며 파일 하나 안에서만 분석. Cloud는 기여자 10명·비공개 저장소 10개까지 무료. Assistant는 오탐 분류 정확도 95% 초과를 주장(벤더). | semgrep.dev 2025(글 여럿) |
| Snyk | 무료: 비공개 저장소 월 200 테스트. | snyk.io(검색 경유 2026-10-01) |
| AI 보안 리뷰 | Claude `/security-review`와 그 GitHub Action은 Actions를 돌릴 수 있는 어느 저장소에서나 돈다. branch protection에 묶지 않으면 참고용. 2026-04에 `pull_request_target` AI 리뷰 Action의 프롬프트 주입 결함(CVSS 9.4)이 비밀을 유출했다: 자기 기여자만 믿는다. SAST 오탐은 높다(OWASP 벤치마크 연구: CodeQL 약 68%, Semgrep 약 75%). LLM 후처리가 한 연구에서 92% 초과를 약 6%로 줄였다. | github.com/anthropics/claude-code-security-review(날짜 없음), esecurityplanet 2026-04, arXiv 2601.19239·2508.04448 |
| 실제로 막는가 참고인가 | 필수 체크로 설정하면 막는다: dependency review, 코드 스캔, push protection. 참고용: Copilot Autofix, Semgrep Assistant, `/security-review`. | 위 출처의 요약 |

### 1.7 머지 뒤 검증

| 관행 | 증거 | 출처 · 날짜 |
|---|---|---|
| 머지하고 main에서 검증, 빨강이면 revert | 머지하고 머지된 main에서 전체 시험을 돌려 빨강이면 자동 revert 뒤 멈추고 작성자에게 알리는 에이전트 흐름. | GitHub 저장소 둘의 이슈·PR, 2026(일화) |
| 왜 필요한가 | 초록 PR 둘이 낡은 base에서 시험을 돌려 빨간 main으로 머지될 수 있다. "빨간 main이 아무에게도 알리지 않는다"는 기록된 실패다. | GitHub 이슈 2026(일화) |
| flag, canary, 자동 rollback | flag 뒤로 머지하고 오류·지연 신호로 되돌린다(Argo Rollouts, Flagger). | getautonoma.com 2026(벤더 블로그) |
| 머지 뒤 지표로서의 rework | 1.5 참고: DORA가 바로 이 까닭으로 rework rate를 더했다. | DevOps.com 2025-09-29 |

## 2. 지금 atc

### 2.1 리뷰 레인(7일)

"CLEARED에 세나"는 그 판정이 사람이나 Codex의 리뷰를 대신하는 곳이다. 모든 레인의 판정은 정확한 head에 묶인다. 판정은 PR 자체의 변경이 같을 때만 `main` 머지를 건너 이어진다.

| 레인 | 트리거 · 모델 · 읽는 것 | 판정, 저장 위치 | CLEARED에 세나 | 7일 숫자 |
|---|---|---|---|---|
| 사람의 GitHub 리뷰 | GitHub의 사람 | APPROVED / COMMENTED / CHANGES_REQUESTED, GitHub에만 | 모든 AIRPORT | AIRPORT A: 머지된 121건 중 사람의 승인 0건 [observed] |
| Codex | 자동 리뷰나 `@codex review`(update로 리뷰가 끊긴 head에 AUTOLAND가 head마다 한 번 남김). 외부, 자체 저장소 맥락 | thumbs-up = pass, COMMENTED = P0–P3 배지가 붙은 지적. GitHub에만 | Codex가 있는 모든 AIRPORT. AUTOLAND AIRPORT에서는 머지 리뷰가 대신한다 | AIRPORT A: 머지된 121건 중 30건 리뷰, 지적 리뷰 57건, 열고 나서 첫 리뷰까지 중앙값 149분, p90 5,550분(n=30) [observed] |
| REVIEW 착륙 리뷰 | Codex를 쓸 수 없을 때(한도 안내, 6시간 침묵, 30분 뒤 넘김). Claude Sonnet의 REVIEW 세션. 패킷을 읽는다: 제목, 본문, FLIGHT 수락 기준, 바뀐 파일, 80,000자로 자른 diff. 소스는 읽지 않는다 | pass / findings와 P0–P2 개수, `landing-reviews.jsonl` | Codex를 쓸 수 없을 때의 모든 AIRPORT(PR이 제외되지 않았다면) | 7일에 89건: Sonnet 66, 옛 DeepSeek 계열 23 [observed]. CROSSCHECK 13건까지 102건, PR 65건(AIRPORT A 98, ATCC 4). pass 83, findings 19(P0 0, P1 23, P2 43). 102건 중 75건에 `security` 표시. PR 65건 중 23건(35%)은 둘째 head를 다시 리뷰(head 2개 14, 3개 6, 4개 2, 6개 1) [observed] |
| CROSSCHECK(Muse 계열) | 벤더를 가로지르는 세션 | 같은 형식 | 2026-09-29 결정 뒤 기록만 하고 세지 않음 | 13건, pass 12, findings 1 [observed] |
| AUTOLAND 머지 리뷰(ATC-328) | AUTOLAND AIRPORT의 열린 Draft 아닌 PR에 같은 REVIEW 세션. Codex 상태는 상관없음 | 같은 형식, `autoland-reviews.jsonl`과 `autoland.jsonl`의 `merge-review` 줄 | AUTOLAND AIRPORT에서 Codex와 REVIEW 착륙 리뷰를 대신한다. 머지 직전에 다시 확인 | pass 3건, 모두 `reviewedSecurity: delegate`를 켠 뒤(16:25Z) [observed] |
| MCC INSPECTION(ATCC) | MCC `/tick`이 5분마다, head에 INSPECTION이 없는 PR을 한 번에 3건까지. Opus sub-agent. 본문, 파일, diff, 등급 사유, 이슈 목표, atc 코드를 읽는다 | pass / findings P0–P2와 ESCALATE, `mcc.jsonl` | ATCC만 | PR 185건에 INSPECTION 210건: pass 193, findings 17(8.1%). ESCALATE 28줄(PR 27건). MCC가 134건 착륙(`auto` 95, `flagged` 41), 착륙 실패 2건. 열고 나서 첫 INSPECTION까지 중앙값 4분(p90 8), INSPECTION에서 착륙까지 중앙값 0분(p90 6) [observed] |
| HUMAN CHECK | `## UI change` 종류가 CHOICE, ACCOUNT, DEVICE. SUPERVISOR가 PASS나 FAIL을 누른다 | PR 본문의 `Human check:` 줄, `human-checks.jsonl` | CLEARED에는 안 들어가고 AUTOLAND 머지만 막는다 | 1건(pass) [observed] |

### 2.2 게이트(7일)

"오탐 대리 지표"에는 게이트가 붙잡은 PR 중 SUPERVISOR가 변경 없이 머지한 수가 필요하다. atc는 붙잡힌 PR의 제외 사유를 기록하지 않으므로(AUTOLAND 줄 참고), 대리 지표를 아래 replay와 관측된 사실 하나로 갈음한다: **7일간 AIRPORT A에서 머지 없이 닫힌 PR은 없다**(머지 121건, 머지 없이 닫힘 0건). 그래서 게이트가 걸린 PR은 모두 머지로 끝났고 게이트는 걸러 낸 PR이 아니라 시간을 썼다 [observed]. 그 뒤의 revert: 7일간 AIRPORT A와 ATCC에서 제목에 revert나 hotfix가 들어 머지된 PR은 없다 [observed, 대리 지표]. LOGBOOK의 `reverted`는 쓸 때가 아니라 읽을 때 정해지므로 파일에서는 셀 수 없다.

| 게이트 | 무엇이 걸고 누가 정하나 | 7일 숫자 |
|---|---|---|
| 착륙 막힘: `stacked`, `draft`, `checks-*`, `no-review`, `review-stale`, `review-findings`, `changes-requested`, `behind`, `dirty`, `blocked`, `merge-unknown`, `los` | `landingBlocks`. 팀이나 SUPERVISOR | 막힘별 로그는 없다. AUTOLAND update 뒤 24건이 blocked로 settle: `blocked` 10, `no-review` 9, `review-stale` 5, `behind` 3, `checks-failed` 1(PR 하나에 둘이 붙을 수 있다) [observed]. 코드 28개 중 적어도 14개가 리뷰 모양 |
| 보안 게이트(`externalGateOf`): `rating:SEC`, Risk 라벨, 보안 경로, 키워드. 딱딱한 쪽: FLIGHT 없음, 비밀 경로 | PR이 외부 리뷰 레인에서 빠지고, merge 모드에서는 `reviewedSecurity`가 `delegate`이고 이 head에 머지 리뷰가 통과하지 않았다면 SUPERVISOR에게 간다 | 리뷰 기록 102건 중 75건에 `security` 표시 [observed]. 머지된 121건에 replay [replay, 하한: 티켓 라벨과 FLIGHT 글은 없음]: 어느 규칙이든 95건(79%), 보안 경로 44건(36%: auth 18, migrations 14, SQL 5, functions 3, admission 2, session 1, RLS 1), 키워드 94건(78%: `auth` 43, `EXECUTE` 15, `security` 11, `admission` 7, 그 밖 18), **키워드만 51건(42%)**, 비밀 경로 0, PR의 Risk 라벨 0, migration·SQL 경로 19건(16%) |
| AUTOLAND `mergeExclusionOf`(HOLD, FLIGHT 없음, `rating:SEC`, Risk 라벨, 못 읽는 파일이나 100개 이상, 비밀 경로, 위임 중의 migration, HUMAN CHECK) | SUPERVISOR가 머지한다. "SUPERVISOR 머지 — 사유"가 붙는다 | 7일간 `skip` 줄 0건, HOLD 2줄. ~17:05Z 라이브 계획은 PR 4건을 표시(위임 머지 대상 1, 제외 3), 몇 분 뒤 GitHub에는 열린 PR 5건(Draft 2) [observed]. 제외는 그때그때 계산하고 기록하지 않는다 |
| `reviewedSecurity` 스위치 | SUPERVISOR, 설정 창 | 전환 1줄: delegate, 2026-10-01 16:25Z [observed] |
| strict up-to-date와 update 대기열(AUTOLAND, AIRPORT마다 한 PR만 비행 중, SUPERVISOR에게 남겨진 CLEARED PR은 대기열을 15분 붙잡음, ATC-331) | `behindOnly` PR에 update-branch | update 53번(09-28에 6, 10-01에 47), settle: CLEARED 27, blocked 24, closed 2 [observed]. update 53번에서 AUTOLAND 머지는 4건이고 나머지 CLEARED PR은 손으로 머지됐다 [observed] |
| 재리뷰 요청 | update로 head에 리뷰가 없어졌을 때 | 13건, 전부 10-01: REVIEW 11, Codex 2 [observed] |
| GROUND STOP(AUTOLAND, ATC-330이 워크플로 이름도 맞게 한다) | `applicationCheck`가 `main` head에서 실패. SUPERVISOR가 푼다 | `groundstop` 줄 0. AIRPORT A `main` push 실행: head 118개 중 2개가 빨강(1.7%), 각각 head 하나 [observed] |
| LANDING 등급(`auto`, `flagged`, `user`)과 MCC L1–L8(ATCC) | 바뀐 경로. `user`는 SUPERVISOR에게 | 착륙: `auto` 95, `flagged` 41. ESCALATE 28줄(PR 27건, `user` 종류와 형식 변경) [observed] |
| HUMAN CHECK 종류 | UI 영향이 `none`이 아닌 CHOICE, ACCOUNT, DEVICE | PASS 1건 [observed] |

### 2.3 지연

| 구간 | AIRPORT A | ATCC |
|---|---|---|
| PR 연 때부터 머지까지 | 중앙값 150분, p90 2,706분(n=121). LOGBOOK 착륙 대기는 141, 2,666(n=99) [observed] | 중앙값 5분, p90 28(LOGBOOK n=356) [observed] |
| PR 연 때부터 첫 리뷰까지 | Codex 첫 리뷰 중앙값 149분, p90 5,550(n=30). REVIEW 기록은 로그에서 연 시각과 이어지지 않는다 | 첫 INSPECTION까지 중앙값 4분, p90 8 |
| 리뷰에서 CLEARED까지, CLEARED에서 머지까지 | 로그로는 가를 수 없다(CLEARED 시각을 기록하지 않는다). update 대기열과 SUPERVISOR의 클릭이 여기 있다 | INSPECTION에서 착륙까지 중앙값 0분, p90 6 |
| PR 크기(추가 + 삭제 줄) | 중앙값 403, p90 1,892 [observed]. 절반이 바깥 출처가 사람 리뷰가 나빠진다고 말하는 선(약 400)을 넘고 elite 배치 크기(150–200 미만)보다 훨씬 크다 | 해당 없음 |

### 2.4 레인 사이의 일치

**7일간 두 계열의 레인이 같이 리뷰한 head는 없다**(102 head 중 계열이 둘 이상인 것 0), 그래서 Codex와 REVIEW, 또는 MCC INSPECTION과 Codex의 일치는 계산할 수 없다 [observed]. 레인은 설계상 번갈아 쓰이고(REVIEW는 Codex를 쓸 수 없을 때만 돈다) 겹치지 않는다. 한 레인 안에서도 같은 head를 두 번 리뷰한 경우는 0건이다. 첫 리뷰가 findings였던 PR 9건 중 1건만 새 head에서 pass가 났고, 나머지는 그 기간에 다시 리뷰받지 않았거나 머지되지 않았다 [observed].

### 2.5 숫자가 말하는 것

1. AIRPORT A의 머지 길은 처리량 문제다: 하루 ≈17건이 들어오고, 오늘까지 거의 전부 손으로 머지됐다. AUTOLAND merge 모드는 09-28부터 켜져 있었지만 `reviewedSecurity`가 꺼져 있어 보안 게이트가 대부분의 PR을 붙잡았다 [손 머지는 observed, 원인은 replay에서 *assumed*].
2. strict 규칙은 지금 잴 수 있는 가장 큰 남은 비용이다: update 53번 중 24번이 blocked로 끝났고 막힘 코드의 적어도 절반이 리뷰 모양이다. 즉 update 자체가 리뷰 한 번의 값을 치렀다. strict일 때 `main`은 head의 1.7%에서 빨강이었다.
3. 보안 게이트는 비싸 보이지만(79%, 키워드만 42%) `delegate`가 켜지고 head에 묶인 머지 리뷰가 통과하면 결정적 규칙만 PR을 붙잡는다. migration·SQL 규칙은 16%에 걸린다. 위임 뒤에도 SUPERVISOR에게 오는 PR 수는 기록되지 않으므로 가장 먼저 기록해야 한다.
4. 리뷰 용량: Codex는 PR의 4분의 1을 봤고, REVIEW(Sonnet)가 이제 짐을 진다. 리뷰한 PR의 35%는 둘째 리뷰가 필요하다.
5. ATCC는 등급을 붙인 모델 전용 레인이 분 단위 지연과 8%의 findings 비율로 돈다는 것을 보여 준다. AIRPORT A의 결함률에 대한 증거는 아니다.
6. 오늘 결함률은 없다: revert 0, 닫힌 PR 0, 빨간 head 2. 안전의 증거가 아니라 지켜볼 기준선이다.

## 3. 선택지

기준: 빠져나가는 결함, 지연, SUPERVISOR 분(分), 토큰이나 돈, atc에서 바뀌는 것, 등급, shadow로 먼저 가능한가. 숫자를 인용하지 않은 "결함"과 "분"은 *[assumed]*다.

| # | 선택지 | 빠져나가는 결함 | 지연 · SUPERVISOR 분 | 비용 | atc에서 바뀌는 것 · 등급 | shadow 먼저 | 판단 |
|---|---|---|---|---|---|---|---|
| 1 | 현상 유지에 ATC-330, ATC-331 | 그대로, GROUND STOP이 이제 워크플로 이름에도 걸린다 | ATC-331이 대기열 정체를 푼다. strict update 순환(update, 새 head, 리뷰)은 남는다 | 없음 | 이미 만들어짐 · 해당 없음 | 해당 없음 | 바탕으로 유지, 혼자서는 부족 |
| 2 | 키워드 게이트를 리뷰어가 diff를 보고 내리는 보안 판단으로 교체 | 키워드가 우연히 잡던 PR에서는 조금 오른다. 결정적 규칙(비밀 경로, migration, Risk 라벨, FLIGHT 없음)은 남는다. 바깥: LLM 맥락 확인이 secret scanning 오탐을 75.76% 줄였다 | 키워드만 PR의 42%에 걸린다. 위임이 통과한 head에서는 이미 가려지므로 이득은 불필요한 지적이 줄고 `security` 표시가 깨끗해지는 것 | 기존 리뷰에 필드 하나 | 리뷰 매뉴얼과 패킷, `landing-review.ts`, 규칙 제거는 나중에 `landing.ts` · `flagged`, 최종 제거는 `user` | 가능: 모든 head에 리뷰어 표시를 키워드 옆에 기록 | **채택, 둘째 걸음** |
| 3 | 독립 모델 리뷰 둘, 보안 게이트 PR은 일치를 요구 | 오류가 독립일 때만 줄어든다. 독립이 아니다(같은 오답 60%, ICML 2025, 같은 벤더는 더 심함) | 레인과 대기가 늘고 불일치는 사람에게 간다 | 리뷰 토큰 약 2배, 바깥 규모는 Cloudflare 평균 $1.19 | 새 레인과 일치 규칙 · `flagged` | 가능 | **PR마다 요구하는 규칙으로는 기각, 10% 감사 표본으로 채택**(W6) |
| 4 | 변경을 돌려 보는 검증 레인(시험, smoke 흐름, Preview) | 실행 때만 나타나는 실패는 줄어든다. CI가 이미 시험을 돌리므로 새로운 것은 smoke와 Preview 증거 | PR마다 몇 분 늘어남 | 컴퓨팅과 모델 | 새 레인과 증거 패킷 · `flagged` | 가능 | **나중에**, W5가 어떤 결함이 빠져나가는지 보여 준 뒤 |
| 5a | "Require up to date"를 끄고 필수 CI 체크는 두고, 머지 뒤 main 체크와 GROUND STOP | 의미 충돌이 `main`에 닿을 수 있다. strict일 때 빨강 head 1.7%가 기준선. GROUND STOP이 이제 빨강에서 AUTOLAND를 멈춘다 | update 단계가 사라진다: head가 안 바뀌고 `review-stale`이 없고 직렬 대기열도 없다. 가장 큰 절감을 기대하는 곳 | 없음 | 저장소 설정(SUPERVISOR), CLEARED PR을 바로 머지하게 하는 작은 atc 변경 · 설정은 해당 없음 | 일부: 전후의 주간 숫자를 비교, 한 번 클릭으로 되돌림 | **채택, 첫 걸음** |
| 5b | GitHub merge queue | 의미 충돌에 가장 낮음 | 물량이 많을 때 좋다 | Enterprise Cloud 조직이 필요 | 오늘은 불가능 | 해당 없음 | **기각**(개인 소유 비공개 저장소에서는 쓸 수 없다. 원문 가용성 문장은 *unverified*) |
| 5c | 제3자 queue(Mergify, Graphite, Aviator) | 5b와 같음 | 5b와 같음 | Mergify는 기여자 5명까지 무료, 나머지는 사용자당 $20–40 | 저장소에 새 앱 | 해당 없음 | **지금은 기각**: 개인 저장소 지원은 *unverified*이고 새 앱은 SUPERVISOR 결정 |
| 5d | Stacked PR | 중립 | 의존하는 PR에만 도움 | 없음 | AIRCRAFT 작업 흐름 변경, GitHub 기능은 공개 미리보기 | 불가 | **지금은 기각**: 미리보기, 같은 저장소만 |
| 6 | FLIGHT를 작게, AIRPORT마다 WIP 한도 | 줄어든다(사람 리뷰는 약 400줄을 넘으면 나빠지고 PR 중앙값은 403줄) | 거대 PR이 줄어 p90이 내려간다 | 없음 | FLIGHT PLAN의 크기 힌트, DISPATCH의 WIP 상한 · `flagged` | 가능: 크기와 WIP만 기록 | **채택, 싸다, 나중에**(W7) |
| 7 | 판정을 `main` 머지를 건너 더 넓게 잇기 | `main`이 같은 파일을 건드렸는데 재리뷰가 없으면 조금 오른다 | update가 만든 재리뷰를 없앤다 | 없음 | `carriedReviewOf` 규칙 · `flagged` | 가능 | **5a가 흡수**(update가 없으면 이을 것도 없다). ATC-31은 그대로 |
| 8 | 표본 감사: 머지된 head 중 무작위 10%를 머지 뒤에 다른 벤더 리뷰어가 다시 리뷰 | 게이트가 아니라 빠져나가는 결함의 측정이다 | PR에는 없음 | PR당 리뷰 한 번의 약 10% | 기록을 쓰는 새 shadow 레인 · `flagged` | 본래 shadow | **첫 걸음과 함께 채택**(W6) |
| 9 | 관리형 AI 리뷰어 구입 | 모름 | 셋째 레인이 생김 | 관리형 Claude 리뷰는 Team/Enterprise만이고 리뷰당 $15–25: 하루 17건이면 하루 약 $260–430. Copilot·Bugbot·관리형 Claude 체크는 neutral이라 아무것도 막지 못한다. CodeRabbit 비공개 저장소는 유료 | 새 앱, 새 비밀 표면 | 불가 | **기각** |

**실험.** 하지 않았다("어떻게 만들었나" 참고). W8이 설명한다.

## 4. 권고

**첫 걸음: AIRPORT A `main`의 "Require branches to be up to date"를 끄고(필수 CI 체크는 둔다), PR이 CLEARED가 되고 제외되지 않으면 즉시 AUTOLAND가 머지하게 한다.**

- *왜 이것이 먼저인가.* 가장 큰 절감인 위임은 오늘 이뤄졌다(보안 게이트가 건드리던 PR 약 79%를 머지 리뷰가 통과하면 SUPERVISOR에게서 AUTOLAND로 옮긴다). 그래서 다음 질문은 무엇이 아직 AUTOLAND를 막느냐다. 모든 PR에서 잴 수 있는 남은 비용은 update 순환이다: update-branch, 새 head, update가 없앨 수 있는 리뷰(update 53번 중 24번이 blocked, 코드 28개 중 적어도 14개가 리뷰 모양), 거기에 CI 한 번 더. strict 규칙을 끄는 데는 새 코드가 필요 없고 모든 PR에서 그 순환이 사라진다. 키워드 게이트는 통과한 머지 리뷰가 있는 head를 더는 붙잡지 않으므로 그것을 먼저 푸는 것은 얻는 게 적다. *[assumed]* 효과: REVIEW 레인이 한가할 때 더 많은 PR이 CLEARED에 이르러 AUTOLAND가 더 많이 머지한다. W1이 대신 리뷰 용량이 다음 한계인지 재고, 일주일 안에 AUTOLAND 비율이 오르지 않으면 둘째 걸음은 게이트가 아니라 용량(둘째 REVIEW 레인, 또는 Codex를 병렬 레인으로)이다.
- *위험을 묶는 것.* 필수 CI 체크는 남는다. 머지 뒤 main 체크와 AUTOLAND GROUND STOP이 빨간 head에서 update와 머지를 멈춘다(ATC-330이 워크플로 이름에도 걸리게 하고, 설정한 이름이 아무것에도 안 맞으면 경고한다). 결정적 규칙은 비밀 경로, migration, Risk 라벨, FLIGHT 없음, HUMAN CHECK 종류를 계속 SUPERVISOR에게 보낸다. 설정은 한 번 클릭으로 되돌린다.
- *한 곳에서 매주 볼 것*(W5): (1) 머지 100건당 빨간 `main` head 수(기준선 1.7), (2) AUTOLAND 머지 뒤 72시간 안의 revert나 hotfix PR(기준선 0), (3) 이미 머지된 코드에 뒤늦은 리뷰가 올리는 지적, (4) 머지된 head의 10%를 다른 벤더 리뷰어가 감사한 표본: 감사한 head당 P0·P1 지적 수, (5) AIRPORT A 머지 중 AUTOLAND 비율과 열고 머지까지의 중앙값(기준선 150분, AUTOLAND 약 3%, 121건 중 4건).
- *미리 정한 되돌림 조건:* 머지 50건 중 빨간 head가 3개를 넘거나(기준선의 약 3배), 한 주에 revert가 2건이거나, 감사에서 P0가 나오면 strict 규칙을 되살린다. 빨간 head는 어떤 경우든 GROUND STOP을 건다.
- *다음에 풀거나 바꿀 게이트:* 키워드 규칙, 먼저 shadow로: 2주 동안 리뷰어의 diff 판단을 키워드·경로 규칙 옆에 기록하고, 리뷰어의 표시가 경로·라벨 규칙이 잡는 PR 전부에 더해 사람이 원했을 것까지 잡을 때만 키워드를 없앤다. 비밀·migration·Risk 라벨·FLIGHT 없음 규칙은 결정적으로 둔다(통하는 바깥 관행은 고정 경로 위의 분류기이지 그것을 대신하는 분류기가 아니다).
- *SUPERVISOR가 정할 것:* (1) 저장소 설정을 끌지 둘지, (2) 위 되돌림 조건이 맞는지, (3) 호스팅 DB에 이미 migration이 있을 때 migration·SQL PR을 자동 머지해도 되는지(ATC-329가 이미 답할 수 있다), (4) 감사 표본의 비용, (5) AIRPORT A에서 Codex를 첫 레인으로 둘 것인지(25%만 봤다).

## 5. 후속 작업 지시서

Linear에는 만들지 않았다. DUTY나 ENGINEERING이 만든다.

| # | 제목 | 범위 | 예상 등급 |
|---|---|---|---|
| W1 | AUTOLAND 제외를 주기마다 기록 | CLEARED PR마다 head별 제외 사유를 `skip` 줄로(머지를 시도할 때만이 아니라) 쓰고 하루 개수를 낸다. 위임 뒤에도 SUPERVISOR에게 무엇이 오는지 보인다 | `flagged`(`autoland-run.ts`) |
| W2 | strict up-to-date가 꺼졌을 때 CLEARED PR을 즉시 머지 | `autoland.json`에서 그 AIRPORT를 non-strict로 표시하면 AUTOLAND의 머지 패스가 `behind` 해소를 요구하지 않는다(선택 필드, 기본은 오늘과 같다). 저장소 설정은 SUPERVISOR가 끈다 | `autoland.json` 형식이 바뀌면 `user`, 아니면 `flagged` |
| W3 | 리뷰어 쪽 보안 판단, shadow | 머지 리뷰 판정에 이유가 붙은 선택 필드 `securityBoundary: yes/no`. 키워드·경로·라벨 결과 옆에 기록하고 아직 어떤 게이트도 쓰지 않는다 | `flagged` |
| W4 | 보안 키워드 퇴역 | W3의 2주 뒤 `externalGateOf`에서 `SECURITY_WORDS`를 뺀다. 다른 규칙은 둔다 | `user`(ATC-27 게이트를 푼다) |
| W5 | 빠져나간 결함 화면 | 빨간 `main` head, revert·hotfix PR, 뒤늦은 지적, 감사 지적을 GitHub와 로그에서 주마다 센다. METRICS에 보인다. LOGBOOK `reverted` 쓰기를 고친다 | `auto` 또는 `flagged` |
| W6 | 감사 표본 레인 | 다른 벤더 리뷰어가 자동 머지된 head 중 무작위 10%를 머지 뒤에 다시 리뷰한다. 기록을 쓰고 PR에 댓글은 달지 않는다. 빠져 있던 일치 숫자도 준다 | `flagged` |
| W7 | 크기 힌트와 WIP 한도 | FLIGHT PLAN이 변경 약 400줄 넘으면 쪼개기를 권한다. DISPATCH가 AIRPORT마다 열린 Draft 아닌 PR 수에 상한을 둔다 | `flagged` |
| W8 | replay 실험 | 임시 폴더에서 머지된 AIRPORT PR 10–20건을 머지된 head 그대로 후보 리뷰어 하나나 둘, 분류기 프롬프트에 돌린다. 레인과 나중의 revert와 비교하고 작은 표본임을 밝힌다. 지출은 작게 | `auto`(문서만) |
| W9 | 검증 레인 연구 | W5의 자료로 smoke나 Preview 증거가 빠져나간 결함을 잡았을지 정한다 | `auto`(문서) |

## 6. 한계와 확인하지 못한 것

- 웹 사실은 2026-10-01에 sub-agent가 가져온 것이고 내가 다시 가져오지 않았다. 벤더 쪽 다수는 날짜가 없어 표시했다. 원문을 찾지 못한 것: Stripe 수치, DORA 2025 PDF(요약만), GitHub merge queue 가용성 문단(문서를 인용한 커뮤니티 토론에서), Mergify·Graphite·Aviator queue의 개인 저장소 지원, Codex를 필수 체크로 쓸 수 있는지.
- 벤더가 보고한 숫자(Anthropic의 "1% 미만 오류", Augment 벤치마크, Graphite 수용률, Semgrep 정확도)는 vendor로 표시했다.
- 게이트 replay는 PR 라벨, 경로, 글만 쓴다. 티켓 라벨(`rating:SEC`, Risk)과 FLIGHT 글은 Linear에 있으므로 그것에 기대는 게이트의 replay는 하한이다.
- 숫자는 라이브 로그의 7일 스냅샷이다. 읽는 동안에도 머지·update·리뷰가 계속 들어왔다(읽는 중에 AUTOLAND 머지가 3에서 4로 늘었다. 4로 적는다). AIRPORT A의 AUTOLAND merge 모드가 위임과 함께 돈 것은 2026-10-01 16:25Z부터라서 위임 뒤의 동작은 몇 시간치 자료다.
- 빠져나가는 결함은 오늘 잴 수 없다: 7일 동안 revert 0, 닫힌 PR 0, 빨간 head 2다. 작은 숫자의 기준선이며 게이트가 아무것도 못 잡는다는 증거가 아니다.
