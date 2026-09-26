import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initSettings } from "./settings.ts";
import "./styles.css";

// 첫 화면부터 저장된 설정(테마, 애니메이션)으로 그린다.
initSettings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
