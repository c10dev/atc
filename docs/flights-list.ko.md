# FLIGHTS LIST: drawer를 열어도 칸에 맞는 두 줄 행

**한국어** · [English](flights-list.md)

상태(2026-10-03): 설계 초안. 아직 만든 것은 없다. SUPERVISOR가 2026-10-03 grilling 세션에서 정했고, 단계 표시(E안, 파이 글리프 하나)는 1000 px에서 FLIGHT drawer를 연 화면과 1280, 390 px의 비공개 시제품 라운드를 본 뒤 골랐다. 작업 지시서는 5절이다.

**SUPERVISOR는 이 작업이 들어갈 때까지 FLIGHT drawer를 열면 LIST가 깨진 채로 있는 것을 받아들였다.** 따로 급히 고치는 패치는 없고, 행을 한 번에 다시 만든다.

관련: [follow.md](follow.md)(보드, 단계, 막힘 한도), [layout.md](layout.md)(FLIGHTS는 다섯 화면의 하나), [design-language.md](design-language.md)(규칙과 점검표), [duty-screen.md](duty-screen.md)(drawer 패턴).

## 1. 현재 사실

2026-10-03 `origin/main` 기준.

- **깨지는 이유.** SUPERVISOR의 너비(약 1000 px)에서 FLIGHT drawer를 열면 drawer는 `clamp(360px, 44vw, 560px)` = 440 px이라 LIST 칸은 약 510 px(bundle 안쪽 약 470 px)이다. `web/src/views/Follow.css`의 `.fw-row`는 `grid-template-columns: minmax(180px, 1.2fr) auto auto minmax(160px, 1.4fr)`이다. 점 칸은 `auto`라 줄지 않는다(점 9개 × 26 px와 간격, 약 266 px). 최소 합이 약 640 px이라 마지막 칸이 bundle 밖으로 넘치고 글자마다 줄이 바뀐다("살펴보/기", "작업 25시/간").
- **좁은 화면 규칙이 안 켜진다.** 규칙이 `@media (max-width: 700px)`라서 drawer가 좁힌 칸이 아니라 창 너비를 본다. `web/src/kit/TodoRow.css`는 같은 문제를 이미 `@container`로 풀었다.
- **`.fw-now`는 잡동사니 통이다.** `flex-wrap` 영역에 일곱 가지가 정해진 자리 없이 들어간다: 지금 글, 막힘 표시, 이슈 태그, `LandingBadge`, `BlockList`, 다음 칩, `FlightBrakes`.
- **규칙 빈틈.** [design-language.md](design-language.md)에 "컴포넌트는 자기 container에서 크기를 정한다"는 규칙이 없고, [layout.md](layout.md)의 점검 너비(1000, 1280, 390)는 모두 drawer를 닫은 상태다.
- **시제품에서 잰 너비**(넘친 행 없음): 1000 px에 drawer 열림 bundle 432 px(sidebar가 스스로 접힘, layout.md 7.3). **1280 px에 sidebar와 drawer가 모두 열리면 bundle 332 px로 1000 px보다 좁다.** 390 px은 bundle 334 px.
- **행 데이터.** `FollowRow`(`server/follow.ts`)에는 `stages`, `current`, `finished`, `now`(완성된 문자열), `issues`, `stuck`, `next`가 있다. `now`는 `progressText`(`server/progress.ts`)가 만든다. 예: `작업 25시간 41분 · 보통 5–14분 (BUILD·M, n=279) · 길어짐`. `FlightProgress`에는 `elapsedMin`, `typical`, `late`가 있지만 행에 닿기 전에 이 문자열로 뭉개진다.
- **정렬.** `stuckFirst`가 막힌 행을 bundle 맨 위에 둔다. 비행 중을 대기보다 앞에 두는 정렬은 없다.
- **단계 묶음**(follow.md 3.2): `todo`, `proposed`, `approved`, `sent`는 CAPTAIN이 FLIGHT를 받기 전, `readback`, `pr`은 FLIGHT, `ci`, `landed`, `deployed`는 LANDING이다. 그래서 4 · 2 · 3, DISPATCH / FLIGHT / LANDING이 맞다.

## 2. 원칙

1. **LIST는 한 가지에 답한다: "각 FLIGHT가 어디 있고, 막혔나?"** 지켜보는 화면이다. 조치는 FLIGHT drawer에 있다.
2. **행은 자기 container에서 크기를 정한다.** 행은 어느 너비에서나 두 줄이다. 행의 최소 칸 합은 drawer를 연 칸에 들어간다. 분기점은 행 자기 container의 `@container` 질의이고 `@media`가 아니다.
3. **행마다 신호 하나.** 행에는 칩이 최대 하나(와 `+n`)이고 순서는 막힘, 경고 이슈, 착륙 배지, 정보 이슈다. 설명은 drawer에 있다.
4. **색만으로 알리지 않는다.** 막힘은 호박색에 `막힘`이라는 글자를 더한다. 보통 범위를 넘으면 호박색에 `길어짐`을 더한다.
5. **서버가 정하고 브라우저는 그린다**(design-language 4). 경과·보통 범위·늦음은 필드로 오고, 브라우저가 문자열을 풀어 읽지 않는다.
6. **새 사실 없음.** 모든 필드는 atc가 이미 남기는 기록에서 온다.

## 3. 설계

### 3.1 행

늘 두 줄이다.

```
1줄:  ATC-381 · Small moves: AIRPORTS into settings, GLOBE to th…   [막힘 PR 없음 +1]
2줄:  ◔ RB · 25h 41m / usual 5–14m · 길어짐
```

- **1줄:** KEY, 제목(한 줄, 말줄임), 오른쪽에 신호 칩 하나와 나머지 `+n`. 칩 순서: 막힘 > 경고 이슈(`NO-PR` …) > 착륙 배지 > 정보(`FUEL …`).
- **2줄:** 단계 표시, 지금 단계 이름(`RB`), 경과와 보통 범위. 경과가 보통 범위를 넘으면 글이 호박색이고 `길어짐`이 붙는다. 표본 설명(`BUILD·M, n=279`)은 행의 title 글과 drawer로 옮긴다.
- 글리프는 어느 단계가 막혔는지 말하지 않는다. 2줄의 글(`row.stuck.text`, 호박색)과 단계 이름이 알리고, 단계별 시각은 drawer에 있다. 옛 점 툴팁은 없어진다.
- **열린 행.** drawer에 열린 행은 왼쪽 2 px 막대와 옅은 배경으로 표시하고, drawer를 닫으면 지운다. `↑`/`↓`로 다음 행 열기는 선택 사항이다.
- 행을 누르면(또는 `Enter`) 지금처럼 FLIGHT drawer가 열린다.

### 3.2 단계 표시 (SUPERVISOR의 선택: E)

진행에 따라 차오르는 Linear 식 파이 글리프 하나(약 14 px). 지금 단계는 반 칸을 채운다. 가득 찬 파이는 끝났을 때만이다(아니면 마지막 단계에 있는 STAND 없는 FLIGHT가 끝난 것처럼 보인다). 막히면 호박색. 해당 없는 단계(STAND 없음, `tail:`, 배포 없음)는 세는 자리를 그대로 지킨다.

묶은 점(B안: 점 4 · 2 · 3과 간격)은 보여 주었지만 고르지 않았다.

**좁을 때의 대비.** container가 약 320 px 아래면 글리프를 감추고 `RB 5/9` 글을 보인다. 시제품은 여기에 닿지 않았으므로(가장 좁은 bundle이 332 px) 잰 경우가 아니라 안전장치다.

### 3.3 drawer로 가는 것

행에서 FLIGHT drawer로: `살펴보기`, `Todo로`(layout.md대로 RELEASE에도 있다), `CANCEL` / `RECALL`(`FlightBrakes`), 이슈 설명, `기록 n`, `BlockList`, 단계별 시각. 행이 이것들을 그만 보이기 **전에** drawer에 먼저 있어야 한다. 두 PR 사이에 조치가 사라지면 안 된다(5절 순서).

### 3.4 bundle

- bundle 안 순서: **막힘 → 비행 중 → 대기**(비행 중이 대기보다 앞서는 것이 새 규칙).
- 머리: `ARROWS · 막힘 3 · 비행 6 · 끝남 65/75`, `막힘`이 먼저이고 호박색. `다음 할 일`은 뺀다(조치는 drawer에 있다).
- 끝난 행은 bundle 끝의 `끝남 n` 한 줄로 접는다. 펼치면 옅은 한 줄 행이다.
- `따라가는 FLIGHT` 입력은 목록 맨 아래로 옮긴다. `flex: none`이 필요하다: 지금은 column-flex `.follow` 안의 `.fw-form`이 flex-basis 높이까지 커진다.
- **범위 밖:** LATE WAYPOINTS, LANDING SEQUENCE, AIRCRAFT STRIPS는 그대로 둔다.

### 3.5 서버 필드

- `FollowRow.progress: {elapsed, usual, late, sample} | null`(더하기만). `FlightProgress`에서 만든다. `now`는 옛 읽는 쪽과 알림을 위해 글을 그대로 둔다. `elapsed`는 분, `usual`은 `{lo, hi}` 분 또는 null, `late`는 불리언, `sample`은 `BUILD·M, n=279` 같은 묶음 글.
- 행 순서: `stuckFirst` 다음에 비행 중이 대기보다 앞(안정 정렬).
- 착륙 배지 글에는 PR(`pulls`)이 필요하다(옛 행도 그랬다). 신호 칩이 거기서 읽는다.
- bundle 수 `stuck`, `flying`, `finished`, `total`은 이미 있다(follow.md F1/F2).

## 4. 규칙 (이 초안과 같은 PR)

- design-language.md 원칙 8에 더한다: **행과 카드는 자기 container에서 크기를 정하고(`@container`), 행의 최소 칸 합은 drawer를 연 칸에 들어간다.**
- design-language.md 5절 점검표에 "FLIGHT drawer를 연 1000 px: 넘치는 행 없음" 줄을, layout.md의 Playwright 너비에 **drawer를 연 1000 px**과 **sidebar와 drawer를 모두 연 1280 px**(가장 좁은 경우, 332 px)을 더한다.

## 5. 구현 순서

셋 모두 `auto`(서버 읽기 모델, `web/src`, 문서)다. 구현 PR은 본문에서 design-language 5절 점검표에 답하고 drawer를 연 1000 px에서 `ui-review`를 돌린다. 공개 저장소와 PR에 스크린샷은 올리지 않고 화면은 글로 적는다.

| # | 단계 | 결과 | 선행 |
|---|---|---|---|
| LS1 ([ATC-491](https://linear.app/vocado/issue/ATC-491)) | **행 데이터.** `FollowRow.progress`, 비행 중이 대기보다 앞서는 순서, `node:test` | 브라우저가 문자열을 풀지 않고 2줄과 순서를 그릴 수 있다 | 없음 |
| LS2 ([ATC-492](https://linear.app/vocado/issue/ATC-492)) | **drawer가 조치를 받는다.** `살펴보기`, `Todo로`, CANCEL/RECALL, 이슈 설명, 기록, BlockList, 단계별 시각을 FLIGHT drawer에 둔다 | 행을 줄여도 옛 행이 하던 일이 사라지지 않는다 | 없음 |
| LS3 ([ATC-493](https://linear.app/vocado/issue/ATC-493)) | **두 줄 행, bundle 머리, 입력.** 3.1–3.4: container 질의, 파이 글리프, 신호 칩, 열린 행 표시, 끝남 접기, 머리, 맨 아래 입력 | LIST가 1000(drawer 열림), 1280(sidebar와 drawer 열림), 390 px에서 맞는다 | LS1, LS2 |

단계마다 점검: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, 그리고 씨앗 데이터를 넣은 7702 시험 서버(`ATC_GITHUB=off`, 임시 상태 폴더): 막힌 행, 보통을 넘긴 행, 이슈가 여럿인 행, 해당 없는 단계, 끝난 bundle, 긴 제목.

## 6. 위험

| 위험 | 대비 |
|---|---|
| 파이는 어느 단계가 막혔는지 보이지 않는다 | 2줄 글과 단계 이름이 알리고 단계별 시각은 drawer에 있다. 둘을 본 SUPERVISOR가 정했다 |
| drawer가 받기 전에 행이 조치를 잃는다 | LS3는 LS2에 막힌다 |
| 320 px 대비는 시험되지 않았다 | 안전장치다. ui-review에서 좁은 container를 한 번 억지로 만들어 글로 적는다 |
| `progress.sample`이 title에만 있다 | title 글은 결정 근거가 아니다(design-language 11). 같은 글을 drawer가 보인다 |

## 7. 결정

**정함(SUPERVISOR, 2026-10-03):**

- 급히 고치는 패치 없이 한 번에 다시 만든다. 그때까지 drawer를 열면 LIST는 깨진 채로 둔다.
- 두 줄 행, 신호 칩 순서, 조치를 drawer로 옮기기, bundle 순서와 머리, 끝남 접기, 맨 아래 입력.
- 단계 표시: **E, 파이 글리프**.
- container 크기 규칙과 새 점검 너비.
