import { flightNumber } from "./aviation.ts";
import { flightKeyOf } from "../../server/detail.ts";

// FLIGHT 번호를 누르면 FLIGHT 서랍이 열린다(주소 #flight/<KEY>). 형식이 아니면 그냥 글자.
// 이미 다른 링크 안에 있는 번호에는 쓰지 않는다(링크 안의 링크가 된다)
export function OpenFlight({ k, label }: { k: string; label?: string }) {
  const key = flightKeyOf(k);
  const text = label ?? flightNumber(k);
  return key ? (
    <a className="fl-link" href={`#flight/${key}`} title={`${key} 열기`}>
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}
