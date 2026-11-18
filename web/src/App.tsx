import { useEffect, useState } from "react";
import { Editor } from "./Editor";
import { List } from "./List";

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const f = () => setH(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
}

export function App() {
  const hash = useHash();
  const m = hash.match(/^#\/w\/([\w-]+)$/);
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">جریان <small>نسخه‌ی آزمایشی</small></a>
      </header>
      <main>{m ? <Editor key={m[1]} id={m[1]} /> : <List />}</main>
    </div>
  );
}
