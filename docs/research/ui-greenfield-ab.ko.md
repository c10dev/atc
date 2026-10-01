# 빈 프로젝트에서 "화면 만들어줘": 그린필드 A/B (ATC-309)

[English](ui-greenfield-ab.md) · **한국어**

상태: SURVEY 결과, 2026-10-01. 글만 있다. 스크린샷은 SUPERVISOR의 블라인드 비교용으로 이 호스트에만 있고 저장소·PR·이슈에는 없다(atc는 공개 저장소). [ATC-296](https://linear.app/vocado/issue/ATC-296)은 저장소 안 비교이고 그대로다.

## 1. 질문과 짧은 답

SUPERVISOR의 질문: *아무것도 없는 상태에서 "○○ 화면 만들어줘"라고 하면, UI skill이 있을 때와 없을 때 결과가 얼마나 다른가?*

**이 표본이 말할 수 있는 것**(arm마다 과제마다 2번, 모델 하나, 리뷰어 계열 하나. 퍼센트는 쓰지 않는다):

- **atc의 `ui-review` skill은 만드는 과정을 바꿨고 모양을 바꾸지는 않았다.** 네 번 모두 불렀다(`CLAUDE.md` 한 줄이 시킨다). 대시보드(T1)는 기계 측정에서 더 깨끗했다: 24 px 미만 클릭 대상이 두 번 모두 0개(A는 한 번이 26개 중 20개), serious 이상의 axe 위반이 0개(A는 각각 1개, C의 한 run은 *critical* `select-name`). 비용은 빈 arm의 약 **1.9배**, 걸린 시간은 **1.9~2.5배**였다. 설정 폼(T2)은 모든 arm이 기계 측정에서 똑같았다(axe 위반 0, 작은 대상 0). 다만 `ui-review` 두 번은 저장 버튼을 늘 켜 두었고 나머지 arm은 바뀐 것이 있을 때만 켠다.
- **`frontend-design`은 프로젝트 skill로 넣어도 쓰이지 않았다.** 4번 모두 세션이 부르지 않았다(한국어로 "대시보드·설정 화면을 만들어줘"라는 요청이 skill 설명과 맞지 않았다). 사실상 빈 run이다. `CLAUDE.md` 한 줄로 쓰라고 시키자(arm C2) 4번 모두 불렀고, 비용은 빈 arm의 약 **1.3~1.5배**, T1 결과는 `ui-review`와 비슷했다(작은 대상 0개, 한 run은 axe 위반 0, 다른 run은 serious 대비 위반 하나).
- **전체 품질은 이 표본으로 가를 수 없다.** 블라인드 모델 리뷰(Claude Sonnet 5.5. 같은 계열의 다른 등급이다: 다른 계열은 쓸 수 없었다)는 모든 결과에 10점 만점에 7~9점을 줬고 휴리스틱 합계가 겹친다. **주 심판인 SUPERVISOR의 블라인드 비교는 아직 열려 있다**: 8절.

**권고(블라인드 순위가 나오기 전까지 잠정):**
1. **빽빽하거나 인터랙티브한** 새 화면(대시보드, 목록+상세)은 마지막 단계로 `ui-review`를 `diff` 모드로 돌린다. 두 번 모두 작은 대상과 대비 문제를 없앤 유일한 arm이고 비용은 약 두 배다. **작은 폼**에서는 비용만 늘고 기계 측정의 이득은 없었다.
2. **`frontend-design`을 혼자 설치해 두고 효과를 기대하지 않는다.** 블라인드 순위에서 SUPERVISOR가 C2의 모양을 더 좋아하면 `CLAUDE.md`에 명시 한 줄("화면을 만들 때는 `frontend-design` skill을 쓴다")을 넣는다. 그 줄이 없으면 이런 요청에서 skill은 놀고 있다.
3. 블라인드 순위가 arm 사이에 선호를 보이지 않으면 모양에 대해서는 "표본으로 가를 수 없다"고 하고, 빽빽한 화면용 싼 관문으로 `ui-review`만 남긴다.

## 2. arm과 스캐폴드

모든 arm: 같은 모델 **`claude-opus-5-5`**(이 호스트에서 그냥 `claude`를 띄울 때의 모델. `fleet.json`에 `launchModel`이 없다), Claude Code 2.1.286, 같은 프롬프트(3절), 같은 스캐폴드, 자기 임시 폴더(atc 워크트리가 아님)에서 도는 헤드리스 `claude -p` 세션 하나. 아무것도 push하지 않았다.

| Arm | 세션이 가진 것 |
|---|---|
| **A: blank** | 스캐폴드만. `CLAUDE.md`·skill·플러그인 없음 |
| **B: atc `ui-review`** | A + `.claude/skills/ui-review/`를 그대로 복사(`SKILL.md`, `references/`. atc `main` `9163b77`) + 한 줄짜리 `CLAUDE.md`: "Before you finish a screen, run the `ui-review` skill in `diff` mode and fix its Blockers." `docs/design-language.md`로 가는 링크는 그린필드 폴더에서 풀리지 않는다(그대로 둠). 스캐폴드는 커밋 하나짜리 git 저장소라 `diff`가 비교할 것이 있다 |
| **C: `frontend-design`** | A + Anthropic의 `frontend-design` skill을 프로젝트 skill로 복사(`anthropics/skills` `skills/frontend-design/`, 커밋 `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`, Apache-2.0). `CLAUDE.md` 없음 |
| **C2**(추가) | C + 한 줄짜리 `CLAUDE.md`: "When you build a screen, use the `frontend-design` skill." C가 한 번도 불리지 않아 더했다(B의 줄과 짝) |

arm D(B + C)는 돌리지 않았다: C가 놀고 있었고 D가 답할 질문이 분명하지 않다.

**"skill 없음"을 어떻게 지켰나.** `--setting-sources project`는 사용자 수준 설정·skill·플러그인을 뺀다. Claude Code가 기본으로 싣는 skill(`design`, `design-sync`, `dataviz` …)은 어떤 설정으로도 못 빼서, 모든 arm이 `--disallowedTools "Skill(design) Skill(design-sync) Skill(dataviz) WebFetch WebSearch Task"`로 돌았다: 세션이 부를 수 있는 UI skill은 그 arm의 것뿐이다. 실행 기록이 되는 것을 보여 준다: A의 한 run에서 세션이 `dataviz`를 불렀다가 거절당했다(`Skill execution blocked by permission rules`). 허용한 도구: `Read Write Edit Skill`과 `Bash(...)` 몇 개(`npm run build`, `npx tsc`, `ls`, `cat`, `find`, `grep`, `wc`, `git diff|status|log|show`). 모든 arm에 개발 서버도 브라우저도 없었다: **어느 세션도 자기 화면을 보지 못했다.** run마다 `--max-budget-usd 3`. 첫 run이 $2를 넘으면 멈추는 규칙은 근처에도 가지 않았다.

**스캐폴드.** `npm create vite@latest -- --template react-ts`를 한 번 설치하고, 데모 내용·CSS·아이콘·README를 지운 뒤(`App`은 빈 `<div />`) run마다 복사했다(`node_modules`는 하드링크). **UI 라이브러리 없음. CSS는 더해도 되지만 npm 패키지는 안 된다**(프롬프트에 적었다). 데이터: 과제마다 같은 고정 `src/data.json`. T1은 서버 20대(정상 13, 성능 저하 4, 다운 2, 점검 1. 이름·역할·리전·상태·CPU·메모리·마지막 확인·가동 시간·IP·OS·최근 이벤트 둘), T2는 채널 넷(이메일 켜짐, Slack 켜짐, 푸시 꺼짐, SMS 꺼짐)과 `me@example.com`.

## 3. 프롬프트(그대로, 한국어, 모든 arm 같음)

T1:

```text
서버 여러 대의 상태를 한눈에 보는 운영 대시보드 화면을 만들어줘. 목록, 상태, 하나를 누르면 상세가 보이게.

작업 조건:
- 이 폴더는 Vite + React + TypeScript 프로젝트이고 화면은 src/App.tsx에서 시작한다.
- 새 npm 패키지를 추가하지 않는다. CSS는 직접 써도 된다.
- 데이터는 src/data.json을 읽어 쓴다(서버 없음).
- 끝나면 `npm run build`가 통과해야 한다.
- 마지막에 한 문단으로 무엇을 만들었는지 알려줘.
```

T2: "알림 설정 화면을 만들어줘. 채널별로 켜고 끄고, 이메일 주소를 입력하고, 저장할 수 있게." 뒤에 같은 조건.

실행: arm마다 과제마다 2번, A·B·C·C2 × T1·T2 = 16 run(계획 12 + C2 4).

## 4. 실행과 비용

| Arm | T1 비용(2 run) | T2 비용(2 run) | T1 시간(초) | T2 시간(초) | 부른 skill |
|---|---|---|---|---|---|
| A blank | $1.16 | $0.63 | 197 | 85 | 없음(내장 `dataviz`를 부르려다 거절 한 번) |
| B `ui-review` | $2.14 | $1.21 | 382 | 214 | `ui-review` 4/4 |
| C `frontend-design` | $1.16 | $0.69 | 191 | 104 | **0/4** |
| C2 | $1.50 | $0.93 | 277 | 170 | `frontend-design` 4/4 |

run별(T1-1, T1-2, T2-1, T2-2): A $0.58 / $0.58 / $0.32 / $0.31, B $1.14 / $1.00 / $0.59 / $0.62, C $0.56 / $0.60 / $0.35 / $0.34, C2 $0.74 / $0.76 / $0.50 / $0.43. 16개 빌드 모두 통과했다(하네스가 `npm run build`를 다시 돌림).

**지출:** 만든 쪽 $9.42, 마지막 블라인드 리뷰 $0.92(T2 리뷰는 하네스를 고친 뒤 한 번 다시 돌려 약 $0.5가 더 들었다), 시험 호출 $0.05: $20 상한 가운데 약 **$11**.

## 5. 기계 측정(모든 arm에 같은 스크립트)

빌드마다 `vite preview`로 띄우고 헤드리스 Chrome을 DevTools 프로토콜로 몰아 1280 × 800에서 쟀다(이 세션에는 Playwright가 없다): axe-core(WCAG 2/2.1/2.2 A·AA와 best-practice 태그), 주 동작까지 Tab 횟수, 포커스된 컨트롤에서 Enter, Tab 정류장 35~40곳의 포커스 표시 변화, 24 px 미만 인터랙티브 요소(입력은 레이블 크기까지 센다), TSX·CSS 줄 수.

| Run | axe 위반 / 노드 / serious+critical | 24 px 미만 대상 | 주 컨트롤까지 Tab | TSX / CSS+html 줄 |
|---|---|---|---|---|
| A-t1-1 | 2 / 17 / **1**(`color-contrast`) | **26개 중 20** | 9 | 353 / 540 |
| A-t1-2 | 2 / 27 / **1**(`color-contrast`) | 9개 중 0 | 15 | 452 / 475 |
| B-t1-1 | 0 / 0 / 0 | 26개 중 0 | 9 | 496 / 713 |
| B-t1-2 | 2 / 2 / 0 | 26개 중 0 | 9 | 359 / 517 |
| C-t1-1 | 4 / 7 / **2**(`color-contrast`, `select-name` critical) | **12개 중 5** | 15 | 364 / 480 |
| C-t1-2 | 1 / 1 / 0 | 26개 중 0 | 9 | 322 / 573 |
| C2-t1-1 | 0 / 0 / 0 | 25개 중 0 | 8 | 300 / 351 |
| C2-t1-2 | 2 / 18 / **1**(`color-contrast`) | 46개 중 0 | 6 | 356 / 618 |
| A-t2-1, A-t2-2 | 0 / 0 / 0 | 7개 중 0 | 6 | 209 / 192, 156 / 188 |
| B-t2-1, B-t2-2 | 0 / 0 / 0 | 7개 중 0 | 6 | 235 / 269, 266 / 303 |
| C-t2-1, C-t2-2 | 0 / 0 / 0 | 7개 중 0 | 6 | 227 / 233, 206 / 252 |
| C2-t2-1, C2-t2-2 | 0 / 0 / 0 | 7개 중 0 | 6 | 188 / 301, 198 / 323 |

- moderate axe 항목은 `region` / `landmark-one-main`(페이지에 landmark가 없다)이었다: 어느 arm도 꾸준히 피하지 못했다(B-t1-1과 C2-t1-1은 피함).
- **보이는 포커스:** 모든 run의 모든 Tab 정류장에서 스타일이 바뀌었으므로 이 측정은 arm을 가르지 못한다.
- **기능 점검표**(run 전에 적어 둠). T1: 20대 모두 목록에 있음, 상태, CPU, 마지막 확인, 개수 요약, 클릭과 Enter로 상세 열림: **8 run 모두 전 항목 yes**. T2: 채널 토글 넷, 이메일 입력칸에 처음 값과 레이블, 잘못된 주소에 메시지, 저장하면 확인: **8 run 모두 yes**. 차이는 "저장하지 않은 변경" 하나: A·C·C2는 바뀐 것이 있을 때까지 저장을 끄고(저장하지 않은 변경 글도 보임), B 두 번은 저장을 늘 켜 둔다(저장하지 않은 변경 글은 보인다).
- 로딩·빈·오류 상태: 지역 데이터라 로딩 상태는 없다. T1 run들은 빈 결과 글이 있다. 스크립트가 닿은 것은 아니고 소스로만 본 증거다.

## 6. 블라인드 모델 리뷰

출력마다 새 `claude -p` 리뷰어(Sonnet 5.5. 만든 쪽은 Opus 5.5: **같은 계열의 다른 등급이다. 다른 계열의 리뷰어는 쓸 수 없었다.** 점수를 읽기 전에 이 점을 기억할 것). 리뷰어는 무작위 라벨과 1280 × 800 스크린샷만 봤고 arm·코드·측정값은 몰랐다. **중립 루브릭**(Nielsen 10 휴리스틱 0~2, 스크린샷에서 보이는 WCAG 2.2 AA 기본, "요청한 것을 했나", 전체 1~10)을 썼고 `ui-review` 점검표는 쓰지 않았다. B가 자기 규칙으로 채점받지 않게 했다.

| 과제 | A | B | C | C2 |
|---|---|---|---|---|
| T1 전체(run 1, run 2) | 9, 8 | 8, 8 | 8, 8 | 8, 8 |
| T2 전체(run 1, run 2) | 8, 8 | 8, 8 | 7, 8 | 8, 8 |

Nielsen 합계는 리뷰어가 판단할 수 있던 점수 가운데 12~17로 arm에 따른 경향이 없다. 리뷰어가 꼽은 "가장 큰 문제"는 arm에 상관없이 같았다(작은 회색 보조 글, 다운 서버에 다음 행동이 없음, 첫 화면에 20대 중 10대쯤만 보임, 작은 저장 성공 글). **모델 리뷰는 arm을 가르지 못한다.** 스크린샷으로 매긴 WCAG 표시는 일부 run에서 axe와 다르다(B-t1은 axe가 대비 문제를 못 찾았는데 리뷰어는 대비를 fail로 줬다): 인상으로만 읽는다.

## 7. B와 C는 A와 어디가 다른가

- **B 대 A.** B는 비용이 T1·T2 모두 약 1.9배, 시간은 약 1.9배·2.5배다: 세션이 만들고, 검토를 돌리고, 고친다(T1 28~35턴, A는 10~11턴). T1의 기계 결과는 검토 규칙(클릭 대상, 대비, 레이블)의 방향으로 좋아졌다. T2는 기계적으로 나아진 것이 없고, 저장이 늘 켜져 있게 됐다("저장하지 않은 변경"에서 A·C·C2보다 못한 점). B 두 번 모두 "Blocker 없음"이라고 하고 열린 Note와 "확인 못 함: 대비, 실제 브라우저의 키보드"를 적었다: 이 환경에서 검토가 브라우저를 돌릴 수 없다.
- **C 대 A.** 설명할 차이가 없다: C의 어느 run도 skill을 부르지 않았다. C의 T1에는 가장 나쁜 axe 결과(C-t1-1)와 가장 좋은 것 가운데 하나(C-t1-2)가 둘 다 있다: skill 효과가 아니라 run 사이 흩어짐이다.
- **C2 대 A·B.** skill을 부르게 하자 A보다 비용이 약 30~50% 늘었다(B는 약 90%). T1 기계 결과는 B와 비슷했다(두 번 모두 작은 대상 0, 한 run은 axe 항목 없음, 한 run은 대비 17노드). T2는 A와 같다.
- **run 사이 흩어짐이 arm 사이 차이만큼 크다**(예: A-t1-1과 A-t1-2의 작은 대상 26개 중 20 대 9개 중 0, C-t1-1과 C-t1-2의 axe 4 대 1).

## 8. SUPERVISOR에게: 블라인드 세트

- 스크린샷, 1280 × 800: **`/tmp/playwright-mcp/greenfield/`**(`INDEX.txt`에 파일 설명). T1: 8개 결과 × (`normal`, `detail`), T2: 8개 결과 × (`normal`, `error`, `saved`). 라벨은 과제마다 무작위 글자(`T1-K`, `T2-P` …)다.
- **매핑 파일을 열기 전에 과제마다 8개를 순위 매겨 주세요.** 매핑(라벨 → run → arm)은 따로 있는 로컬 파일 **`/tmp/greenfield-mapping/mapping.json`**이다. 스크린샷 파일 이름만으로는 arm을 알 수 없다.
- 순위가 위의 기계·모델 결과와 다르면 "모양"에 대해서는 SUPERVISOR의 순위를, 접근성에 대해서는 기계 표를 믿는다. 순위를 알려 주면 1절의 권고를 고친다.

## 9. 한계

- **작은 표본.** arm마다 과제마다 2번, 모델 하나(Opus 5.5), 과제 둘, run마다 세션 하나. run 사이 흩어짐이 arm 사이 차이만큼 크다. 퍼센트는 쓰지 않는다.
- **리뷰어 계열 하나.** 리뷰어는 Claude(Sonnet)이고 만든 쪽과 계열이 같다. 리뷰어는 스크린샷만 봤다.
- **스크립트의 한계.** 상태는 글자 휴리스틱으로 닿는다(첫 *성능 저하* 서버, 이메일 입력칸, "저장" 버튼). 16 run 모두 모든 상태에 닿았다. 작은 대상 수는 보이는 인터랙티브 요소를 모두 세므로 클릭 가능한 행 컨트롤 하나가 여러 번 셀 수 있다. axe-core가 모든 것을 보지는 못한다. 최종 숫자 전에 하네스 버그 셋을 찾아 고쳤다(주소 칸인 줄 알고 이메일 *채널 토글*에 입력, 글자 없는 Enter 키, 실패할 수 없던 포커스 측정). 모든 run을 최종 스크립트로 다시 쟀다. 포커스 표시 측정은 여전히 가르지 못한다.
- **어느 arm도 자기 화면을 보지 못했다**(브라우저·개발 서버 없음). 그래서 `ui-review`의 실행 증거 단계는 돌 수 없었고 B는 소스로 검토하며 그렇게 적었다.
- **그린필드 폴더의 `ui-review`**에는 참조 규칙 위에 둘 `docs/design-language.md`가 없다: 여기서의 값은 가져온 규칙 두 벌과 검토 형식이지 atc의 디자인 언어가 아니다. atc 밖의 새 프로젝트가 처한 상황이다.
- **모바일**은 기준이 아니었다. 적은 상태 말고는 재지 않았다.
- **skill 호출 여부도 결과의 일부다.** C의 skill은 짧은 한국어 프롬프트에서 작동하지 않았다. 다른 프롬프트면 작동할 수도 있다. 이 조사는 그것을 시험하지 않았다.

## 10. 다시 하려면

스캐폴드와 프롬프트는 2~3절대로. run마다: 스캐폴드를 복사(`node_modules` 빼고, 그 뒤 하드링크), arm의 파일을 넣고, `git init`·커밋, 그다음 `claude -p "<프롬프트>" --setting-sources project --model claude-opus-5-5 --permission-mode acceptEdits --allowedTools "Read Write Edit Skill Bash(npm run build:*) …" --disallowedTools "Skill(design) Skill(design-sync) Skill(dataviz) WebFetch WebSearch Task" --max-budget-usd 3 --output-format stream-json --verbose`. 스크립트는 job의 임시 폴더에 있었고 저장소에는 두지 않는다. 위의 숫자가 기록이다.
