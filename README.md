# atc

로컬 관제 웹. 어떤 세션(팀)이 어떤 워크트리를 점유하고, 그 워크트리가 어떤 Linear 티켓을 처리 중인지 한 화면에 보여준다.

- 실행 위치: 이 머신(`/home/c10/projects/atc`), 포트 `7700`
- 접속(맥에서): `ssh -L 7700:localhost:7700 <host>` 후 `http://localhost:7700`
- 읽기 전용 관제가 기본이다. 워크트리 생성·삭제나 Linear 쓰기는 하지 않는다.

## 화면

| 화면 | 보여주는 것 |
|---|---|
| 레이더 (`#radar`) | 세션 ─ 워크트리 ─ 티켓 3열을 선으로 연결. 주인 없는 워크트리, 워크트리 없는 진행 티켓을 강조 |
| 운항 스트립 (`#strips`) | 세션(ALPHA…, Codex 세션)마다 카드 하나. 상태, 점유 중인 워크트리, 연결된 티켓 |
| 운항 정보판 (`#board`) | Linear 상태 열에 티켓 카드. 카드에 점유 팀 배지 |

## 용어

코드와 API는 왼쪽 이름을 쓰고, 화면은 항공 용어로 보여준다(`web/src/aviation.ts`).

| 코드 | 뜻 | 식별자 | 화면 표기 |
|---|---|---|---|
| `Session` | Claude Code / Codex 세션 하나 | `sessionId` | 항공기. `TEAM_A` → `ALPHA` (음성 알파벳) |
| `Workspace` | git worktree 하나 (본 체크아웃 포함) | 절대 경로 | 주기장 |
| `Ticket` | Linear 이슈 | `VOC-191` | 편명 `VOC191` (브랜치·PR에는 `VOC-191` 그대로) |
| `Claim` | 세션이 워크스페이스를 점유한다는 기록 | `sessionId` + 경로 | 주기장 점유. 기록 추정은 "추정 항적" |

| 상태 | 화면 표기 |
|---|---|
| 세션 busy / idle+점유 / idle / dead | 비행 중 / 체공 대기 / 주기 / 무선 두절 |
| Backlog / Todo | 운항 예정 / 비행계획 제출 |
| In Progress / In Review / Ready to Merge | 순항 / 접근 / 착륙 허가 |
| Done / Canceled / Duplicate | 도착 / 결항 / 합편 |

## 데이터 소스와 연결 키

```
Session ──claim──▶ Workspace ──branch──▶ Ticket
```

| 소스 | 위치 | 얻는 것 |
|---|---|---|
| Claude 세션 | `~/.claude/sessions/*.json` | pid, sessionId, cwd, name, status |
| Claude 기록 | `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` | 세션이 건드린 워크트리 경로 (추정용) |
| Codex 세션 | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex 세션과 cwd |
| git | 각 저장소 `git worktree list --porcelain` | 워크트리 경로, 브랜치, HEAD, dirty 여부 |
| Linear | GraphQL API (`LINEAR_API_KEY`) | 티켓 제목, 상태, 담당, URL |
| Claim | `~/.local/state/atc/claims/<sessionId>/*.json` | hook이 남긴 점유 기록 |

연결 규칙:

1. **Workspace → Ticket**: 브랜치 이름에서 `voc-(\d+)`를 뽑아 `VOC-n`. 디렉터리 이름은 쓰지 않는다(지금 이름이 제각각이라서).
2. **Session → Workspace**: hook 기록이 있으면 그것(`hook`). Codex는 세션 cwd(`cwd`). 둘 다 없으면 대화 기록에서 가장 최근에 언급된 워크트리(`transcript`, 점선으로 표시).
   팀 세션의 cwd는 모두 `vocado_nextjs` 본 디렉터리라 cwd로는 구분이 안 된다. 기록 추정은 한 세션이 여러 워크트리를 오가서 부정확하므로 Claim이 기준이다.

## 실행

```bash
npm install
npm run build && npm start      # http://localhost:7700 (web/dist 제공)
npm run dev                     # 개발: vite 7700 + API 서버 7701
npm run typecheck
npm test                        # 이양·충돌 판정 단위 테스트
```

상시 실행은 systemd 사용자 서비스로 한다.

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # 시작 + 부팅 시 자동 시작
systemctl --user restart atc          # 코드 수정 후 (빌드 포함)
journalctl --user -u atc -f           # 로그
```

`.env.local`에 `LINEAR_API_KEY`가 없으면 Linear 없이 브랜치에서 찾은 티켓만 보여준다.

## 점유 hook

`~/.claude/settings.json`의 `PostToolUse`(Edit·Write·MultiEdit·NotebookEdit·Bash, async)가 `hooks/claim.mjs`를 실행한다.

- Edit·Write의 파일 경로, Bash의 `cd <dir>`·`git -C <dir>` 대상, 세션 cwd를 보고 `.git`이 **파일**인 디렉터리(linked worktree)를 찾는다. 본 체크아웃은 기록하지 않는다.
- Bash에서 경로를 언급만 하는 명령(`ls`, `cat`, `grep` 등)은 점유로 치지 않는다. 그래서 리뷰어가 읽기만 해서는 점유가 생기지 않는다.
- `~/.local/state/atc/claims/<sessionId>/<인코딩된 경로>.json`을 처음 한 번 만들고 이후에는 mtime만 갱신한다. 동시 호출에도 안전하다.
- 마지막 갱신 뒤 `ATC_CLAIM_TTL_MIN`(기본 180분)이 지나면 점유가 끝난 것으로 본다.
- 점유 시작 시각(`since`)은 두 경우에 새로 시작한다. TTL이 지난 뒤 다시 건드릴 때, 그리고 내가 손을 뗀 뒤 다른 세션이 잡았던 워크트리를 되찾을 때(A → B → A).

## 관제 이양과 충돌

같은 워크트리를 여러 세션이 점유하면 `server/occupancy.ts`가 점유 구간 `[since, 마지막 접촉]`으로 판정한다. 기준 시간은 `ATC_HANDOFF_GRACE_MIN`(기본 5분)이다.

| 판정 | 조건 | 화면 |
|---|---|---|
| 관제 이양 | 앞 세션이 뒤 세션 시작 뒤로 5분 넘게 더 건드리지 않았고, 뒤 세션이 더 늦게까지 건드림 | 앞 세션 점유가 흐려지고 "→ CHARLIE 이양". 이양 목록에 표시. 경보 아님 |
| 분리 기준 위반(충돌) | 이양이 아니고, 살아 있는 두 세션의 점유 구간이 5분 넘게 겹침 | 경보 |
| 잠깐 들름 | 겹침이 5분 이하 | 둘 다 점유로 보이고 경보 없음 |

- 이양된 점유는 점유로 치지 않는다(티켓 배지, 체공 대기 판정, 주인 없는 주기장 판정에서 빠진다).
- 종료된 세션이라도 넘겨준 점유는 고아(무선 두절 점유)로 치지 않는다.
- 추정 항적(대화 기록 추정) 점유는 판정에 쓰지 않는다.
- hook을 끄려면 settings.json에서 해당 항목을 지우면 된다. 기록 폴더는 지워도 된다.

## 폴더 구조

```
atc/
├── hooks/claim.mjs         # PostToolUse hook (의존성 없음)
├── server/                 # Node 24 + Hono. 2초마다 스냅샷을 만들어 SSE로 푸시
│   ├── sources/
│   │   ├── claude.ts       # ~/.claude/sessions, hook 기록, 대화 기록 추정
│   │   ├── codex.ts        # ~/.codex/sessions (cwd로 점유)
│   │   ├── git.ts          # git worktree list, dirty, 마지막 커밋
│   │   └── linear.ts       # Linear GraphQL, 1분마다
│   ├── model.ts            # Session / Workspace / Ticket / Claim / Alert
│   ├── occupancy.ts        # 이양·충돌 판정 (occupancy.test.ts)
│   ├── snapshot.ts         # 소스 병합 + 경고 계산
│   └── index.ts            # /api/snapshot, /api/events
├── web/src/                # Vite + React. 연결 / 팀 / 티켓 화면
├── deploy/atc.service      # systemd 사용자 서비스
└── docs/naming.md
```

## 경고

| 종류 (`AlertKind`) | 화면 표기 | 조건 |
|---|---|---|
| `conflict` | 분리 기준 위반 | 살아 있는 두 세션이 같은 워크트리에서 5분 넘게 겹쳐 작업 (이양 제외) |
| `orphan` | 무선 두절 점유 | 종료된 세션이 넘겨주지 않은 점유가 TTL 안에 남아 있음 |
| `unattended` | 미식별 표적 | 변경 파일이 있는데 점유한 세션이 없음 |
| `no-workspace` | 레이더 미포착 | Linear started 상태인데 브랜치가 가리키는 워크트리가 없음 |
