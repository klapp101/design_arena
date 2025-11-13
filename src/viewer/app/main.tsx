import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Demo from "./Demo";
import Leaderboard from "./Leaderboard";
import "./global.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element #root not found");
}

const root = createRoot(container);

const normalizedPath = (() => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "" ? "/" : path;
})();

let view: React.ReactNode = <Demo />;
if (normalizedPath === "/leaderboard") {
  view = <Leaderboard />;
}

root.render(
  <StrictMode>
    {view}
  </StrictMode>,
);
