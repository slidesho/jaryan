import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const demo = process.env.VITE_DEMO === "1";
const stub = path.resolve(__dirname, "src/stubs/demo-unsupported.ts");
// در مرورگر (دمو و ساخت عادی)، ماژول‌های وابسته به Node جایگزین می‌شوند
const demoStubs = {
  name: "demo-stubs",
  enforce: "pre" as const,
  resolveId(id: string, importer?: string) {
    if (!importer || !importer.includes("/server/src/")) return null;
    if (/(^|\/)(service-nodes|code-node)(\.js|\.ts)?$/.test(id)) return stub;
    return null;
  },
};

export default defineConfig({
  plugins: [demoStubs, react(), ...(demo ? [viteSingleFile()] : [])],
  base: "./",
  build: demo
    ? { outDir: "../dist-demo", emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false }
    : { outDir: "../server/public", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3000", "/webhook": "http://127.0.0.1:3000" } },
});
