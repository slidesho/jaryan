import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./api/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
// هم در حالت توسعه (server/src) و هم در بسته‌ی آماده (کنار main.js) کار می‌کند
const bundled = existsSync(path.resolve(here, "public"));
const dataDir = process.env.DATA_DIR ?? path.resolve(here, bundled ? "data" : "../data");
const publicDir = process.env.PUBLIC_DIR ?? path.resolve(here, bundled ? "public" : "../public");

const { server } = await createApp({
  dataDir,
  publicDir,
  // اگر روی سرور عمومی اجرا شود، میزبان‌های مجاز را با ALLOWED_HOSTS (جداشده با ویرگول) بدهید
  allowedHosts: process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(",") : undefined,
});
server.listen(port, host, () => {
  console.log(`جریان روی http://${host}:${port} اجرا شد`);
});
