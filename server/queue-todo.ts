// SUPERVISOR QUEUE의 지금 개수(ATC-454): 한 곳에서 센 수를 SUPERVISOR SUMMARY의 `todo`가 그대로 읽게 한다.
// 센 곳은 supervisor-queue-run.ts(큐를 만들 때마다 넣는다). 알림 쪽(supervisor-alerts-run.ts)이 큐 쪽을 들이면 서로를 부르므로 값만 여기에 둔다.
let last: number | null = null;
export const setTodo = (n: number | null) => {
  last = n;
};
export const todoNow = (): number | null => last;
