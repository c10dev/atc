#!/usr/bin/env python3
"""atc의 Kokoro 어댑터용 래퍼(ATC-143, docs/guide/voice.md).

  kokoro-say.py --list-voices                     설치된 목소리를 한 줄에 하나씩
  kokoro-say.py --voice <이름> --out <파일.wav>   문구는 표준 입력, WAV는 파일로

모델 폴더는 환경변수 ATC_TTS_KOKORO_MODEL(config.json, kokoro-v1_0.pth, voices/*.pt).
Kokoro 파이썬 패키지가 든 venv의 python으로 돌린다. 네트워크를 쓰지 않는다(모델은 미리 내려받아 둔다).
"""
import argparse
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # 서버가 부르는 자리에서 모델을 내려받지 않는다


def model_dir() -> str:
    d = os.environ.get("ATC_TTS_KOKORO_MODEL", "")
    if not d or not os.path.isdir(d):
        sys.exit("ATC_TTS_KOKORO_MODEL: 모델 폴더가 없음")
    return d


def voices(d: str) -> list[str]:
    v = os.path.join(d, "voices")
    return sorted(f[:-3] for f in os.listdir(v) if f.endswith(".pt")) if os.path.isdir(v) else []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--voice")
    ap.add_argument("--out")
    a = ap.parse_args()
    d = model_dir()
    names = voices(d)
    if a.list_voices:
        print("\n".join(names))
        return
    if not a.voice or not a.out:
        sys.exit("--voice와 --out이 필요함")
    if a.voice not in names:
        sys.exit(f"목소리 없음: {a.voice}")
    text = sys.stdin.read().strip()
    if not text:
        sys.exit("문구가 비어 있음")
    import numpy as np
    import soundfile as sf
    from kokoro import KModel, KPipeline

    model = KModel(config=os.path.join(d, "config.json"), model=os.path.join(d, "kokoro-v1_0.pth"))
    # 목소리 이름의 첫 글자가 언어: a 미국식, b 영국식
    pipe = KPipeline(lang_code=a.voice[0], model=model)
    pack = os.path.join(d, "voices", f"{a.voice}.pt")
    audio = [np.asarray(r.audio) for r in pipe(text, voice=pack) if r.audio is not None]
    if not audio:
        sys.exit("소리가 만들어지지 않음")
    sf.write(a.out, np.concatenate(audio), 24000, subtype="PCM_16", format="WAV")


if __name__ == "__main__":
    main()
