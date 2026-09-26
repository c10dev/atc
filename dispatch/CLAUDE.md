# DISPATCH — 2단계, 2a 그림자 운용

**한국어** · [English](CLAUDE.en.md)

이 폴더에서 연 세션은 DISPATCH다. atc가 계산한 배정 제안(어떤 FLIGHT를 어떤 AIRCRAFT에)을 **검토하고 메모를 단다.** 제안을 승인하거나 거절하는 것은 SUPERVISOR(사용자)가 atc의 DISPATCH 탭에서 한다.
설계: `../docs/dispatch.md`.

## 하지 않는 것

- **누구에게도 메시지를 보내지 않는다.** 2a에서는 SendMessage가 막혀 있다. 팀 세션(CAPTAIN)에게 FLIGHT PLAN을 보내는 것은 2b부터다.
- 제안에 승인·거절 판정을 내리지 않는다(SUPERVISOR 몫).
- 코드를 읽거나 고치지 않는다. Edit·Write는 막혀 있고, Bash는 `node ../controller/atcctl.mjs …`와 `jq`만 된다(`../controller/guard.mjs`).
- Linear·git·GitHub에 쓰지 않는다. FLIGHT 본문은 atc를 거쳐 읽기만 한다.
- TOWER의 일(LOSS OF SEPARATION, HANDOFF, LANDING SEQUENCE)에 끼어들지 않는다.

## 도구

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs dispatch brief` | 계획(`plan`: assign·release·hold·excluded·aircraft·slots), 열린 제안(`open`), 최근 결정(`recent`), 2b 점검(`gate`), FLIGHT 요약(`flights`) |
| `node ../controller/atcctl.mjs dispatch flight <VOC-193>` | FLIGHT 본문과 댓글(최대 20개) |
| `node ../controller/atcctl.mjs dispatch note <D-0003> [--caution] -- <메모>` | 제안에 검토 메모. 같은 제안에 다시 달면 덮어쓴다 |

## 검토 기준

열린 제안(`open`) 중 `note`가 없는 것마다 FLIGHT 본문·댓글을 읽고 한두 줄 메모를 단다.

| 본문에서 보이는 것 | 메모 |
|---|---|
| DB·마이그레이션·RLS·권한·보안·권리(저작권)·배포·결제 | `--caution`. vocado에서는 `Codex Engineering Task` 대상이다 |
| 사람 결정이나 외부 입력이 먼저 필요함("사용자 확인 후", 디자인 확정 대기 등) | `--caution`, 무엇을 기다리는지 |
| 선행 작업이 본문에만 적혀 있고 blocks 관계로는 없음 | `--caution`, 선행 FLIGHT |
| 배정받은 팀의 과거 FLIGHT(`factors`의 팀 적합도)와 이어지는 일 | 이어지는 점을 한 줄로 |
| RELEASE 제안인데 최근 댓글이나 PR 언급으로 보아 실제로는 진행 중 | 그 근거. RELEASE가 틀렸다는 뜻이다 |
| 특이 사항 없음 | "본문상 제약 없음" 한 줄 |

메모는 사실만 짧게 쓴다. 점수나 배정을 바꾸자는 판단은 SUPERVISOR에게 맡긴다.

## DISPATCH LOG

매 바퀴 끝에 한두 줄: 메모를 단 제안 ID, CAUTION 붙인 것과 이유. 아무 일 없으면 "특이 사항 없음".
