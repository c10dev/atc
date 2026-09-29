# 배포하기

atc를 고친 PR을 머지한 뒤 운영 서비스(7700)에 반영하는 방법이다. 평소에는 화면 상단의 **UPDATE 막대**를 누르면 된다.

## UPDATE 막대

서비스가 `origin/main`보다 뒤이면 콘솔 바로 아래에 막대가 뜬다.

`업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`

- `c0ca22e → 4678e03`: 지금 도는 커밋과 배포할 커밋. `PR 2`를 누르면 그 사이에 머지된 PR 목록이 펼쳐진다.
- `CI ✓`: main의 CI(`check`)가 통과했다. 진행 중이면 막대가 "업데이트 대기"로 바뀌고 버튼이 없다. 통과하면 저절로 버튼이 나온다.
- **[업데이트]**를 누르면 MCC가 쓰는 것과 같은 `atc-rts` 유닛이 시작한다(MCC 모드와 상관없다. `shadow`여도 된다). 유닛은 본 체크아웃을 fast-forward하고 서비스를 재시작하고 상태를 확인한다.

막대는 진행을 그대로 보인다.

| 막대 | 뜻 |
|---|---|
| 업데이트 시작하는 중… / 업데이트 중 | 유닛이 도는 중 |
| **재시작 중** | 서비스가 꺼졌다 켜지는 몇 초. 우상단 LINK도 "끊김"이 아니라 "재시작"으로 보인다 |
| 새 버전이 배포됨 · 새로고침 | 재시작이 끝났다. 새로고침하면 새 화면(기존 새 버전 알림) |
| 업데이트 완료 | 화면 번들이 안 바뀐 배포(서버만 고친 경우). 닫으면 된다 |
| 업데이트 거절됨 · 사유 | 유닛이 시작하지 않았다(예: 본 체크아웃에 커밋하지 않은 변경). 사유를 고치고 **다시 시도** |
| 업데이트 실패 · 사유 | 재시작 뒤 상태 확인을 통과하지 못했다. 유닛이 ROLLBACK을 했으면 아래 |
| **RTS 중지 — ROLLBACK 뒤** | 직전 커밋으로 되돌렸다. 원인을 본 뒤 설정 창 AGENTS 탭의 MCC 줄에서 모드를 다시 고르면 풀린다 |

## 사람이 배포할 때

막대가 버튼 대신 "사람이 배포" 사유를 보이면 손으로 한다. 그 범위(서비스 커밋 ~ `origin/main`)가 RTS가 하지 않는 것을 바꿨기 때문이다.

- `package.json`·`package-lock.json`이 바뀜: `npm ci`가 필요하다.
- `deploy/*.service`·`deploy/*.timer`가 바뀜: 유닛을 다시 읽어야 한다(`systemctl --user daemon-reload`).

```bash
cd /home/c10/projects/atc
git fetch origin && git merge --ff-only origin/main
npm ci                                  # package*.json이 바뀐 경우
cp deploy/*.service ~/.config/systemd/user/ && systemctl --user daemon-reload   # 유닛이 바뀐 경우
npx vite build && systemctl --user restart atc
```

그 밖에 손으로 하는 경우: 본 체크아웃이 `main`이 아니거나 깨끗하지 않을 때(먼저 정리한다), 막대가 안 뜰 때(MCC AIRPORT의 GitHub을 아직 못 읽음, 90초쯤 기다린다).

## 시험 서버

7700이 아닌 포트나 임시 상태 폴더로 띄운 atc(시험 서버)는 막대가 "사람이 배포"로 보이고 [업데이트]를 눌러도 시작하지 않는다. `atc-rts`가 운영 7700을 배포하는 유닛이기 때문이다.
