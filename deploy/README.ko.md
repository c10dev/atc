# deploy — systemd 사용자 서비스

[English](README.md) · **한국어**

`atc.service`는 Claude Code·Codex 세션이 도는 머신에서 atc를 상시 실행하는 **systemd 사용자 서비스**다. 웹 화면과 API를 `127.0.0.1:7700`에서 제공한다.

## 유닛이 하는 일

| 줄 | 효과 |
|---|---|
| `WorkingDirectory=/home/c10/projects/atc` | 저장소 체크아웃에서 실행 |
| `Environment="PATH=…/node/v24.19.0/bin:…"` | 사용자 서비스는 셸 프로필을 읽지 않으므로 nvm으로 설치한 Node 24를 PATH에 넣는다 |
| `ExecStartPre=… node --run build` | 시작할 때마다 웹 화면을 새로 빌드(`vite build`)한다. 화면을 고친 뒤 재시작만 하면 반영된다 |
| `ExecStart=… node server/index.ts` | 서버 시작(Node가 TypeScript를 바로 실행) |
| `Restart=on-failure`, `RestartSec=5` | 죽으면 5초 뒤 다시 시작 |
| `WantedBy=default.target` | 사용자 세션과 함께 시작 |

경로는 이 머신 기준이다. 다른 머신에서는 `WorkingDirectory`, `PATH`의 node 경로, `ExecStartPre`, `ExecStart`를 자기 것으로 바꾼다(`which node`가 Node 24 이상이어야 한다).

## 설치

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # 지금 시작 + 로그인 시 자동 시작
```

사용자 서비스는 로그아웃하면 멈춘다. 로그인 세션 없이도 계속 돌게 하려면(SSH로만 들어가는 서버 등):

```bash
loginctl enable-linger "$USER"
```

## 운용

```bash
systemctl --user restart atc          # 코드 수정 후 (화면 다시 빌드)
systemctl --user status atc
journalctl --user -u atc -f           # 로그
systemctl --user disable --now atc    # 멈추고 자동 시작에서 빼기
```

`atc.service` 자체를 고쳤으면 다시 복사하고 `systemctl --user daemon-reload`한 뒤 재시작한다.

## 설정

서버가 저장소 루트의 `.env.local`을 직접 읽는다(`.env.example` 참고). 유닛에 `EnvironmentFile`은 필요 없다.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `ATC_PORT` | `7700` | 포트(항상 `127.0.0.1`에만 연다) |
| `LINEAR_API_KEY` | — | Linear 개인 API 키. 없으면 브랜치 이름에서 찾은 티켓만 보인다 |
| `LINEAR_TEAM_KEY` | `VOC` | 주 Linear 팀 키(S2의 새 이슈, NETWORK의 프로젝트 목표가 이 팀을 쓴다) |
| `LINEAR_TEAM_KEYS` | 주 팀 | 읽을 Linear 팀 전부. 쉼표로 구분(예: `VOC,ATC`). 주 팀이 언제나 맨 앞. DISPATCH·SCHEDULE 후보는 `dispatch.json`의 `candidateTeams`에 든 팀만(기본: 주 팀). 나머지는 보여 주기만 |
| `ATC_PROJECTS_DIR` | `~/projects` | git 저장소를 AIRPORT로 자동 개설하는 폴더 |
| `ATC_STATE_DIR` | `~/.local/state/atc` | 점유, AIRPORT 등록부, CLEARANCE, FLIGHT RECORDER |
| `ATC_CLAIM_TTL_MIN` | `180` | 마지막 접촉 뒤 점유가 끝나는 시간(분) |
| `ATC_HANDOFF_GRACE_MIN` | `5` | HANDOFF·충돌 판정 기준 시간(분) |

LANDING SEQUENCE는 GitHub CLI로 열린 PR을 읽는다. 서비스를 돌리는 사용자에게 `gh`가 설치되어 로그인되어 있어야 한다(`gh auth status`). 없으면 PR이 빠지고 오류가 스냅샷의 `github` 필드에 뜬다. `ATC_LANDING_STATE`는 더 이상 읽지 않는다. `.env.local`에 남은 줄은 아무 일도 하지 않는다.

## 다른 컴퓨터에서 접속

서버는 localhost에만 열린다. SSH 터널로 들어간다.

```bash
ssh -L 7700:localhost:7700 <host>
```

그다음 `http://localhost:7700`을 연다.
