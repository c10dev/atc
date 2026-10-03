# 배포하기

atc를 고친 PR을 머지한 뒤 운영 서비스(7700)에 반영하는 방법이다. 평소에는 화면 상단의 **UPDATE 막대**를 누르면 된다.

## user 등급 PR 머지하기

`auto`·`flagged` 등급 PR은 CI와 MCC INSPECTION이 통과하면 MCC가 착륙시킨다. **`user` 등급 PR**(guard, `.claude/` 설정, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`를 바꾸거나 MCC가 ESCALATE한 PR)은 사용자가 머지한다. MCC가 PR을 ESCALATE하면 그 head를 본 것으로 세므로(P0·P1이 있으면 지적도 남긴다), PR은 "MCC INSPECTION 대기"가 아니라 사용자가 머지할 CLEARED로 보이고 SUPERVISOR QUEUE의 LANDING과 PR 서랍의 MERGE에 오른다. head가 바뀌면 MCC가 새 head를 다시 본다. ESCALATE는 PR에 남는다. 이제 GitHub로 가지 않고 atc 안에서 할 수 있다.

1. STRIPS의 LANDING SEQUENCE 등에서 PR 번호(`#300`)를 눌러 **PR 서랍**을 연다([화면 안내](screens.md)).
2. `착륙`이 CLEARED이고 등급이 user이면 `MERGE` 줄에 `MERGE…` 버튼이 있다. 등급, 체크, 본문, 바뀐 파일을 서랍에서 확인한다(diff 검토는 GitHub에서 한다).
3. `MERGE…`를 누르면 등급·head·머지 방식이 보이고 [머지 확인]을 한 번 더 누른다. head가 그사이 움직였으면 머지하지 않고 새 head를 알려 주니, 서랍을 다시 열어 확인한다.
4. 머지한 뒤에는 아래 UPDATE 막대로 배포한다(MCC가 `land+rts`이면 MCC가 시작할 수도 있다).

이 버튼은 user 등급 PR만 머지한다. auto-merge는 켜지 않고, 머지 방식은 AIRPORT의 것(atc 저장소는 merge 커밋)이다. GitHub 화면에서 머지해도 전과 같다.

### 발권 때 승인한 K 효과 안의 user 등급 PR은 MCC가 착륙시킵니다

K3 효과(guard, hook, `.claude/` …)를 고치는 FLIGHT는 **발권할 때 한 번** 승인합니다([RELEASE 화면](screens.md)). 이슈 본문 `## K effects`에 `K3[Security Weaken]: <바꾸는 통제> | files: <경로, …>` 줄로 선언해 두고, RELEASE 화면에서 그 선언을 보고 발권(화면 클릭·DUTY 채팅 `RELEASE ATC-n`)하면, 그 선언한 파일 안에서 만든 `user` 등급 PR은 **머지 때 사람 단계 없이** INSPECTION `pass`와 CI 뒤 MCC가 착륙시킵니다(ATC-391). 그 PR에는 위 `MERGE…` 버튼을 누를 필요가 없습니다. 반대로 이런 PR은 계속 사용자 몫이고, PR 서랍과 MCC의 `blocks`에 이유가 보입니다:

- 선언하지 않은 `user` 등급 파일을 바꿨다(새 화살: 선언을 고쳐 다시 발권), 마이그레이션·비밀 경로를 바꿨다.
- MCC가 의심으로 ESCALATE했거나 P0·P1 지적이 있다.
- 이 검사 자체(`server/mcc*.ts`, `k-approval.ts`, `release*.ts`, `deploy/`, `mcc/` …)를 바꾸는 PR.
- 발권이 없거나, 발권 뒤에 이슈 본문이 바뀌었다.
- 발권이 **attested뿐**이다(다른 세션이 "SUPERVISOR가 말했다"고 증언한 것): RELEASE 화면의 **K 효과 확인**에 뜨고, 클릭 한 번으로 K 권한을 줍니다. 이 클릭도 발권 때의 일입니다.

설정 창 AUTOMATION → MCC의 **K APPROVAL**이 이 길의 스위치입니다(기본 `on`, `off`면 전처럼 모든 `user` PR을 사용자가 머지). 그 아래에 최근 7일 날짜별로 이렇게 착륙한 PR 수와, 그 가운데 자동 되돌림 PR이 열린 수·ROLLBACK이 난 수가 보입니다. 이렇게 착륙한 PR은 `mcc.jsonl`의 `land` 줄에 발권 id(`<FLIGHT>@<해시>`)가 남습니다.

**REMOVAL GUARD**(같은 MCC 블록, 기본 `on`): 작업 지시서가 이름 붙이지 않은 기능(화면 구역·뷰·버튼·화면이 그리는 필드)을 지우는 PR은 MCC가 ESCALATE해 당신이 머지합니다(사유는 `removes <무엇>, not named in the work order`). PR 본문에는 지운 것을 적는 `Removed:` 줄(없으면 `Removed: none`)이 있어야 하고, 없거나 diff와 다르면 P1입니다. 스위치 아래에 지우기 ESCALATE 전체 수·최근 7일 수와, 그 가운데 당신이 같은 head 그대로 착륙시킨 수(오작동)가 보입니다. `off`면 MCC는 지우기 때문에 ESCALATE하지 않고 `Removed:` 줄도 따지지 않습니다. 팀에게는 기능을 지키거나 BLOCKED로 보고하라는 규칙이 그대로 있습니다.

## UPDATE 막대

서비스가 `origin/main`보다 뒤이면 콘솔 바로 아래에 막대가 뜬다.

`업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`

- `c0ca22e → 4678e03`: 지금 도는 커밋과 배포할 커밋. `PR 2`를 누르면 그 사이에 머지된 PR 목록이 펼쳐진다.
- `CI ✓`: main의 CI(`check`)가 통과했다. 진행 중이면 막대가 "업데이트 대기"로 바뀌고 버튼이 없다. 통과하면 저절로 버튼이 나온다.
- **[업데이트]**를 누르면 MCC가 쓰는 것과 같은 `atc-rts` 유닛이 시작한다(MCC 모드와 상관없다. `shadow`여도 된다). 유닛은 본 체크아웃을 fast-forward하고 서비스를 재시작하고 상태를 확인한다.

MCC 모드가 `rts`나 `land+rts`이면 서버가 할 때(main CI 통과, 5분 간격, ROLLBACK으로 멈추지 않음)에 스스로 같은 유닛을 시작한다. `rts`에서는 MCC가 착륙하지 않고 사용자가 머지한 main을 서버가 배포한다. 이 모드에서는 막대에 `자동 배포 켜짐`이 붙고, 5분 간격을 기다리는 중이면 `다음 15:42`처럼 시각이 붙는다. 의존성(`package*.json`)이나 유닛 파일을 바꾼 범위는 자동으로 배포하지 않고 막대가 "사람이 배포"로 보인다. 같은 main에 유닛이 거절·실패했으면 자동 배포가 그 main에서 멈추니 사유를 고치고 **[업데이트]**로 다시 시도한다. [업데이트]는 자동 배포 중에도 그대로 된다.

막대는 진행을 그대로 보인다.

| 막대 | 뜻 |
|---|---|
| 업데이트 시작하는 중… / 업데이트 중 | 유닛이 도는 중 |
| **재시작 중** | 서비스가 꺼졌다 켜지는 몇 초. 우상단 LINK도 "끊김"이 아니라 "재시작"으로 보인다 |
| 새 버전이 배포됨 · 새로고침 | 재시작이 끝났다. 새로고침하면 새 화면(기존 새 버전 알림) |
| 업데이트 완료 | 화면 번들이 안 바뀐 배포(서버만 고친 경우). 닫으면 된다 |
| 업데이트 거절됨 · 사유 | 유닛이 시작하지 않았다(예: 본 체크아웃에 커밋하지 않은 변경). 사유를 고치고 **다시 시도** |
| 업데이트 실패 · 사유 | 재시작 뒤 상태 확인을 통과하지 못했다. 유닛이 ROLLBACK을 했으면 아래 |
| **RTS 중지 — ROLLBACK 뒤** | 직전 커밋으로 되돌렸다. 원인을 본 뒤 설정 창 AUTOMATION → LANDING의 MCC 줄에서 모드를 다시 고르면 풀린다 |

## main이 빨개지면: 자동 되돌림(AUTO REVERT)

MCC나 AUTOLAND가 머지한 PR 때문에 main의 CI가 빨개지면 atc가 그 머지의 **revert PR을 스스로 연다**(ATC-351·394, [autonomy.md](../autonomy.md) "C4 구현 결과"). 처음부터 켜져 있다. 사람이 할 일은 보통 없다.

- **flake는 되돌리지 않는다.** 되돌리기 전에 실패한 GitHub Actions run을 같은 head에서 **한 번 다시 돌린다.** 다시 돌려 초록이면 flake라서 아무것도 하지 않고 "flake 잡음"으로만 센다. 다시 빨갛고 그 PR 자신의 head가 머지 전에 초록이었을 때만 revert PR을 연다. 다시 돌릴 수 없는 체크(Actions가 아님)나 45분 안에 안 끝나는 재실행은 짐작하지 않고 DUTY에게 알린다(`hold`).
- **revert PR은 보통 PR처럼 리뷰와 CI를 거쳐** 착륙한다(GROUND STOP이 걸려 있어도 이 PR만은 막지 않는다). 다음 초록 head가 GROUND STOP을 푼다. 되돌린 PR의 FLIGHT를 난 AIRCRAFT에게 FIX가 간다.
- **하지 않는 것.** 사람이 머지한 커밋이 범위에 있거나, 마이그레이션(K1)이나 user 등급 경로(K3)를 고친 PR이면 되돌리지 않고 DUTY brief에 `AUTO-REVERT HOLD` 줄을 남긴다.
- **멈춤(breaker).** 1시간 안에 새 빨간 head가 둘째로 나오면 레인이 멈추고 AUTOLAND `merge`는 `update`로, MCC 착륙은 끔으로 내려간다. 알림(ALERTS)에 `revert|stop`이 뜬다. 설정 창 AUTOMATION → LANDING의 **AUTO REVERT**에서 스위치를 다시 고르면(같은 값을 다시 골라도) 풀린다. AUTOLAND와 MCC를 다시 올리는 것은 SUPERVISOR의 스위치다.
- **끄기.** 같은 줄의 스위치를 `off`로 두면 atc는 되돌리지 않고 GROUND STOP과 MCC 멈춤은 사람이 읽고 푼다.
- **결과 읽기.** AUTO REVERT 줄 아래에 최근 7일의 날짜별 `revert`·`flake 잡음`·`misfire`가 보인다. misfire는 되돌린 PR이 24시간 안에 그대로 다시 머지된 것이다(revert의 revert, 또는 같은 파일): 되돌림이 틀렸다는 신호이니 DUTY brief의 `AUTO-REVERT misfire` 줄을 본다.

## 사람이 배포할 때

막대가 버튼 대신 "사람이 배포" 사유를 보이면 손으로 한다. 그 범위(서비스 커밋 ~ `origin/main`)가 RTS가 하지 않는 것을 바꿨기 때문이다.

- `package.json`·`package-lock.json`의 **의존성**이 바뀜(`dependencies`·`devDependencies`·`overrides`·`engines`, 잠금 파일의 패키지 항목): `npm ci`가 필요하다. `license`·`description`·`scripts`·`version`만 바뀐 경우는 아니라서 RTS가 그대로 배포한다. 파일을 읽지 못하면 안전하게 사람이 배포한다.
- `deploy/*.service`·`deploy/*.timer`가 바뀜: 유닛을 다시 읽어야 한다(`systemctl --user daemon-reload`).

```bash
cd /home/c10/projects/atc
git fetch origin && git merge --ff-only origin/main
npm ci                                  # package*.json이 바뀐 경우
cp deploy/*.service ~/.config/systemd/user/ && systemctl --user daemon-reload   # 유닛이 바뀐 경우
npx vite build && systemctl --user restart atc
```

손으로 `git merge --ff-only origin/main`만 해 두었다면(본 체크아웃이 `main`이고 깨끗하고 HEAD가 `origin/main`) 막대의 **[다시 시도]**(또는 [업데이트])가 그대로 된다. 유닛이 재시작만 하고, 범위를 다시 거절하지 않는다. 진짜 의존성이 바뀐 범위만 `npm ci`가 필요하다.

그 밖에 손으로 하는 경우: 본 체크아웃이 `main`이 아니거나 깨끗하지 않을 때(먼저 정리한다), 막대가 안 뜰 때(MCC AIRPORT의 GitHub을 아직 못 읽음, 90초쯤 기다린다).

## 시험 서버

7700이 아닌 포트나 임시 상태 폴더로 띄운 atc(시험 서버)는 막대가 "사람이 배포"로 보이고 [업데이트]를 눌러도 시작하지 않는다. `atc-rts`가 운영 7700을 배포하는 유닛이기 때문이다.
