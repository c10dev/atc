# 음성 콜아웃

WARNING과 CALL 알림은 톤에 이어 **짧은 영어 콜아웃**을 한 번 읽습니다. 무전기 소리처럼 들리게 브라우저가 키 클릭, 스켈치, 대역 필터를 씌웁니다.

> 예: 키 클릭 → 스켈치 → *"Supervisor, GOLF, standing by for approval."* → 스켈치 꼬리

목소리는 **이 컴퓨터의 엔진(Piper, espeak-ng, Kokoro 중 하나)** 이 만들고, 문구도 소리도 밖으로 나가지 않습니다. 엔진을 고르지 않았거나(기본 `none`) 설치가 없으면 톤만 나고 설정에 `TTS 엔진 없음`이 보입니다. 기본은 꺼져 있습니다.

## 무엇을 읽나

문구는 알림 종류마다 정해진 틀입니다. 알림의 한국어 글은 읽지 않고, 콜사인(GOLF, KILO)과 FLIGHT 번호(`ATC-120` → "ATC one two zero", 9는 "niner")만 채웁니다.

| 종류 | 소리 | 읽는 문구 |
|---|---|---|
| 같은 STAND를 두 팀이 점유(충돌) | WARNING | Supervisor, GOLF and KILO, traffic conflict on ATC one two zero, request instructions. |
| 머지가 기본 브랜치에 닿지 않음(STRANDED) | WARNING | Supervisor, ATC one two one stranded, merge not on main, request instructions. |
| RTS가 ROLLBACK · 실패 | WARNING | Supervisor, return to service rolled back, request instructions. |
| 도구 승인을 기다리는 AIRCRAFT(PENDING) | CALL | Supervisor, GOLF, standing by for approval. |
| 판정을 기다리는 DISPATCH 제안(ASSIGN) | CALL | Supervisor, dispatch requests ATC one four zero for HOTEL, request decision. |
| 판정을 기다리는 DISPATCH 제안(RELEASE) | CALL | Supervisor, dispatch requests release of ATC one four zero, request decision. |
| 판정을 기다리는 SCHEDULE 작업(approval 모드만) | CALL | Supervisor, schedule requests tail on ATC one four zero, request decision. |
| HUMAN CHECK 대기 | CALL | Supervisor, human check waiting on ATC five, request decision. |

CAUTION(예: AIRCRAFT health, FLIGHT FOLLOWING 문제), ADVISORY, DONE에는 음성이 없습니다(CAUTION은 하루 30번쯤 울립니다). 톤 다음에 **한 번만** 읽고, WARNING 톤이 되풀이돼도 음성은 되풀이하지 않습니다. 확인(ACK)하면 톤과 음성이 함께 멈춥니다. 여러 알림이 한꺼번에 오면 가장 높은 등급 하나만 읽습니다. 소리가 켜진 탭 하나, 조용한 시간, 10분 재울림 방지는 톤과 같습니다.

## 켜기

1. 설정 창(로고) → **알림** 탭 → SOUND를 **켜기**(브라우저의 소리 잠금을 푸는 클릭입니다).
2. 같은 탭의 **VOICE 음성 콜아웃**을 **켜기**.
3. **목소리**를 고르고 **미리 듣기**를 눌러 들어 봅니다. 고정 예시 문구가 무전 효과와 함께 나옵니다.
4. **무전 효과**로 조절합니다. 0%는 깨끗한 음성, 100%는 완전한 무전(클릭, 스켈치, 300–3000 Hz 대역, 가벼운 왜곡과 압축, 낮은 치익 소리)입니다.

VOICE 켜기와 무전 효과는 이 브라우저에만 저장됩니다. 엔진과 고른 목소리는 서버 설정(`.env.local`)이라 어느 브라우저에서 바꿔도 같습니다.

## 엔진 설치 (SUPERVISOR가 한 번)

엔진은 셋 중 **하나만** 있으면 됩니다. 설정 창의 엔진 목록에는 지금 쓸 수 있는 엔진만 고를 수 있고, 없는 엔진은 흐리게 사유와 함께 보입니다. Piper는 가볍고 빠릅니다. espeak-ng는 가장 가볍지만 로봇 같은 소리이고, Kokoro는 가장 자연스럽지만 무겁고 느립니다.

### Piper


팀 세션은 엔진을 설치하지 않습니다. 시스템 패키지 없이 `~/.local` 아래에만 넣습니다.

```sh
# 1) Piper(파이썬 패키지 piper-tts)를 전용 가상환경에
python3 -m venv ~/.local/share/piper/venv
~/.local/share/piper/venv/bin/pip install piper-tts

# 2) atc가 부르는 실행 파일(기본 경로 ~/.local/bin/piper)
mkdir -p ~/.local/bin
printf '#!/bin/sh\nexec "$HOME/.local/share/piper/venv/bin/python" -m piper "$@"\n' > ~/.local/bin/piper
chmod +x ~/.local/bin/piper

# 3) 목소리 하나(기본 폴더 ~/.local/share/piper/voices)
mkdir -p ~/.local/share/piper/voices
~/.local/share/piper/venv/bin/python -m piper.download_voices en_US-lessac-medium --data-dir ~/.local/share/piper/voices

# 4) 한 번 시험(WAV가 나오면 된다)
echo 'Supervisor, GOLF, radio check.' | ~/.local/bin/piper -m ~/.local/share/piper/voices/en_US-lessac-medium.onnx -f /tmp/radio-check.wav
```

atc는 `piper -m <목소리>.onnx -f <파일>`로 부르고 문구는 표준 입력으로 넘깁니다(셸 없이, 5초 제한, 한 번에 하나). 위 시험이 되면 설정 창의 목소리 목록에 `en_US-lessac-medium`이 보입니다. 경로를 바꾸려면 `.env.local`에 적습니다.

```
ATC_TTS_ENGINE=piper
ATC_TTS_PIPER=/home/you/.local/bin/piper
ATC_TTS_VOICES=/home/you/.local/share/piper/voices
```

엔진 기본값은 `none`이라 설치만 해서는 켜지지 않습니다. 설정 창의 엔진에서 `piper`를 고르거나 위처럼 `ATC_TTS_ENGINE=piper`를 적습니다. 서버를 다시 띄우면 적용됩니다(설정 창은 엔진과 목소리만 바로 바꿉니다). 처음 들어 볼 목소리: `en_US-lessac-medium`.

### espeak-ng

작고 빠른 규칙 기반 엔진입니다(프로세스당 수십 ms 안팎이 보통). 목소리는 모델 파일이 아니라 언어·변종 이름입니다. 시스템 패키지이므로 팀 세션은 설치하지 않습니다. SUPERVISOR가 한 번:

```sh
sudo apt install espeak-ng
espeak-ng --voices=en                      # 쓸 수 있는 목소리(설정의 목록과 같음)
echo 'Supervisor, GOLF, radio check.' | espeak-ng -v en-us -w /tmp/radio-check.wav --stdin
```

atc는 `espeak-ng -v <목소리> -w <파일> --stdin`으로 부르고 문구는 표준 입력으로 넘깁니다(셸 없이, 5초 제한, 한 번에 하나). 실행 파일이 `/usr/bin/espeak-ng`가 아니면 `.env.local`에 적습니다.

```
ATC_TTS_ENGINE=espeak
ATC_TTS_ESPEAK=/usr/bin/espeak-ng
```

처음 들어 볼 목소리: `en-us`(미국식). `en-gb`(영국식)도 알아듣기 좋습니다.

### Kokoro

82M 파라미터의 신경망 엔진으로 셋 중 소리가 가장 자연스럽습니다. 파이썬 패키지와 모델(약 330 MB)을 `~/.local/share/kokoro` 아래에만 받습니다. 시스템 패키지는 필요 없습니다(파이썬 3.10–3.12 필요. 3.13 이상은 지원하지 않음).

```sh
# 1) 전용 가상환경에 패키지
python3.11 -m venv ~/.local/share/kokoro/venv
~/.local/share/kokoro/venv/bin/pip install kokoro soundfile

# 2) 모델과 목소리(영어 목소리만)
~/.local/share/kokoro/venv/bin/python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download("hexgrad/Kokoro-82M", local_dir="/home/you/.local/share/kokoro/model",
  allow_patterns=["config.json", "kokoro-v1_0.pth", "voices/a*_*.pt", "voices/b*_*.pt", "README.md"])
EOF

# 3) atc가 부르는 래퍼 명령(저장소의 tts/kokoro-say.py를 venv의 python으로)
mkdir -p ~/.local/bin
printf '#!/bin/sh\nexec "$HOME/.local/share/kokoro/venv/bin/python" /home/you/projects/atc/tts/kokoro-say.py "$@"\n' > ~/.local/bin/kokoro-say
chmod +x ~/.local/bin/kokoro-say

# 4) 한 번 시험
export ATC_TTS_KOKORO_MODEL=$HOME/.local/share/kokoro/model
~/.local/bin/kokoro-say --list-voices | head -3
echo 'Supervisor, GOLF, radio check.' | ~/.local/bin/kokoro-say --voice af_heart --out /tmp/radio-check.wav
```

래퍼(`tts/kokoro-say.py`)는 `--voice <이름> --out <파일>`을 받고 문구는 표준 입력으로 읽습니다. `--list-voices`는 설치된 목소리를 한 줄에 하나씩 냅니다. 네트워크를 쓰지 않고, 서버는 이 래퍼를 운영 체크아웃(`/home/you/projects/atc`)에서 돌립니다. `.env.local`:

```
ATC_TTS_ENGINE=kokoro
ATC_TTS_KOKORO=/home/you/.local/bin/kokoro-say
ATC_TTS_KOKORO_MODEL=/home/you/.local/share/kokoro/model
```

**느립니다.** 알림마다 프로세스를 새로 띄우므로 (torch와 모델을 읽는 시간 때문에) 한 문구에 6–9초쯤 걸립니다(8코어 데스크톱 CPU, 이 머신 측정). 그래서 Kokoro의 시간 제한은 다른 엔진(5초)보다 긴 **20초**입니다. 같은 문구는 캐시(`voice-cache/`)에서 바로 나오므로 처음 나오는 문구(다른 콜사인·FLIGHT 번호)만 늦고, 늦게 오면 그 알림의 음성은 톤보다 몇 초 뒤에 납니다. 미리 듣기도 처음에는 몇 초 걸립니다. 상주 프로세스는 두지 않았습니다.

처음 들어 볼 목소리: `af_heart`(미국 여성). 남성은 `am_michael`, 영국식은 `bf_emma`·`bm_george`.

## 목소리 더하기·바꾸기

- 목소리는 `<이름>.onnx`와 `<이름>.onnx.json` 한 쌍입니다. 둘 다 있어야 목록에 나옵니다. 다른 목소리를 받아 같은 폴더에 두면(`python -m piper.download_voices <이름> --data-dir …`) 설정의 목록에 생깁니다.
- 목록에서 고르고 **미리 듣기**로 확인합니다. 마음에 안 들면 다른 목소리를 고르거나, 무전 효과를 줄입니다. 코드를 고칠 일은 없습니다.
- 엔진과 목소리는 설정에서 엔진을 고르면 그 엔진이 아는 목소리 목록으로 바뀝니다. 엔진 값은 `piper`, `espeak`, `kokoro`, `none`, `stub`(시험용: 소리 없는 톤 WAV를 만들 뿐이라 화면 시험에만 씁니다)입니다. 다른 엔진을 더하려면 `server/tts.ts`에 인자 만들기와 목소리 목록 읽기 함수를 하나씩 더하면 되고 화면은 바뀌지 않습니다.

## RADIO 듣기

같은 엔진과 무전 체인으로 RADIO 탭의 `LISTEN`도 읽습니다([RADIO 탭](radio-tab.md)). 알림과 다른 점:

- 읽는 것은 새로 들어오는 **교신**입니다. 문구는 교신의 필드(스테이션, 콜사인, 종류, FLIGHT)로만 만든 틀이고, 기록된 본문은 읽지 않습니다.
- 기본은 꺼짐이고, 알림 소리 설정과 따로 이 브라우저에 기억합니다.
- 알림 톤(WARNING·CALL)이 울리는 동안은 양보하고, 조용한 시간에는 읽지 않습니다.
- 목소리: TOWER·OCC(DELIVERY)·MCC(GROUND)·OCC(COMPANY)는 자리마다 하나(RADIO 탭의 `목소리`에서 바꿈), AIRCRAFT는 콜사인에서 안정적으로 고른 설치된 목소리입니다. 설치된 목소리가 하나뿐이면 모두 그것입니다.

## 끄기

- 이 브라우저만: 설정 → 알림 → VOICE **끄기**.
- 엔진 자체: `.env.local`에 `ATC_TTS_ENGINE=none`(또는 그 줄을 지우고 엔진을 지웁니다: `rm -r ~/.local/share/piper ~/.local/bin/piper`, Kokoro는 `rm -r ~/.local/share/kokoro ~/.local/bin/kokoro-say`).
- 만들어 둔 음성 캐시는 `~/.local/state/atc/voice-cache/`(200개·20 MB까지, 오래된 것부터 지움)입니다. 지워도 다시 만들 뿐입니다.

## 라이선스 (2026-09-29에 확인)

atc는 엔진과 목소리를 **따로 도는 프로그램과 파일**로 쓸 뿐 저장소에 싣지 않고, 음성 파일도 저장소에 넣지 않습니다. 그래도 설치하는 것의 조건은 직접 확인하세요.

- **Piper.** 위에서 설치하는 `piper-tts`는 OHF-Voice 프로젝트(`OHF-Voice/piper1-gpl`)이고 **GPL-3.0**입니다. 예전 `rhasspy/piper`는 이 프로젝트로 옮겨 갔습니다.
- **목소리 모델은 각각 라이선스가 다릅니다.** 목소리마다 모델 카드에 적혀 있습니다.
  - `en_US-ryan-high`(Ryan Speech)와 `en_US-hfc_male-medium`(Hi-Fi Captain)은 **CC BY-NC-SA 4.0**(비영리, 같은 조건으로 공유)입니다.
  - `en_US-lessac-medium`은 Lessac Blizzard 2013 데이터셋의 조건(Edinburgh CSTR가 적어 둔 라이선스)을 따르고, 상업 사용이 되는지는 모델 카드만으로 확인하지 못했습니다.
  - 개인 도구로 쓰더라도 고른 목소리의 카드를 읽고 조건에 맞게 쓰세요. 회사에서 쓰려면 특히 확인하세요.

- **espeak-ng.** **GPL-3.0**입니다. 시스템 패키지로 따로 돌 뿐 atc에 싣지 않습니다. 목소리는 프로그램에 든 규칙 기반 목소리라 모델 라이선스가 따로 없습니다.
- **Kokoro.** 파이썬 패키지 `kokoro`(패키지 메타데이터에 Apache License)와 모델 Kokoro-82M(모델 카드의 `license: apache-2.0`) 모두 **Apache-2.0**입니다. 모델 카드: huggingface.co/hexgrad/Kokoro-82M (내려받을 때 함께 오는 `README.md`에도 있습니다). 목소리 파일(`voices/*.pt`)은 모델과 같은 저장소의 것이고, 훈련 데이터의 조건은 모델 카드에서 직접 확인하세요. Kokoro의 파이썬 의존성 `espeakng-loader`는 발음 보조용 eSpeak NG 라이브러리(GPL-3.0)를 함께 싣고 옵니다(그 패키지의 메타데이터에는 라이선스가 적혀 있지 않습니다).

## 문제 해결

| 설정 창의 표시 | 뜻 | 할 일 |
|---|---|---|
| `TTS 엔진 없음` (뒤에 이유가 없음) | 엔진이 `none`(기본값) | 설치한 뒤 설정 창의 엔진에서 `piper`를 고릅니다 |
| `TTS 엔진 없음 — piper 실행 파일 없음` | `ATC_TTS_PIPER` 경로(기본 `~/.local/bin/piper`)에 실행 파일이 없음 | 위 설치 2)를 하거나 경로를 고칩니다 |
| `TTS 엔진 없음 — 목소리 없음` | 목소리 폴더에 `.onnx`와 `.onnx.json` 한 쌍이 없음 | 위 설치 3)을 하거나 `ATC_TTS_VOICES`를 고칩니다 |
| `미리 듣기 실패: 5초 안에 끝나지 않음` | 엔진이 시간 제한(Piper·espeak-ng 5초, Kokoro 20초) 안에 못 끝냄 | 한 번 더 누릅니다. Piper는 더 작은 목소리(`low`·`medium`)를 씁니다 |
| 엔진 목록에서 `kokoro — kokoro 실행 파일 없음` 등이 흐리게 보임 | 그 엔진의 경로(`ATC_TTS_ESPEAK`, `ATC_TTS_KOKORO`)에 실행 파일이 없음 | 위 설치를 하거나 `.env.local` 경로를 고칩니다 |
| `미리 듣기 실패: 소리가 꺼져 있음` | 브라우저가 소리를 막음 | 헤더의 `🔇 소리 잠김` 칩이나 페이지의 아무 곳을 누릅니다. SOUND를 켜는 클릭을 다시 해도 됩니다 |
| 헤더에 `🔇 소리 잠김 — 클릭하면 켜짐`이 떠 있음, 탭 제목에 `🔇1` | 브라우저가 오디오를 잠갔고 atc가 스스로 풀지 못함 | 아무 곳이나 한 번 누릅니다. 잠겨 있는 동안 온 WARNING·CALL 가운데 아직 있는 가장 높은 것 하나가 풀릴 때 한 번 읽힙니다 |
| 톤만 나고 음성이 없음 | CAUTION·DONE이거나, VOICE가 꺼짐, 그 알림에 문구 틀이 없음 | 위 표를 봅니다 |
