// SUPERVISOR QUEUE의 5초 캐시를 비우는 신호(ATC-271). relay·CLEARANCE를 바꾸는 길이 부르고, supervisor-queue-run.ts가 읽는다.
// 따로 둔 까닭: 큐 모듈은 relay 모듈을 읽고, relay 모듈은 큐를 부를 수 없다(순환).
let epoch = 0;
export const bustQueue = () => void epoch++;
export const queueEpoch = () => epoch;
