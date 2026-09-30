// DUTY 서버 런타임(D2, docs/duty.md 5장)이 들어올 자리. D1에서는 비어 있다.
// D2가 `claude -p` 프로세스를 띄우므로(`duty/spawn.mjs`의 dutyArgvOf) deploy/landing-tier.mjs의 SIDE_EFFECT에 미리 올려 두었다: D2가 등급 파일을 건드리지 않고 flagged로 들어오게.
export {};
