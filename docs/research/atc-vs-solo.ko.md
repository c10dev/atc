# 벤치마크: 이슈 하나당 SUPERVISOR의 주의, atc 대 Claude Code 단독

[English](atc-vs-solo.md) · **한국어**

> 상태: **PROTOCOL, 사전 등록.** [ATC-459](https://linear.app/vocado/issue/ATC-459)(합친 설계, SUPERVISOR 결정 2026-10-03)를 [ATC-462](https://linear.app/vocado/issue/ATC-462)로 적는다. 아직 실행한 적 없다. 판정 규칙(6절)과 아래 분석은 이 파일을 머지하면 고정된다. 첫 본 실행 뒤의 변경은 조용히 고치지 않고 기록하는 개정(12절)이다. 이 글은 매뉴얼, skill, guard, hook, 설정을 바꾸지 않는다. 파일럿과 실행은 FLIGHT가 아니라 SUPERVISOR의 일이다. 저장소는 공개라서 실제 데이터, 스크린샷, 비공개 프로젝트 이름은 이 파일에 없다.

관련: [ui-skill-ab.ko.md](ui-skill-ab.ko.md)와 [ui-greenfield-ab.ko.md](ui-greenfield-ab.ko.md)는 앞선 블라인드 리뷰 조사다. 같은 프롬프트, 같은 시작 커밋, 버리는 worktree, 블라인드 리뷰어라는 방법을 그대로 쓰고, 리뷰어 잡음이 크다는 경고도 이어받는다(5절).

## 1. 질문

atc가 **머지 준비가 끝난 이슈 하나당 SUPERVISOR의 능동 주의**를 줄이는가? 품질은 나빠지지 않고, Claude 토큰은 두 배 이하여야 한다.

- 먼저는 내부 결정이다: atc의 오케스트레이션에 계속 투자할지 말지.
- 바깥에 내놓는 주장은 이슈 12개 이상이 필요하고, 같은 데이터로만 한다. 따로 조사를 하지 않는다.

## 2. 팔

| | atc 팔 | solo 팔 |
|---|---|---|
| 누가 일하나 | 평소 atc 운영: DISPATCH, AIRCRAFT(CAPTAIN과 CREW), MCC INSPECTION과 착륙 | SUPERVISOR가 대화형 Claude Code **클라우드** 세션([claude.ai/code](https://claude.ai/code)) 하나를 몰고, 한 번에 이슈 하나. subagent는 써도 된다 |
| 어디서 | 실전 fleet. **실험 시간대를 따로 잡는다**(그동안 fleet은 다른 일을 하지 않는다) | 이슈마다 클라우드 컨테이너 하나, 같은 기준 커밋에서 딴 브랜치 |
| 규칙 파일 | 루트 `CLAUDE.md` 그대로 | **중립화한 CLAUDE.md**(아래) |
| 머지 전 리뷰 | MCC INSPECTION과 Codex 리뷰, 평소대로 | atc의 것은 없음. atc 팔과 같은 블라인드 리뷰(5절) |

- 대체안: 파일럿에서 클라우드 세션 transcript를 추출기가 읽는 형태로 내보낼 수 없어 토큰과 끼어듦을 못 재면(4절), solo 팔은 STAND(worktree)의 로컬 데스크톱 세션으로 돌리고 개정에 적는다(12절).
- 두 팔 모두 같은 모델과 effort. 모델과 CLI 버전은 실행마다 기록한다.
- MCC와 Codex 리뷰는 일부러 atc 팔의 이점으로 둔다. atc가 무엇인지의 일부다.
- 운영자: SUPERVISOR 혼자이고, atc의 설계자이기도 하다. 한계다(10절).

### 중립화한 CLAUDE.md (solo 팔)

solo 팔은 루트 `CLAUDE.md`의 코드, 검증, 문서, git 규칙을 모두 두고 교신 규칙만 뺀다. "교신" 절 전체(FLIGHT PLAN과 CLEARANCE 답신 형식, READBACK·UNABLE·STANDBY·ROGER, CREW BRIEFING과 CHANGE, `GO AROUND`와 `FIX` 행동, 고정 최종 보고 머리)와 용어 절에서 그 절을 가리키는 문장 하나다. 규칙의 효과와 오케스트레이션의 효과를 가르기 위해서다.

손으로 고치지 않고 만든다:

```
git show <base-sha>:CLAUDE.md > /tmp/root-claude.md
node server/solo-claude-md.ts /tmp/root-claude.md > <solo STAND>/CLAUDE.md
sha256sum <solo STAND>/CLAUDE.md        # 해시를 실행 기록에 적는다
```

- `server/solo-claude-md.ts`가 순수 함수 `neutralize(md)`를 낸다. `server/solo-claude-md.test.ts`가 확인하는 것: 교신 절과 그 표지가 없다, 다른 절은 그대로다, 결과가 원문에서 그 두 부분을 뺀 것과 같다, 두 번 만들면 같은 바이트다, 루트 구조가 바뀌면 조용히 넘어가지 않고 던진다.
- 루트 `CLAUDE.md`는 고치지 않고, 만든 사본을 커밋하지도 않는다. 파일은 solo STAND에만 있다.
- 놓는 법(클라우드 세션): 이슈의 기준 커밋에서 브랜치를 만들고 `CLAUDE.md`를 그 파일로 덮은 뒤, 그것만 바뀐 커밋("setup" 커밋)으로 올려 브랜치를 push한다. 모두 **세션을 시작하기 전에** 한다. 그 브랜치에서 클라우드 세션을 연다. setup 커밋의 SHA가 solo diff의 기준이라(`git diff <setup-sha> <head>`) 덮은 파일은 solo diff에 들어가지 않고, 리뷰 묶음도 `CLAUDE.md`를 뗀다(`--strip CLAUDE.md`). 해시와 모델·CLI 버전을 실행 기록에 적는다.
- 브랜치는 atc 팔과 같은 저장소에 있다. 브랜치 이름은 문체 단서라 리뷰 묶음에서 뗀다(5절).
- 대체안(로컬 데스크톱 세션): 기준 커밋에서 solo STAND를 만들고 STAND의 `CLAUDE.md`를 덮은 뒤, 커밋하지 않고 `git update-index --skip-worktree CLAUDE.md`를 돌린다.
- solo 세션의 첫 프롬프트는 이슈의 작업 지시서 글 그대로다(3절). 클라우드 세션에는 브랜치가 담은 저장소 skill이 있고, 같은 규칙을 적용한다. atc의 skill은 알려 주지 않는다. 세션이 `atc-task` skill을 불렀다면 실행 기록에 적는다(그 skill에는 atc의 STAND·PR·보고 단계가 있다. 본 실행 전에 두 번째 중립화가 필요한지는 파일럿이 정한다).
- MCC나 착륙 등급을 말하는 규칙은 PR 자체를 다루므로 파일에 남는다. solo에는 MCC가 없어서 그냥 안내가 된다. 두 팔이 다른 점으로 밝혀 둔다.

## 3. 이슈와 짝짓기

- atc Linear 백로그에서 **이슈 10~12개**를 **기록한 시드로 무작위 추첨**한다. 크기(S, M)와 종류(screen, server, docs)로 층을 나눈다.
- **두세 쌍은 일부러 파일이 겹치게** 한다. atc의 머지 처리는 거기서만 보인다.
- 추첨은 스크립트라서 아무도 손으로 고르지 않는다: `node server/benchmark-draw-run.ts --candidates <후보.json> --out <결과.json> [--seed n] [--count 10..12] [--pairs 2..3]`(순수 함수는 `server/benchmark-draw.ts`, 오프라인, Linear·GitHub 호출 없음, 쓰는 곳은 `--out` 하나). 후보 목록은 손으로 만들거나 내보낸다: `[{ "key": "ATC-n", "size": "S|M", "kind": "screen|server|docs", "files": ["경로 또는 폴더/"], "flags": { "blocked", "needsDecision", "userTier", "hardToReverse" } }]`. 플래그가 붙은 후보는 이유와 함께 뺀다. 쌍을 먼저 고르고(`files`가 같은 경로이거나 `폴더/` 아래로 겹치는 서로 다른 이슈), 크기 × 종류 6개 층을 가장 덜 찬 층부터 고르게 채운다. 팔 순서는 층 안에서 번갈아 atc 먼저와 solo 먼저가 균형을 이룬다. 출력에는 시드, 이슈별 층과 팔 순서, 겹친 파일이 있는 쌍, 경고가 담긴다. 층·개수·쌍을 채울 풀이 모자라면 경고로 보고하고 조용히 채우지 않는다. 같은 시드와 같은 후보(순서 무관)는 같은 출력이다.
- 뺀다: `user` 등급 이슈(바뀐 경로로 정하는 착륙 등급, `deploy/landing-tier.mjs`), 되돌리기 어려운 변경, 사람의 결정이 필요한 이슈.
- 이슈마다 **두 팔 모두 같은 기준 커밋에서** **같은 작업 지시서 글**을 첫 프롬프트로 구현한다. 작업 지시서를 쓰는 시간은 따로 적고 주의에서 뺀다.
- **이월 효과 통제**:
  - 이슈마다 팔의 순서를 번갈아 한다.
  - 한 이슈의 두 팔은 **하루 이상 띄운다**.
  - 둘째 팔이 끝나기 전에는 첫째 팔의 diff를 **읽지 않는다**.
- atc 팔은 묶음(한 번에 약 4개)으로, solo 팔은 차례로 돌린다. 결론이 안 나면 이슈를 단계적으로 더한다(시드와 추첨 규칙은 그대로).
- server 이슈는 **어느 팔이 시작하기 전에 인수 테스트를 먼저 쓴다**(5절).

## 4. 지표

### 주 지표: 능동 주의

묶음과 이슈마다 합친다. SUPERVISOR가 쓰는 Mac에서 잰다:

- ActivityWatch(창 초점과 자리 비움), 손으로 누르는 시작/정지 타이머를 교차 확인으로.
- 주의를 셋으로 가른다:
  - **active**: 입력이 있다.
  - **tethered**: 창을 보고 있으나 입력은 없다.
  - **away**: 자리 비움 기준을 넘겨 입력이 없다.
  판정에는 **active**만 센다. tethered와 away는 옆에 같이 적는다.
- 세는 창은 두 팔이 같은 목록이다: atc 화면, ANNUNCIATOR, Claude 앱, claude.ai/code 브라우저 탭(solo 팔은 Claude Code 클라우드 세션에서 돈다), 터미널, GitHub, Linear. 팔은 실험 시간대로 정하고, 시간대 안에서는 관계없는 Claude 세션을 돌리지 않는다.
- `server/attention-run.ts`(순수 함수는 `server/attention.ts`, 오프라인, 로컬 파일만 읽고 아무것도 올리지 않는다)가 계산한다: `node server/attention-run.ts --export <aw.json> --windows <windows.json> [--config <파일>] [--host <이름>] [--json]`.
  - 세는 창 규칙(app·title 정규식, 먼저 맞는 규칙 우선)은 `docs/research/attention-windows.json` 한 곳에만 둔다. 지금 값은 자리표시이고, 파일럿에서 실제 창 제목으로 확인한 파일을 본 실험 전에 커밋한다. 어느 규칙에도 안 맞으면 excluded다.
  - 실험 창을 조각으로 나눠 조각마다 한 상태다: AFK는 **away**, 아니면 센 창 + 입력(입력 이벤트, 10초 유지)은 **active**, 입력 없으면 **tethered**, 안 세는 창은 **excluded**, AFK 기록이 없는 시간은 **no data**로 따로 낸다. 내보내기에 입력 버킷이 없으면 not-afk를 입력 있음으로 본다(tethered가 0이고, 보고서가 그렇게 적는다).
  - 창 파일은 `{start, end, arm, batch, issues, subWindows?: [{start, end, issue}], timer?: [{start, end}]}`의 JSON 목록이다. 분은 창·팔·배치별로 내고, 이슈별은 준 `subWindows`에 한해서만 낸다. 수동 타이머 합계는 active와 나란히 보이고, 차가 5분 이상이면서 25%를 넘으면 표시한다.

### 보조 지표

- 시작부터 merge-ready까지 걸린 시간, 고쳐 하기 횟수.
- 끼어듦. solo: SUPERVISOR의 메시지와 승인(transcript에서 읽는다). atc: leak 기록의 열린 줄, RELAY, 승인.
- 이슈당 Claude 토큰(FUEL 파서, `server/fuel*.ts`), subagent 포함. 시간대 안의 OCC와 MCC 토큰은 그 묶음의 이슈에 똑같이 나눈다. 사용 한도 창에서 쓴 비율도 같이 적는다.
- **Codex 토큰은 재지 않는다**: FUEL은 Claude transcript만 읽고, atc는 Codex 지적의 개수만 남긴다. Codex 리뷰 횟수는 따로 적고, 토큰 기준(6절)은 Claude 토큰만 쓴다.
- 층마다 분석하고, atc의 고정 비용이 지는 **손익분기 작업 크기**도 구한다.

실행 전에 밝히는 알려진 데이터 구멍: solo 팔에는 LOGBOOK, leak 기록, CLEARANCE 기록이 없다(git, `gh`, transcript로 다시 만든다). 머지한 사람이 저장되지 않는다(`mergedBy`). LOGBOOK `blockMin`은 첫 출발 기록부터 시작하므로 대기 시간이 아니다.

### 이슈별 기록 (ATC-465)

`node server/arm-metrics-run.ts --spec <spec.json> [--state <상태 폴더>] [--gh-dir <폴더>] [--json]`(순수 함수는 `server/arm-metrics.ts`)이 **두 팔에서 같은 칸**을 가진 기록을 이슈마다 하나 낸다: 이슈 키, 팔, 시작, merge-ready 시각, 걸린 분, 고쳐 하기 횟수, 끼어듦(종류별), 종류별 Claude 토큰(CAPTAIN과 CREW·subagent), OCC·MCC 몫, Codex 리뷰 횟수, 본 모델과 CLI 버전. 읽기만 한다: 상태 폴더는 인자이고 쓰지 않으며(운영 폴더가 기본값인 적이 없다), GitHub를 부르지 않고(solo PR 자료는 읽기 전용 `gh`로 미리 받아 둔다, 아래), 출력은 표준출력이다. spec은 `{ arm, window: {start, end}, issues: [{ key, start?, transcript?, reviewPassedAt?, mergeReadyAt? }], control?: [{ role, file }] }`이고, `--gh-dir`에는 solo 이슈마다 `<ATC-n>.json` 하나를 둔다. 모양은 `{number, createdAt, isDraft, commits: [{authoredDate, messageHeadline}], reviews: [{author, state}], checks: [{name, conclusion, completedAt}]}`: 앞의 네 칸은 `gh pr view <n> --json number,createdAt,isDraft,commits,reviews`(`author`는 `reviews[].author.login`)에서, `checks`는 `gh api repos/<owner>/<repo>/commits/<head sha>/check-runs`(`completed_at`이 `completedAt`)에서 가져온다. 둘 다 읽기 호출이다.

- **시작**은 그 이슈의 실험 창 시작(`start`, 없으면 창 시작)이고 LOGBOOK `blockMin`이 아니다.
- **Solo**: 토큰은 내보낸 transcript에서 기존 FUEL 함수(`parseFuelLines`, `dedupeFuel`)로 세고 CAPTAIN과 sidechain(subagent)을 가른다. 끼어듦 = 첫 메시지(작업 지시서) 뒤 SUPERVISOR 메시지 + 거절된 도구 호출. 권한 승인은 transcript에 표지가 남지 않아 재지 못한 것으로 적는다. merge-ready = CI `check` 초록(마지막 `check` run이 성공이어야 한다), `reviewPassedAt`이 더 늦으면 블라인드 리뷰 통과 시각. 고쳐 하기 = PR을 연 뒤 커밋(병합 커밋 제외, `reworkOf`).
- **atc**: 토큰은 LOGBOOK 줄의 FUEL(CAPTAIN과 CREW). 끼어듦 = 창 안에서 그 이슈의 `leaks.jsonl` 열린 줄 + RELAY 생성 + SUPERVISOR 승인(`via: "auto"` 제외). 낸 CLEARANCE 수는 적되 합에 넣지 않는다(TOWER에서 팀으로 가는 것이라 SUPERVISOR가 아니다). OCC·MCC 요청은 `control`에 준 control transcript에서 창 안 것만 읽어 묶음의 이슈에 똑같이 나눈다. merge-ready = 머지 시각(PR을 연 시각 + 착륙 대기), autoland의 끝점.
- **재지 못한 것은 실패가 아니라 모름**: solo transcript에 `message.usage`가 없으면 `tokens.measured: false`와 이유를 내고, Codex 토큰은 늘 `unmeasured`다.
- **클라우드 transcript**(2026-10-03에 공개 보고와 문서로 확인했고 실제 세션으로 확인하지 않았다): 웹의 Claude Code에는 웹 세션용 `/export`가 없다. `claude --teleport <세션>`이 로컬 세션으로 가져오며, 그 transcript는 새 UUID의 로컬 파일이고 마지막 압축 이후 기록만 있다. 그 줄에 `message.usage`가 있는지는 **확인하지 못했다**. 파일럿이 추출기(`tokens.measured`)로 확인한다. false면 프로토콜대로 solo 팔은 로컬 세션으로 돌린다.

## 5. 끝점과 품질

- **끝점: merge-ready** = CI `check` 초록 + 블라인드 리뷰 통과. 머지 행동: solo = SUPERVISOR의 리뷰와 머지 시간, atc = 0(autoland), 상향(escalation) 시간은 센다.
- **블라인드 리뷰, 리뷰어 둘, 두 팔 모두**: Claude(`/code-review high`)와 Codex. atc 팔은 이미 비슷한 MCC 리뷰를 지났으므로 두 팔에 같은 바깥 리뷰를 건다.
- **리뷰 묶음에서 문체 단서를 지운다**: 브랜치 이름, PR 머리와 본문, `changelog.d/` 조각. 묶음과 팔의 대응은 이 호스트에만 두고 리뷰가 모두 들어올 때까지 열지 않는다.
  - 묶음은 `server/blind-pack-run.ts`(순수 함수는 `server/blind-pack.ts`, 오프라인, GitHub 쓰기 없음)가 만든다: `node server/blind-pack-run.ts pack --base <sha> --atc-diff <file> --solo-diff <file> --out <묶음 폴더> --mapping <묶음 밖 파일> [--seed n] [--strip 경로] [--leak 낱말]`. `X.diff`, `Y.diff`, `PROMPT.md`, `FINDINGS-TEMPLATE.md`를 쓰고, 라벨→팔 대응(시드와 라벨별로 뺀 파일 목록 포함)은 묶음 밖 mapping 파일에만 쓴다. diff 파일은 팔마다 손으로 만든다(base 커밋에서 `git diff <base> <ref>`, PR은 `refs/pull/<n>/head`를 먼저 가져온다). `changelog.d/`와 `--strip` 경로를 빼고, diff 본문에 `--leak` 낱말이 남으면 거부한다(브랜치 이름과 PR 번호를 넘긴다).
  - Claude(`/code-review high` 방식)와 Codex 실행은 손으로 한다. 각자 `FINDING <X|Y> <P0|P1|P2> <file>:<line> — <글>` 줄을 파일로 저장한다. `node server/blind-pack-run.ts merge --mapping <파일> --claude <파일> --codex <파일>`이 팔·리뷰어별 P0/P1/P2와 P1+, 그리고 합을 낸다.
- **server 이슈는 인수 테스트를 먼저** 어느 팔이 시작하기 전에 써서, 어느 팔도 못 본 것으로 정확성을 가린다.
- 지적은 리뷰어마다 P0~P2로 매긴다. **P1+**는 P0 또는 P1이다. 앞선 조사에서 리뷰어 잡음이 컸으므로, 판정에는 두 리뷰어의 합을 쓰고 리뷰어별 수도 함께 적어 한 리뷰어만의 현상이 보이게 한다.
- atc의 PR은 평소대로 착륙한다. solo의 PR은 **Draft**로 연다. MCC는 Draft PR을 건너뛰고(`server/mcc-run.ts`가 `!draft`로 거른다) autoland는 건드리지 않으므로(`server/autoland.ts`의 NEVER 목록에 `draft`), solo PR은 atc가 검사도 착륙도 못 하고 atc 팔의 흐름 밖에 머문다. CI `check`는 그대로 돈다. solo PR은 품질에서 분명히 이겨 착륙시킬 때만 ready로 바꾸고, 아니면 리뷰 뒤 닫는다.

## 6. 판정 규칙 (사전 등록)

**셋이 모두** 맞으면 atc가 이긴다:

1. 능동 주의가 solo의 **60% 이하**(뽑은 이슈 전체 합);
2. **P1+ 지적**이 solo 이하;
3. 이슈당 Claude 토큰이 solo의 **2배 이하**.

하나라도 뒤집히면 solo가 이긴다. 그렇지 않으면 **결론 없음**이고 이슈를 더한다(3절). 분석 스크립트는 본 실행 전에 커밋하고 그 뒤에는 바꾸지 않는다. 층별 결과와 손익분기 크기는 어느 쪽이든 적지만 판정은 바꾸지 않는다.

## 7. 일정

- **파일럿**: 오늘의 구성으로 이슈 하나를 두 팔 모두에 돌려 기록, 타이머, 추출, 토큰 나눔, 리뷰 묶음을 점검한다. 결과에서는 뺀다. 클라우드 solo 팔을 위한 점검도 들어간다:
  - 클라우드 세션 transcript를 내보내 추출기로 읽는다(토큰과 끼어듦이 나오고 세션 화면과 맞는다). 못 읽으면 2절의 대체안을 쓴다.
  - claude.ai/code 탭이 `attention-windows.json`에서 실제 창 제목으로 잡힌다.
  - solo PR이 Draft로 열리고 `check`가 돌며, MCC와 autoland가 건드리지 않는다.
- **오늘의 구성으로 본 실행.** ANNUNCIATOR 앱을 기다리지 않는다. 앱에 Linear 쓰기([ATC-249](https://linear.app/vocado/issue/ATC-249))와 터미널이 생기면 **atc 팔만 다시 잰다.** 앱에서 일하면 주의가 더 줄어드는지 보려는 것이다.
- 예산: 하루 간격을 두면 대략 2~3주, SUPERVISOR 하루 1~2시간.

## 8. 2단계 (1단계에서 atc가 이길 때만)

- 병렬도를 맞춘 비교: 세션 N개의 solo 대 AIRCRAFT N개.
- 같은 점검표도 따르는 solo 팔.
- 실행 중간에 일을 넣는 여러 날 조사: 아무도 보지 않을 때 atc의 가치.

## 9. 공개

집계와 이슈별 표(이슈 키, 주의, 토큰, 지적), 부정적 결과 포함. 원본 초점 기록은 Mac에만 둔다. 어떤 글이든 10절의 한계가 맨 앞에 온다.

## 10. 한계와 알려진 구멍

- **운영자가 한 명이고 atc의 저자다.** SUPERVISOR가 atc의 버릇을 안다. atc 팔에 유리하고 없앨 수 없다.
- **표본이 작다**(이슈 10~12개, 이슈와 팔마다 한 번). 개수와 이슈별 표가 결과이고, 몇 번 안 되는 실행의 비율을 일반화해 내놓지 않는다.
- **Codex는 토큰과 주의를 재지 못한다.** 지적 개수만 있다.
- **저장소 하나**(atc), 모델 계열 하나, 빌더와 Claude 리뷰어가 같은 회사다.
- solo 팔의 데이터는 git, `gh`, transcript로 다시 만든다(4절).
- 중립화한 CLAUDE.md는 교신 규칙만 가른다. atc 팔은 fleet, MCC, Codex 리뷰도 다르다(2절). 이 비교는 "atc 전체 대 Claude Code 단독"이고 기능 하나의 시험이 아니다.
- **solo 팔은 클라우드 컨테이너, atc는 호스트.** 경과 시간과 테스트 속도는 기계에 따라 달라진다(컨테이너 기동, 설치, 차가운 캐시). 주의보다 이쪽이 더 크다. 경과 시간은 이 단서와 함께 적고 판정에는 넣지 않는다.
- 주의 도구는 창을 재지 생각을 재지 않는다. 손 타이머가 교차 확인이다.

## 11. 결과

본 실행 전까지 비어 있다. 이슈마다 한 줄, 실행 기록에서 채운다. 시간은 분, 토큰은 FUEL 단위.

| 이슈 키 | 층 | 팔 순서 | Active(분) atc / solo | Tethered(분) atc / solo | Away(분) atc / solo | merge-ready까지 atc / solo | 고쳐 하기 atc / solo | Claude 토큰 atc / solo | Codex 리뷰 atc / solo | P0 / P1 / P2, Claude 리뷰어 atc / solo | P0 / P1 / P2, Codex 리뷰어 atc / solo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

합계 줄(합, solo 대비 비율, 6절 판정)은 표가 다 찬 뒤에 더한다.

## 12. 개정

| 날짜 | 바뀐 것 | 이유 | 첫 본 실행 전/후 |
|---|---|---|---|
| 2026-10-03 | ATC-459에서 PROTOCOL 작성 | B1 (ATC-462) | 전 |
| 2026-10-03 | solo 팔을 Claude Code 클라우드 세션에서 돌린다. solo PR은 Draft로 연다. 파일럿 점검표와 한계를 고침 | ATC-462 승인 뒤의 결정 (ATC-474) | 전 |
