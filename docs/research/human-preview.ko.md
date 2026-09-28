# 리서치: Human Preview 다시 보기

[English](human-preview.md) · **한국어**

> 상태: [ATC-39](https://linear.app/vocado/issue/ATC-39) 리서치 보고서, 2026-09-28. 추천은 SUPERVISOR 결정이 필요하다. 이 문서는 vocado 파일, 게이트, PR 본문과 atc의 착륙 동작을 바꾸지 않는다.
> 자료: 2026-08-29부터 2026-09-28까지 만든 vocado PR 전부(#262–#405, 143건)를 읽기 전용 `gh`로 읽었고, Linear 이슈 본문과 atc LOGBOOK도 봤다. `node docs/research/human-preview-stats.mjs 2026-08-29`로 다시 셀 수 있다.

## 요약

Human Preview 게이트는 글이 많이 들고, 몇 건은 오래 기다리게 한다. 그런데 30일 동안 에이전트가 놓친 것을 이 게이트가 잡았다는 기록은 하나도 없다. 사람이 실제로 필요했던 경우는 셋이다.

- 디자인 가운데 하나를 고를 때
- 실제 계정으로 로그인해야 하는 확인
- headless 브라우저로는 알 수 없는 실기기 느낌

**추천.** 수동 게이트를 **위험 기반 증거 묶음**으로 바꾼다.

- 모든 UI PR에서 기계가 기계적인 것을 검사하고, 전후 스크린샷을 붙인다.
- 사람은 이름 붙인 세 등급(CHOICE, ACCOUNT, DEVICE)에서만 필요하다. 스크린샷을 보고 승인하고, Preview는 ACCOUNT·DEVICE일 때만 연다.
- 나머지는 머지 전 사람 확인 없이 착륙한다. 머지 뒤 staging에서 짧게 보고, 필요하면 빠르게 되돌린다.
- 네 단계로 들인다. 0단계는 도구 없이 규칙만 바꾼다.

[ATC-37](https://linear.app/vocado/issue/ATC-37)은 **바꾼다**. 세 등급만 담고 증거 묶음을 보여 주는 작은 대기열로 만들고, 긴 본문 편집 계약은 뺀다.

## 1. 지금 사실

### 1.1 게이트가 지금 요구하는 것

- vocado `.github/pull_request_template.md`의 "Human Preview Gate" 절은 **13,514자, 180줄, 70칸**이다. 템플릿 전체의 77%다.
  - 칸에는 배포 식별, probe, 3~5개 확인 동작, Human Visual Review disposition, Design QA 매트릭스, 바인딩, carry-forward 규칙 등이 있다.
  - 원본 규칙은 `docs/ai-collaboration-framework.md`("Material Web UI/UX Human Preview Gate")와 `docs/agent-output-contract.md` 3a절에 있다.
- 적용 대상은 "렌더된 Web UI/UX에 실질적 영향을 줄 수 있는" 모든 diff다. 섞였거나 애매하면 `required`로 본다.
- 사람이 자기 브라우저로 Vercel Preview(프로젝트 `vocado-staging`)를 열어 동작을 해 보고, 팀이 PR 본문의 disposition을 고친다.
- vocado에는 기계적인 시각 검사 도구가 이미 있다. 모두 에이전트가 돌리고, CI에서는 돌지 않는다.
  - `seed:preview:verify`: 미리보기 번들에 headless Playwright 검사. `verify:local`에 들어 있다.
  - `seed:visual`: 찍어 둔 기준과 비교하는 회귀 검사. "metrics" 모드(계산된 스타일, 박스, 넘침. 결정적)와 "pixels" 모드가 있다.
  - `seed:doctor`: 토큰 어긋남과 대비 계약. 이것은 CI에서 돈다.

  기준 이미지는 커밋하지 않고, 앱 화면의 기준은 사람이 찍는다.
- vocado `CLAUDE.md`(리더 규칙, 2026-09-28 변경)는 화면 확인을 `visual`·`ui-qa`에게 맡긴다. 둘 다 기본은 Linux headless Playwright이고, 필요할 때만 Mac Chrome을 쓴다.

### 1.2 최근 30일 비용

| | 수 |
|---|---|
| 만든 PR | 143(머지 119, 닫힘 19, 열림 5) |
| `.tsx`·`.css`를 건드린 PR | 74 |
| Human Preview 절이 있는 PR | 53. 본문에서 이 절이 차지하는 비율은 중앙값 20%(2,031자), 최대 7,780자(#307) |
| 한 번이라도 `required`였던 PR | 16(템플릿 칸 15, 그리고 #405는 글로 "Vercel Preview by a person (completion criterion)") |
| … 머지 없이 닫힘 | draft 5건(#279, #280, #282, #307, #308) |
| … `not required`로 내림 | 1(#351) |
| … 머지됨 | 8(#357, #358, #359, #362, #366, #373, #379, #385) |
| … 열린 채 게이트 대기 | 2(#399는 2026-09-26부터, #405는 2026-09-28부터) |

**머지된 `required` PR과 기록된 disposition:**

| PR | Ready → 머지 | 머지 때 disposition | 메모 |
|---|---|---|---|
| #359 | 0.2시간 | `approved` | SUPERVISOR, 로그인, Mac Chrome. 발견 없음 |
| #366 | 46.7시간 | `passed` | SUPERVISOR가 2026-09-27에 확인 동작 1~4를 확인. 발견 없음 |
| #385 | 30.9시간 | `pending` | |
| #373 | 1.6시간 | `pending` | |
| #358 | 0.8시간 | `pending` | |
| #357 | 0.4시간 | `pending` | |
| #362 | 0.0시간 | `pending` | "사용자가 로컬 개발 서버 확인을 제안받은 뒤 머지를 직접 허락함. 별도 Human Visual Review disposition 없음" |
| #379 | 0.0시간 | `pending` | |

- **머지된 `required` PR 8건 중 6건은 본문에 게이트가 `pending`인 채로 착륙했다.** 실제 결정은 사람의 머지였고, 게이트 기록은 그것을 따라가지 못했다.
- `required` PR이 전체적으로 더 오래 기다리지는 않았다. PR을 연 뒤 머지까지 중앙값(atc LOGBOOK)이 이 PR들은 3.1시간, 나머지 머지 PR은 5.7시간, 다른 UI PR은 4.1시간이었다. 비용은 **몇 건의 긴 대기**에 몰려 있다: #366은 46.7시간, #385는 30.9시간, #399는 이틀째 막혀 있다.
- #399는 확인 목록의 로그인 부분에서 막혔다. 앞선 리더는 로그아웃 상태로만 확인할 수 있었다. #405도 "실제 계정의 로그인 server 모드"를 사람에게 남겼다.
- #404 팀은 도구로 Preview에 닿지 못해(Vercel MCP 시간 초과) headless Chromium으로 직접 배치를 쟀다.

### 1.3 사람 확인이 잡은 것

- **30일 동안 기록된 발견은 없다.** `changes requested`를 적은 PR이 없고, 기록된 승인 두 건(#359, #366)에도 발견이 없다.
- 화면을 실제로 바꾼 사람의 결정은 **결함 발견이 아니라 선택**이었다.
  - VOC-180은 최소 해결안 셋(A, A′, B)을 Preview가 있는 draft PR로 만들어 "사용자가 직접 비교해 고른다"고 했다. A가 #383으로 들어갔고, 사용자는 그 뒤 B를 별도 이슈(VOC-192, #404)로 골랐다.
  - VOC-172와 VOC-194에는 범위와 방식을 "사용자가 President 세션을 거쳐" 정한 기록이 있다.
- 에이전트는 확인하지 못한 것을 적어 둔다. "Not verified: real devices"(#331, #334, #336), "에이전트가 Mac Safari나 실제 터치 기기로 돌리지 않음"(#378), "실기기 회전과 Safari 툴바"(#383), "Not measured: Mac Chrome and Safari, retina, and signed-in states"(#404). 사람이 실제로 메우는 빈틈이 이것이다.
- **주의.** 대화로 준 지적을 다음 push 전에 고쳤다면 PR에는 흔적이 남지 않는다. 0은 "기록 없음"이지 "일어나지 않음"이 아니다. 아래 3단계에서 잴 수 있게 한다.

## 2. 확인은 무엇을 위해 있나

| 사람만 판단할 수 있다 | 기계가 검사할 수 있다 |
|---|---|
| **취향과 브랜드**: vocado답나, 위계가 맞나, A와 B 중 무엇이 나은가(VOC-180) | **배치**: 박스, 위치, 겹침(예: 시트가 플레이어를 가림), 정해진 폭에서의 sticky·스크롤 |
| **실기기 느낌**: Safari 툴바, safe area, 터치와 스와이프, 회전, 레티나, 실제 iframe(YouTube) 동작 | **넘침과 줄바꿈**: 가로 스크롤, 잘린 글, 200% 글자, 긴 한국어 단어 |
| **실제 계정의 로그인·계정 흐름**: OAuth 콜백, 로그아웃, server 모드 데이터(#399, #405) | **대비와 토큰**: 대비 계약과 토큰 어긋남(`seed:doctor`, 이미 CI에서 돔) |
| 맥락 속 **문구 톤**, 빈 상태·오류 상태가 자연스러운가 | **회귀**: main 대비 계산 스타일·박스 metrics(`seed:visual` metrics 모드), 안정적인 곳은 픽셀 diff |
| | **상태**: hover, focus-visible, pressed 스타일, 다크·라이트, reduced motion |

왼쪽은 작고, 미리 알아볼 수 있다. PR이 사람이 골라야 할 것을 바꾸거나, 로그인 흐름을 건드리거나, 기기 느낌에 달렸거나다. UI PR 대부분은 오른쪽에 있고, vocado에는 그 도구가 거의 다 있다.

## 3. 선택지

| 선택지 | 대체하는 것 | 필요한 것 | 위험 | 비용 |
|---|---|---|---|---|
| **A. main 대비 시각 회귀·스크린샷 diff** | 사람이 배치 회귀를 찾는 일 | 미리보기 번들에 대해 main 기준으로 `seed:visual` metrics 모드를 CI에서. 앱 화면은 안정적인 fixture 서버가 필요 | fixture만으로는 실제 데이터와 인증을 못 봄. pixels 모드는 Song 화면에서 흔들림(2026-09-18 기록) | 낮음~중간: CI 시간과 기준 관리. GitHub Actions면 새 서비스 없음 |
| **A′. 외부 시각 리뷰(Chromatic, Percy, Argos)** | A와 같고 리뷰 화면이 붙음 | 유료 요금제, 스크린샷을 외부로 올림 | 데이터 반출, 벤더 종속 | **SUPERVISOR 결정**(유료, 반출). 추천에는 필요 없음 |
| **B. 에이전트 visual QA를 게이트로, 위험 등급별 사람 표본 확인** | 모든 `required` PR의 사람 확인 | `ui-qa`·`visual`이 정해진 증거(폭, 테마, 상태)와 완료 기준 대비 통과·실패를 만든다 | 에이전트는 취향과 기기 느낌을 놓침. 아래 등급으로 막는다 | 낮음: 이미 하는 일을 곁가지가 아니라 게이트로 |
| **C. 증거 묶음을 PR이나 atc에 붙이고 사람은 이미지로 승인** | 대부분의 경우 Preview를 직접 모는 일 | 건드린 경로의 전후 스크린샷(375, 768, 1280 × 라이트·다크)과 움직임은 짧은 영상. PR에 올리거나 atc에서 보여 줌 | 스크린샷은 상호작용 버그를 숨길 수 있음. ACCOUNT·DEVICE는 Preview 링크를 유지 | 낮음: vocado에 Playwright가 이미 고정돼 있음 |
| **D. 머지 뒤 staging 확인과 빠른 revert** | 위험 낮은 UI의 머지 전 사람 대기 | 정해진 시점(하루 한 번이나 다음 세션)의 staging 확인과 되돌리는 습관(atc LOGBOOK이 이미 되돌림을 적음) | 나쁜 변경이 볼 때까지 staging에 남음. 운영 노출·인증 변경에는 맞지 않음 | 매우 낮음 |
| **E. 사람이 필요한 경우를 정하는 위험 기반 규칙** | "실질적 UI 변경은 모두 `required`" | PR 템플릿과 에이전트 규칙에 적은 세 등급 | 등급을 잘못 붙이면 사람을 건너뜀. D와 리뷰어의 등급 추가로 막는다 | 없음 |
| **F. 게이트는 두고 편하게(ATC-37 그대로)** | Vercel 찾기와 본문 편집 | atc 대기열, head별 Preview 링크, 원클릭 통과 | 70칸 계약과 실질적 UI PR마다 사람이 그대로 남음 | 중간: atc 작업, 과정 비용은 그대로 |

## 4. 추천: 위험 기반 증거 묶음(E + B + C, 뒤에 A와 D)

**규칙.** 모든 UI PR은 기계가 만든 증거 묶음을 단다. 사람은 PR이 세 등급 중 하나일 때만 필요하다.

- **CHOICE**: 새 화면이나 시각 방향, 브랜드·문구 톤 변경, 대안 가운데 고르기. 증거 묶음을 보고 승인한다.
- **ACCOUNT**: 로그인, OAuth, 로그아웃, 실제 계정 데이터 흐름을 건드린다. Preview를 열어 적힌 단계를 해 본다.
- **DEVICE**: 터치, Safari 크롬, safe area, 회전, 실제 iframe에 달렸다. 휴대폰이나 Mac Safari로 본다.

나머지는 검사 통과와 에이전트 QA 게이트로 착륙하고, 머지 뒤 staging에서 짧게 보고, 필요하면 되돌린다.

지난 30일과 맞는다. #399와 #405는 ACCOUNT, VOC-180은 CHOICE이고, #378·#383·#404가 DEVICE 빈틈을 적었다. #357, #358, #373, #379는 사람이 필요 없었을 것이고, 실제로도 게이트가 `pending`인 채 머지됐다.

### 단계별 도입

| 단계 | 바뀌는 것 | 도구 | 끝 조건 |
|---|---|---|---|
| **0. 규칙**(지금) | 70칸 절을 짧은 "UI change" 칸(아래)으로 바꾼다. 누가 볼지는 등급이 정한다. disposition은 등급이 있을 때만 적는다 | 없음 | 한 주 동안 UI PR에 칸이 사실대로 채워지고, 등급 있는 PR이 `pending`으로 머지되지 않음 |
| **1. 증거 묶음** | `visual`·`ui-qa`가 건드린 경로를 main(전)과 PR head(후)에서 375, 768, 1280 × 라이트·다크로 찍고, 움직임은 GIF로 찍어 PR 댓글로 올린다(이미지를 커밋할 필요 없음) | vocado Playwright(이미 고정) | 모든 UI PR에 묶음이 있고, CHOICE는 Preview를 열지 않고 묶음으로 승인 |
| **2. CI 회귀** | 같은 job에서 main으로 만든 기준에 대해 미리보기 번들의 `seed:visual` metrics 모드를 CI에서 돌린다. pixels 모드는 로컬에 둔다 | GitHub Actions만 | metrics 회귀가 CI를 실패시키고, 흔들림 비율을 적음 |
| **3. 재기** | atc가 UI PR마다 등급, 사람이 봤는지, 얼마나 기다렸는지, 무엇을 찾았는지, 7일 안 되돌림을 적는다. LOGBOOK `measured` 방식(ATC-32/33)을 그대로 쓴다 | atc | 30일 뒤 이 보고서의 기준선과 발견·되돌림을 비교해 등급을 고침 |

유료 시각 리뷰 서비스(A′)와 Vercel share 토큰이나 보호 우회로 Preview에 자동으로 닿는 방식은 **SUPERVISOR 결정**이다. 추천에는 둘 다 필요 없다.

### vocado에 제안하는 문구(여기서 고치지 않음)

**`.github/pull_request_template.md`**: "Human Preview Gate" 절 전체를 이것으로 바꾼다.

```markdown
## UI change

- UI impact: `none` / `changes rendered UI`
- Human check class (any that apply): `CHOICE` (new screen, visual direction, brand or copy tone, pick between options) / `ACCOUNT` (signed-in, OAuth, logout, real-account data) / `DEVICE` (touch, Safari chrome, safe areas, rotation, real iframe) / `none`
- Evidence pack: link to the PR comment with before/after screenshots (375 / 768 / 1280, light and dark) and agent QA result
- Preview (ACCOUNT or DEVICE only): exact URL for the current head
- Human steps (ACCOUNT or DEVICE only): 1–3 steps with the expected result
- Human check: `not needed` / `pending` / `done <date> <head sha> <what was seen>`
```

**`docs/ai-collaboration-framework.md`**: "Material Web UI/UX Human Preview Gate"를 이것으로 바꾼다(vocado 문서가 영어라 영어로 둔다).

> Every PR that changes rendered UI carries an evidence pack made by agent visual QA: before/after screenshots of the touched routes at 375, 768 and 1280 px in light and dark, with a pass/fail against the task's done criteria. A person is required only for the classes CHOICE, ACCOUNT and DEVICE. For CHOICE the person approves from the evidence pack; for ACCOUNT and DEVICE the person opens the exact-head Preview and runs the listed steps. A human check binds to the head SHA; a later commit that changes rendered UI needs a new check, a main-only merge does not. Other UI PRs land on checks and agent QA, and get a short look on staging after merge, with a revert if needed.

**`AGENTS.md`**, 전달 규칙 아래 한 줄:

> For rendered-UI changes, attach the evidence pack and set the human check class. Do not wait for a person unless the class is CHOICE, ACCOUNT or DEVICE.

**`CLAUDE.md`**(리더 규칙), visual·ui-qa 규칙 옆에 한 줄:

> visual이나 ui-qa는 Ready 전에 모든 UI PR의 증거 묶음을 만든다. 리더가 사람 확인 등급을 정하고, ACCOUNT·DEVICE면 사람이 할 단계 1~3개를 적으며, 그것이 끝나기 전에는 머지하지 않는다.

### ATC-37: 바꾼다

쓸모 있는 핵심은 남긴다. 사람을 기다리는 것을 한곳에서 보고, head에 묶인 결과를 한 번에 남기는 것이다. 나머지는 줄인다.

- **대기열**: 등급이 CHOICE, ACCOUNT, DEVICE이고, 지금 head에 대한 사람 확인이 `done`이 아닌 열린 PR만. `required` PR 전부가 아니다.
- **한 줄**: PR, FLIGHT, 팀, 등급, 증거 묶음(PR 댓글의 썸네일), ACCOUNT·DEVICE면 Preview URL. 70칸을 파싱하지 않는다.
- **통과·실패**: 원안대로(head에 묶고, ATC-31 규칙대로 main만 병합한 경우 이어짐) PR 댓글과 `Human check:` 한 줄을 쓴다.
- **착륙**: `human-preview` 막힘은 등급 있는 PR에만.
- 새 칸을 파싱하므로 0단계가 채택된 뒤에 만든다.

## 5. 위험

- **잘못 붙인 등급.** ACCOUNT여야 할 PR이 `none`이 될 수 있다. 막는 방법:
  - 리뷰어(Codex나 DeepSeek)와 CROSSCHECK가 등급을 더할 수 있다.
  - auth·middleware·proxy·OAuth 경로를 바꾸면 파일 경로로 ACCOUNT를 붙인다.
  - 3단계가 되돌림을 잰다.
- **멀쩡해 보이지만 상호작용 버그를 숨긴 증거 묶음.** 움직임 GIF와 에이전트의 상호작용 검사가 일부를 막고, 나머지는 DEVICE가 맡는다.
- **안 하게 되는 staging 확인.** 3단계가 머지 뒤 확인을 했는지 적고, atc가 아직 안 본 UI 머지를 보여 줄 수 있다.
- **사람 판단 기록이 줄어듦.** 지금 기록도 대부분 `pending`이다. 새 기록은 짧고 사실대로다.

## 6. SUPERVISOR 결정

1. 위험 기반 증거 묶음과 0단계 문구를 채택할지(아니면 게이트를 두고 ATC-37을 원안대로 만들지).
2. 등급 없는 UI PR에 머지 뒤 staging 확인과 빠른 revert를 받아들일지.
3. 유료 시각 리뷰 서비스나 Preview 자동 접근(share 토큰, 보호 우회)을 허용할지. 추천에는 둘 다 필요 없다.
