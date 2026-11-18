import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const demo = process.env.VITE_DEMO === "1";

export default defineConfig({
  plugins: [react(), ...(demo ? [viteSingleFile()] : [])],
  base: "./",
  build: demo
    ? { outDir: "../dist-demo", emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false }
    : { outDir: "../server/public", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3000", "/webhook": "http://127.0.0.1:3000" } },
});
