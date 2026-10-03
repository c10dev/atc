# VERIFY GATE (ATC-517, 원격 실행 ATC-518)

[English](verify-gate.md) · **한국어**

무거운 검증 명령(`npm test`, `npx tsc --noEmit -p .`, `npx vite build`)을 여러 STAND에서 동시에 돌리면 호스트가 한꺼번에 눌렸다(2026-09-30 테스트 OOM). gate는 이 명령들을 짧은 줄에 세운다: 모든 STAND와 세션을 통틀어 호스트에서 동시에 최대 N건만 돈다. 닿는 LAN 데스크톱이 있으면 이 세 명령은 거기서 돈다.

## 쓰는 법

```bash
node server/verify-gate-cli.ts -- npm test
node server/verify-gate-cli.ts -- npx tsc --noEmit -p .
node server/verify-gate-cli.ts -- npx vite build
```

늘 하던 대로 STAND에서 돌린다. 명령은 부른 쪽의 작업 폴더에서 stdin·stdout·stderr를 그대로 잇고 돌며, gate는 명령의 종료 코드로 끝난다(신호로 끝난 명령은 셸처럼 128+번호). 데스크톱이 닿으면 이 세 명령은 거기서 돈다(아래 "원격 실행"). 결과만 봐서는 어디서 돌았는지 알 수 없고 실행 기록에서만 알 수 있다. gate를 거치지 않은 명령은 전과 같다. `CLAUDE.md`와 skill이 gate를 부르게 하는 일은 `user` 등급 변경이라 아직 하지 않았다.

## 무엇을 하나

- **N건씩.** 기본 N은 2(8 vCPU). 슬롯은 `slots/slot-<i>.lock`의 `flock`이고 명령 자신이 쥔다. 끝나든 한도로 멈추든 죽든 커널이 놓으므로 치울 낡은 슬롯이 없다.
- **실패가 아니라 짧은 줄.** 자리가 없으면 `queue/`에 표를 받고 순서(도착순)를 기다린다. stderr에 `[atc verify-gate] waiting for a slot: position P in line, N slots busy, waited Ss (gives up after Ls)`를 바로, 그리고 30초마다 쓴다. 죽은 표(프로세스가 없음)는 세지 않는다.
- **기다림 한도.** 기본 1800초. 넘으면 명령은 **돌지 않고** gate는 **75**로 끝난다. 75는 gate만 쓴다. 64는 명령이 없다는 뜻이다.
- **실행 한 번의 부하도 제한.** gate가 명령의 `PATH` 맨 앞에 `node` 껍데기를 둔다. `--test-concurrency` 없는 `node --test …`(`npm test` 포함)는 `--test-concurrency=K`(기본 3)를 받는다. `NODE_OPTIONS`로는 못 건다(node가 거절한다).
- **fail open.** gate가 못 돌면(폴더를 못 씀, `flock` 없음, 내부 오류) stderr에 알리고 명령을 바로 돌리며 `fallback` 이유를 기록한다. gate 때문에 검증이 못 도는 일은 없다.
- **스위치.** `verifyGate`(설정 → OPERATIONS → VERIFY GATE, 기본 `on`, SUPERVISOR만, `policy / verify-gate-mode`로 기록). `off`면 줄도 기록도 없이 명령이 바로 돈다.

## 설정과 파일

gate 폴더는 `~/.local/state/atc-gate/`(`ATC_GATE_DIR`로 바꾼다). 운영 상태 폴더 `~/.local/state/atc/`와 따로이고, gate는 그 폴더, 7700 포트, `.env*`를 읽거나 쓰지 않는다.

| 파일 | 내용 |
|---|---|
| `config.json` | `mode`와 `remote`(스위치가 쓴다), 선택으로 `slots`(1–8), `waitLimitSec`, `testConcurrency`, `remoteProbeSec` |
| `remote.json` | 데스크톱 접속 정보(아래). 저장소에는 없다 |
| `runs.jsonl` | 실행마다 한 줄(추가만) |
| `slots/`, `queue/`, `bin/node` | 슬롯 락, 표, node 껍데기 |

환경 변수: `ATC_GATE_SLOTS`, `ATC_GATE_WAIT_LIMIT_SEC`, `ATC_GATE_TEST_CONCURRENCY`, `ATC_GATE_REMOTE_PROBE_SEC`. 틀린 값은 기본값으로 읽는다.

두 손잡이는 CLI 시험이 몇 초씩 기다리지 않게 하려고만 있다(ATC-523). 운영 기본값은 그대로이고 따로 정할 필요가 없다: `ATC_GATE_POLL_MS`(줄 선 실행이 빈 슬롯을 다시 보는 간격, 20–5000, 기본 1000)와 `ATC_GATE_WAIT_LIMIT_MS`(밀리초 단위 기다림 한도, 100 이상, 있으면 초 단위 값보다 먼저 본다). 브라우저 문도 `ATC_GATE_POLL_MS`를 읽고 `ATC_BROWSER_WAIT_LIMIT_MS`가 있다.

## 기록과 misfire 세기

`runs.jsonl` 한 줄: `t`(시작), `where`(`local` 또는 `desktop`), `cmd`(앞 세 낱말만: 인자에 비밀이 섞이지 않게), `cwd`, `waited`, `waitedMs`, `ranMs`, `exit`, 해당하면 `killed`, `timedOut`, `fallback`, `syncMs`(데스크톱에 보내고 준비한 시간), `localReason`(로컬로 돈 사유), `lost`. 설정 창의 VERIFY GATE 블록은 전체와 최근 7일에 대해 실행 수, 줄 선 수, 가장 긴 기다림, 한도 실패, 바로 실행(gate 고장), 죽은 명령이 놓은 슬롯과 아래 원격 세기를 보인다.

## 원격 실행 (ATC-518)

데스크톱이 닿으면 무거운 검증 명령은 거기서 돌고 gate는 명령의 종료 코드로 끝나며 stdout·stderr는 그대로 나온다(stdin은 넘기지 않는다). 안 닿으면 같은 명령이 오류도 긴 멈춤도 없이 로컬 gate에서 돈다. 세션의 동작은 데스크톱이 켜져 있는지에 달려 있지 않다.

### 무엇이 거기서 돌 수 있나

이 세 명령만, 낱말 하나하나 같을 때만이다: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`. 낱말이 하나 더하거나 다르면(`npm test -- --watch`, `bash -c …`) 데스크톱으로 가지 않고 로컬 gate에서 돈다(`localReason: not-listed`). 대상은 고정된 데스크톱 한 대이고 gate 폴더에서 읽는다(아래). `npm`이 STAND 맨 위 폴더에서 돌아야 하므로 명령도 거기서 시작해야 한다.

### 한 번의 실행 순서

1. **닿는지.** 하드 한도(기본 3초, `config.json`의 `remoteProbeSec` 또는 `ATC_GATE_REMOTE_PROBE_SEC`, 1–30)로 `ssh true`. 답이 없으면 로컬로 돈다(`desktop-absent`). `wsl --shutdown` 뒤에도 한도 이상 기다리지 않는다.
2. **보내기.** 추적 + 미추적 소스(`git ls-files -co --exclude-standard`)에서 제외 목록을 뺀 것을 `tar`로 묶어 ssh로 데스크톱의 `~/atc-verify/runs/<id>`에 푼다. 20 MB를 넘는 파일은 보내지 않는다.
3. **준비.** 데스크톱에서 빈 `git init`과 `git add -A`(일부 시험이 `git ls-files`를 쓴다. 원격도 자격 증명도 호출자의 `.git`도 없다), `node_modules`는 `package-lock.json` 해시별 캐시의 하드링크(lock마다 `npm ci` 한 번, 최신 캐시 셋만 두고 하루 지난 실행 폴더는 치운다).
4. **실행.** 고정된 명령을 `ATC_GITHUB=off`로. 스크립트가 명령 전에 `.atc-started`, 뒤에 `.atc-exit`를 남긴다.
5. **치우기.** 실행 폴더를 지운다. 명령의 출력 말고는 데스크톱에서 STAND로 아무것도 쓰지 않는다.

### 실패: 전송과 명령을 가른다

`ssh`는 명령의 종료 코드를 그대로 돌려주지만 ssh 자신의 실패도 255라서, 255를 보면 gate가 두 표 파일을 읽는다.

| 일어난 일 | gate가 하는 일 |
|---|---|
| 데스크톱이 답하지 않았거나 보내기·준비가 실패 | 로컬로 돈다(`desktop-absent` 또는 `transport-error`), stderr에 알린다 |
| 명령이 돌았고 코드 N으로 끝남(255 포함) | N으로 끝난다. N은 명령 자신의 결과이고 전송 실패로 세지 않는다 |
| `.atc-started` 전에 연결이 끊김 | 로컬로 돈다(`transport-error`): 원격에서는 시작하지 않았다 |
| `.atc-started` 뒤에 끊겼고 `.atc-exit`가 없음(또는 표를 못 읽음) | **종료 코드 76**, `lost: true`, stderr 안내. 시험 실패가 아니고 명령을 **다시 돌리지 않는다**(두 번째 실행이 부작용을 되풀이할 수 있다). 직접 다시 돌리거나 원격 실행을 끈다 |

76은 이 경우에만 쓴다(75는 기다림 한도, 64는 사용법). 원격 실행 중 Ctrl-C는 로컬 `ssh`를 죽인다. 원격 명령은 혼자 끝날 수 있고 폴더는 하루 뒤 치워진다.

### 절대 보내지 않는 것

파일 목록은 `server/verify-remote.ts`의 명시적 제외 목록(`isExcluded`, 시험함)으로 거른다: 어디든 `.git`, `node_modules`, `.env*`(`.env.example`·`.env.sample` 제외), `.npmrc`, `.netrc`, `.ssh`, `.aws`, `.gnupg`, `.local`, `.config`, `.claude/worktrees/`와 `.claude/settings.local.*`, 개인 키와 인증서(`id_*`, `*.pem`, `*.key`, `*.p12`), `credentials*`, `*.sqlite`, 절대 경로나 `..` 경로. `~/.claude*`와 `~/.local/state/atc`는 읽지 않는다(목록은 작업 트리에서만 만든다). 이 저장소의 추적 파일을 하나라도 빼면 시험이 실패하므로, 시험이 필요한 소스는 남는다.

### 데스크톱은 어디에 적나

저장소에는 없다(공개 저장소). 저장소는 파일 이름만 안다: gate 폴더(`~/.local/state/atc-gate/`, `ATC_GATE_DIR`로 바꾼다)의 `remote.json`.

```json
{ "host": "<이름 또는 주소>", "user": "<로그인>", "port": 22, "identityFile": "~/.ssh/<열쇠>" }
```

`port`와 `identityFile`은 선택이다. 값은 모양을 검사하고(`-`로 시작하거나 공백·셸 글자가 든 host·user는 거절: 값이 ssh 옵션이 될 수 없다) 호스트 앞에 `--`를 둔 별도 인자로 넘긴다. ssh는 `BatchMode=yes`, `StrictHostKeyChecking=yes`로 돈다: 데스크톱의 호스트 열쇠가 이미 `known_hosts`에 있어야 한다. 올바른 파일이 없으면 gate는 로컬로 돈다(`desktop-absent`).

### 데스크톱의 시험 서버

세 명령은 자체 서버를 띄우지 않는다. 실행은 `ATC_GITHUB=off`로 돈다. 시험이 띄우는 것은 로컬 규칙을 따른다(포트 7702–7799, 임시 상태 폴더). 데스크톱에는 운영 7700도 atc 상태 폴더도 없고, 어떤 실행도 실제 팀 세션에 메시지를 보내지 않는다.

### 스위치와 세기

- **스위치** `verifyRemote`(설정 → OPERATIONS → VERIFY GATE, 기본 `on`, SUPERVISOR만, `policy / verify-remote-mode`로 기록, `config.json`의 `remote`로 저장). `off`면 전부 전처럼 로컬 gate에서 돈다(`switch-off`). 기존 `verifyGate`를 끄면 줄도 기록도 없는 것은 그대로다.
- **misfire 세기**(gate 것 옆, 전체와 최근 7일): 데스크톱에서 돈 실행, 전송 문제로 실패한 원격 실행(시작 전에 돌아선 것 + 잃은 것), 데스크톱에서 명령이 실패한 실행(0이 아님, 전송 문제 아님), 사유별 로컬 실행(`desktop-absent`, `transport-error`, `not-listed`, `switch-off`), 데스크톱에서 시작했다가 도중에 잃은 실행.
