# SELF-LANDING 설계 (초안)

[English](self-landing.md) · **한국어**

atc가 자기 PR을 머지하고 배포한다. AUTOLAND([occ.ko.md](occ.ko.md) 9.7)는 다른 저장소(vocado, AIRPORT `VCDO`)의 PR을 착륙시키고, 머지한 뒤에는 아무것도 하지 않는다. SELF-LANDING은 atc 저장소(AIRPORT `ATCC`)의 PR을 착륙시킨다. 이 머지는 관제 코드 자체를 바꾼다. 그래서 머지 뒤에 배포(서비스 체크아웃 fast-forward, 서비스 재시작), 상태 확인, 새 빌드가 깨졌을 때 되돌아갈 길이 함께 있어야 한다.

> 상태: 1·2단계 만듦(그림자, 2026-09-28). SUPERVISOR가 다섯 제안을 모두 받아들였다(끝의 "결정"). 3~5단계는 아직.

관련: [occ.ko.md](occ.ko.md) 9(CLEARED TO LAND, AUTOLAND, 외부 리뷰), `deploy/landing-tier.mjs`(LANDING CLEARANCE 등급), 루트 `CLAUDE.md` "git과 PR"(누가 무엇을 머지하나), [fleet.ko.md](fleet.ko.md) 8.6–8.7(이 설계가 가져다 쓰는 그림자 → 승인 운용 방식).

## 1. 지금 사실(2026-09-28)

| 사실 | 값 |
|---|---|
| atc PR이 지금 착륙하는 방식 | 팀 세션이 PR을 연다. structure 세션이 착륙 skill을 돌린다: `review.sh`(정확한 head의 분리 worktree에서 `npm test`, tsc, vite build, 등급, CI `check`, 머지 가능, draft 아님), 그리고 diff를 직접 읽는다. `READY (auto\|flagged)`면 `gh pr merge --merge --match-head-commit <sha>`, 이어서 `deploy.sh`, `sync.sh`(열린 다른 PR의 충돌). `user` 등급은 사용자가 머지한다. 이 skill은 저장소 밖에 있다 |
| `deploy.sh` | 서비스 체크아웃에 수정이 있으면 멈추고, `git merge --ff-only origin/main`, `systemctl --user restart atc`, `GET /api/version`을 20초까지 기다린 뒤 head를 찍는다. 되돌리기는 없다 |
| 서비스 | systemd user unit `atc`(`deploy/atc.service`): `ExecStartPre`가 화면을 빌드하고(`node --run build`), `ExecStart`가 `node server/index.ts`를 돌린다. `Restart=on-failure`, 5초 뒤 |
| `main` 브랜치 보호 | 필수 체크 `check`(CI: npm test, tsc, vite build, 등급 요약), `strict: false`(PR이 main 최신이 아니어도 된다) |
| 2026-09-25 이후 머지 | 60건, 모두 소유자 계정(structure 세션이나 사용자)이 머지했다. 등급별로 `auto` 29, `flagged` 16, `user` 15. 되돌린 PR은 없다 |
| atc PR의 CLEARED TO LAND | 한 번도 되지 않는다. atc PR은 모두 `APPROACH`, `no-review`다. Codex는 이 저장소를 리뷰하지 않고, 외부 리뷰(DeepSeek REVIEW)는 FLIGHT 없는 PR을 빼는데 atc PR은 대부분 FLIGHT 없음(AD HOC)이다 |
| AUTOLAND | `mode: merge`, `airports: ["VCDO"]`. 설정 주석에 atc 자신의 착륙은 범위 밖이라고 적혀 있다 |
| 공개 저장소 | 누구나 fork에서 PR을 열 수 있다 |

## 2. AUTOLAND와 무엇이 다른가

| | AUTOLAND (VCDO) | SELF-LANDING (ATCC) |
|---|---|---|
| 머지하는 것 | 다른 저장소의 제품 코드 | 관제 코드 자신 |
| 머지 근거 | CLEARED TO LAND: CI, head에 Codex나 DeepSeek 리뷰, 지적 없음 | CI, structure의 확인을 기계로, 리뷰(결정 2) |
| 맡기는 범위 | CLEARED 중 제외 목록(FLIGHT 없음, SEC·Risk, 보안 경로, Human Preview)에 안 걸리는 것 | LANDING CLEARANCE 등급 `auto`(결정 3) 중 제외 목록(4장)에 안 걸리는 것 |
| 머지 뒤 | 없음 | 배포, 상태 확인, 실패하면 되돌리기 |
| 깨졌을 때 | vocado main이 빨개진다. atc가 보고 GROUND STOP을 건다 | 깨진 것이 착륙시키는 쪽 자신일 수 있다. 되돌리는 길이 atc 서버에 기대면 안 된다 |
| 순서 | AIRPORT마다 90초에 한 동작 | PR 하나씩, 배포한 빌드가 정상인 것을 본 뒤에 다음 |

## 3. 원칙

1. **착륙시키는 쪽(lander)은 서버 밖에 둔다.** 자체 systemd 타이머(`atc-lander`)가 돌리는 작은 스크립트가 머지, 배포, 상태 확인, 되돌리기를 한다. atc 서버는 lander가 한 일을 보여 주기만 한다. 서버 빌드가 깨져도 lander는 되돌릴 수 있다. lander는 `user` 등급인 `deploy/`에 있으므로 SELF-LANDING이 자기 규칙을 바꿀 수 없다.
2. **structure와 같은 확인을 머지 결과에 한다.** lander는 분리 worktree에서 `origin/main`에 PR head를 합친 것을 만들고 거기서 `npm test`, tsc, vite build를 돌린다. `strict`가 꺼져 있어서 head만 시험하면 main과의 의미 충돌을 놓칠 수 있다.
3. **정확한 head에 리뷰가 있어야 한다**(출처는 결정 2). 리뷰가 없으면 머지하지 않는다. CLEARED TO LAND와 같은 규칙이다.
4. **좁게 맡긴다.** 처음에는 `auto` 등급만 맡는다. `flagged`(관제 세션 매뉴얼)와 `user`는 structure와 사용자에게 남긴다.
5. **배포까지가 착륙이다.** 새 빌드가 돌아야 머지가 끝난 것이다. 서비스가 다시 뜨고, `/api/version`이 새 빌드를 알리고, 기본 호출에 응답해야 한다. 아니면 lander가 서비스를 되돌리고 멈춘다(SELF-LANDING GROUND STOP).
6. **한 번에 하나, 조용할 때만.** 주기마다 PR 하나를 처리한다. FLEET PLAN 승인이 실행 중이거나 AUTOLAND 갱신이 진행 중이면 하지 않고, 같은 head를 두 번 처리하지 않는다.
7. **그림자부터.** DISPATCH·SCHEDULE·FLEET PLAN처럼 lander도 처음에는 할 일을 기록만 하고, structure와 사용자가 실제로 한 일과 나란히 둔다.

## 4. 맡기는 범위와 제외

다음을 모두 만족하는 PR을 맡는다.

- base가 `main`이고, head 브랜치가 `chaehy5665/atc` 안에 있고(fork는 절대 안 됨), 소유자 계정이 열었고, draft가 아니고, `hold` 라벨이 없다.
- 등급이 `auto`다(merge-base 기준 diff에 `deploy/landing-tier.mjs`).
- head에서 CI `check`가 통과했다.
- 머지 결과에 대한 로컬 확인(원칙 2)이 통과했다.
- 정확한 head에 P0·P1 지적 없는 리뷰가 있다(결정 2).
- 아래 제외에 걸리지 않는다.

등급과 상관없이 제외한다.

| 제외 | 이유 |
|---|---|
| 착륙·머지 판단: `server/landing*.ts`, `server/autoland*.ts`, `server/origin.ts`, `server/settings.ts`, `server/fleet-plan*.ts`, `server/session-control.ts` | 머지, 스위치, 세션 조종을 정하는 코드다. 여기서 실수하면 자기 권한을 넓힌다 |
| 운영 상태 형식: 상태 폴더 아래 파일을 새로 만들거나 이름을 바꾸는 diff, 추가만 하는 기록의 줄 모양(`*Op`·`RecordLine` 타입)을 바꾸는 diff | 루트 `CLAUDE.md`가 이런 PR을 사용자에게 올리게 한다. 되돌리기 어렵다 |
| PR 본문의 `SELF-LANDING: no` | 작성자가 사람에게 남기고 싶은 PR |
| 바뀐 줄이 1,500줄 넘음 | 모델 리뷰만으로 읽기에는 크다 |

## 5. 한 주기

`atc-lander` 타이머가 5분마다 돈다(`deploy/lander.sh`, 판단은 순수 함수 `deploy/lander.mjs`와 테스트).

1. **멈춤이 걸려 있나?** `~/.local/state/atc/self-landing.json`에 GROUND STOP이 있으면 아무것도 하지 않는다.
2. **모드.** `off`는 아무것도 안 하고, `shadow`는 기록만, `merge`는 실행한다(같은 파일, SUPERVISOR가 정함).
3. **조용한가?** FLEET PLAN에 `executing` 제안이 있거나 AUTOLAND 갱신이 진행 중이면 이번 주기는 넘어간다(`GET /api/fleet/plan`, `GET /api/autoland`의 `state.inflight`. 서버가 답하지 않아도 넘어간다).
4. **고르기.** 맡는 PR 중 가장 오래된 것. 실행 직전에 head를 다시 읽는다.
5. **확인.** `origin/main`에 head를 합친 분리 worktree에서 테스트, tsc, 빌드.
6. **그림자:** `{op: "would-merge" | "would-skip", pr, head, reasons}`를 적고 여기서 끝.
7. **머지**(`merge` 모드): `PUT /pulls/{n}/merge`, `sha`는 확인한 head, `merge_method: merge`. `--match-head-commit`의 REST 형태다. GitHub auto-merge는 쓰지 않는다.
8. **배포:**
   1. 지금 도는 빌드(`/api/version`)를 적어 둔다.
   2. 서비스 체크아웃에서 `git merge --ff-only`, 그리고 `systemctl --user restart atc`.
9. **상태 확인.** 60초 안에 아래를 모두 만족하고, 5분 뒤에도 unit이 다시 재시작되지 않았어야 한다(`NRestarts`가 그대로).
   - `systemctl is-active`가 `active`다.
   - `/api/version`이 새 `build`와 더 늦은 `startedAt`으로 답한다.
   - `GET /api/snapshot`, `/api/fleet`, `/api/fleet/plan`이 200으로 답한다.
10. **되돌리기.** 상태 확인이 실패하면:
    1. 서비스 체크아웃을 `git reset --hard <이전 head>`로 돌리고 재시작한 뒤 다시 확인한다.
    2. PR, 이유, 로그와 함께 GROUND STOP을 건다.
    3. 사용자에게 `Revert "…"` PR을 main으로 연다.
    4. `rollback`을 적는다.
11. **기록.** 단계마다 `~/.local/state/atc/self-landing.jsonl`(추가만)에 한 줄씩 남기고, 머지와 되돌리기는 FLIGHT RECORDER(`kind: "self-landing"`)에도 남긴다. LANDING SEQUENCE 머리에 ATCC 줄로 lander의 상태를 보인다. AUTOLAND가 VCDO 줄을 보이는 것과 같다.

## 6. 구현 순서

**만든 것(1·2단계, 그림자, 2026-09-28).** `deploy/lander.mjs`(순수 판단과 입출력, 테스트는 `deploy/lander.test.mjs`), `deploy/atc-lander.service`·`.timer`, `server/self-landing.ts`(`GET /api/self-landing`), STRIPS 탭 LANDING SEQUENCE 머리의 SELF-LANDING 줄. 만들면서 이렇게 정했다.

- **모드.** 상태 파일이 없으면 `shadow`다. `merge`는 아직 없어서 그림자로 돈다.
- **head마다 한 번.** head는 한 번만 판정한다. PR이 끝나면 `outcome` 줄에 `merged-as-is`(판정한 head 그대로 머지), `merged-changed`, `closed`를 적는다.
- **로컬 확인**은 리뷰 말고는 걸린 것이 없을 때만 한다. `readyExceptReview`는 사유가 리뷰 없음 하나뿐인 `would-skip`이라, 3단계 전에도 그림자 데이터가 쓸모 있다.
- **게이트 셈.**
  - 맞음: `would-merge`인데 그대로 머지됐거나, `would-skip`인데 닫혔거나 바뀐 뒤 머지됐거나 `auto` 등급이 아닌 것.
  - 거절: 닫혔거나 바뀐 PR에 `would-merge`.
- **리뷰.** 지금 lander는 착륙 리뷰 기록(`landing-reviews.jsonl`)만 센다. atc PR은 3단계 전까지 이 기록이 없어서, 그때까지는 모든 판정이 `would-skip`이다.
- **2026-09-28 첫 실행:** #105(문서)는 리뷰 없음 하나로 `would-skip`이었다. 머지 결과의 로컬 확인은 10초 만에 통과했고 남긴 것이 없었다.

1. ✅ `deploy/lander.mjs`: 순수 판단(맡는 범위, 제외, 다음 동작)과 테스트. 그림자 기록만.
2. ✅ `atc-lander` systemd 서비스와 타이머(`deploy/lander.mjs`를 바로 돌린다. `lander.sh`는 두지 않음), 상태 파일과 기록, LANDING SEQUENCE 머리의 ATCC 줄.
3. atc PR의 리뷰 출처(결정 2).
4. 상태 확인과 되돌리기. 먼저 7702 시험 인스턴스에 일부러 깨뜨린 빌드로 시험한다.
5. 그림자 게이트(결정 5)를 넘은 뒤 스위치 뒤의 `merge` 모드.
6. 나중에 따로: `flagged` 등급.

1·2·4·5단계는 `deploy/`를 바꾸므로 그 PR은 `user` 등급이다.

## 7. 위험

| 위험 | 막는 법 |
|---|---|
| 잘못된 머지가 관제를 깨뜨림 | 5분 감시가 붙은 상태 확인, 서버 밖 lander의 되돌리기, 풀기 전까지 남는 GROUND STOP |
| SELF-LANDING이 자기 권한을 넓힘 | lander와 등급 규칙은 `deploy/`(`user` 등급)에 있고, 착륙·스위치 코드는 제외(4장) |
| 공개 저장소의 fork PR | 이 저장소 안의 브랜치, 소유자 계정만 |
| CI가 돈 뒤 main이 움직임(`strict` 꺼짐) | head만이 아니라 머지 결과로 로컬 확인 |
| 재시작이 진행 중인 일을 끊음 | 조용한 때만(FLEET PLAN 실행 중, AUTOLAND 진행 중이면 넘어감), 주기마다 PR 하나 |
| 되돌린 뒤 누가 `deploy.sh`를 손으로 돌림 | 서비스가 깨진 head로 돌아간다. GROUND STOP 메시지가 revert PR부터 머지하라고 알린다. `deploy.sh`도 멈춤이 걸려 있으면 거절해야 한다(skill의 `user` 등급 변경) |
| 사람이라면 잡았을 것을 모델 리뷰가 놓침 | `auto` 등급만, 크기 제한, `merge` 전에 structure 판단과 그림자 비교 |
| 바뀌는 속도 | 최근 머지 60건 중 29건이 `auto`였다. 하루 열 건 안팎이 structure 없이 착륙하게 된다 |

## 8. 결정(2026-09-28, SUPERVISOR: 모두 제안대로)

1. **lander를 어디서 돌리나.** 결정: `deploy/`의 별도 systemd 타이머와 스크립트, atc 서버 밖. 대안: 서버 안, AUTOLAND 옆(더 단순하지만 깨진 빌드가 자기를 되돌리지 못한다).
2. **atc PR의 리뷰 출처.** 결정: DeepSeek REVIEW 세션이 FLIGHT 없는 atc PR도 리뷰하고(공개 저장소라 기밀 때문에 뺄 이유가 없다), 정확한 head에 P0·P1 없는 통과가 있으면 인정한다. 대안: structure 세션이 자기 확인 뒤 GitHub 승인 리뷰를 남기고 lander는 머지와 배포만 자동화한다. 또는 리뷰 없이 CI와 로컬 확인만(제안하지 않음).
3. **범위.** 결정: `auto` 등급만. `flagged`는 그림자 데이터를 보고 나중에 정한다.
4. **배포가 실패하면.** 결정: 서비스를 이전 head로 되돌리고, GROUND STOP을 걸고, 사용자에게 revert PR을 연다. 대안: revert PR까지 스스로 머지한다.
5. **그림자 게이트.** 결정: lander의 `would-merge`·`would-skip`이 structure와 사용자가 실제로 한 일(그대로 머지 대 수정 요청·사람에게 남김)과 맞는 PR 20건, 합의 90% 이상, structure가 거절한 PR에 `would-merge`가 한 건도 없음.
