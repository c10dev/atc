import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initSettings } from "./settings.ts";
import "./styles.css";
import "./kit/Button.css";

// 첫 화면부터 저장된 설정(테마, 애니메이션)으로 그린다.
initSettings();

// 이 화면이 돌리는 번들. 빌드에서는 /assets/index-<hash>.js로 서버가 index.html에서 읽는 build와 같다.
// 다른 청크로 옮기면 주소가 달라지므로 진입 모듈인 여기서 잰다. 개발 서버에서는 /src/main.tsx.
const build = new URL(import.meta.url).pathname;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App build={build} />
  </StrictMode>,
);
