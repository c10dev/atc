// 화면 움직임을 켤지 정한다(ATC-409). 운영체제가 움직임 줄이기를 요청하면 저장된 설정과 상관없이 끈다
// (design-language 원칙 10: data-motion="off"와 prefers-reduced-motion 둘 다 멈춘다). 저장된 값이 없으면 켬.
export function motionOn(saved: boolean | undefined, osReduce: boolean): boolean {
  return !osReduce && saved !== false;
}
