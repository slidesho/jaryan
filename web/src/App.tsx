import { Editor } from "./Editor";
import { List } from "./List";
import { IS_DEMO, Link, usePath } from "./router";

export function App() {
  const path = usePath();
  const m = path.match(/^\/w\/([\w-]+)$/);
  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" to="/">جریان <small>نسخه‌ی آزمایشی</small></Link>
      </header>
      {IS_DEMO && (
        <div className="demo-note">
          نسخه‌ی آنلاین برای دیدن و امتحان رابط است: همه‌چیز فقط در همین مرورگر اجرا و ذخیره می‌شود. گره‌هایی که به اینترنت وصل می‌شوند (درخواست HTTP، بله، تلگرام، کاوه‌نگار) و وب‌هوک در این نسخه کار نمی‌کنند؛ برای آن‌ها بسته‌ی zip را روی کامپیوتر اجرا کنید.
        </div>
      )}
      <main>{m ? <Editor key={m[1]} id={m[1]} /> : <List />}</main>
    </div>
  );
}
