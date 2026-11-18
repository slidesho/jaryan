import { useSyncExternalStore, type ReactNode } from "react";

// نسخه‌ی آنلاین (artifact) فقط #name ساده را می‌پذیرد؛ پس مسیر در حافظه نگه داشته می‌شود
export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

const read = () => (IS_DEMO ? "/" : location.hash.replace(/^#/, "") || "/");
let path = read();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function navigate(p: string) {
  path = p;
  if (!IS_DEMO) location.hash = `#${p}`;
  emit();
}
if (!IS_DEMO) {
  window.addEventListener("hashchange", () => { path = read(); emit(); });
}

export function usePath() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => path);
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a
      className={className}
      href={IS_DEMO ? "#" : `#${to}`}
      onClick={(e) => { if (IS_DEMO) { e.preventDefault(); navigate(to); } }}
    >
      {children}
    </a>
  );
}
