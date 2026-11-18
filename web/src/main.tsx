import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/700.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { IS_DEMO } from "./router";

async function start() {
  if (IS_DEMO) (await import("./demo")).installDemoApi();
  createRoot(document.getElementById("root")!).render(<App />);
}
void start();
