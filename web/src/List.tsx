import { useCallback, useEffect, useState } from "react";
import { api, faDate, faNum, SAMPLE, type WorkflowSummary } from "./api";
import { Link, navigate } from "./router";

export function List() {
  const [items, setItems] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.list().then(setItems).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(sample: boolean) {
    try {
      const w = await api.create(
        sample ? SAMPLE : { name: "گردش‌کار جدید", nodes: [{ id: "t", name: "شروع", type: "trigger", params: {} }], connections: [], positions: { t: { x: 400, y: 120 } } },
      );
      navigate(`/w/${w.id}`);
    } catch (e) { setError((e as Error).message); }
  }

  async function remove(w: WorkflowSummary) {
    try { await api.remove(w.id); setConfirmId(null); load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>گردش‌کارها</h1>
        <div className="row">
          <button onClick={() => create(true)}>ساخت نمونه‌ی آماده</button>
          <button className="primary" onClick={() => create(false)}>گردش‌کار جدید</button>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {items === null && !error && <p className="muted">در حال بارگذاری…</p>}
      {items?.length === 0 && (
        <div className="empty">
          <p>هنوز گردش‌کاری نساخته‌اید.</p>
          <p className="muted">برای شروع، «ساخت نمونه‌ی آماده» را بزنید و دکمه‌ی «اجرا» را امتحان کنید.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <table className="table">
          <thead><tr><th>نام</th><th>گره‌ها</th><th>وضعیت</th><th>آخرین تغییر</th><th></th></tr></thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td><Link to={`/w/${w.id}`}>{w.name}</Link></td>
                <td>{faNum(w.nodeCount)}</td>
                <td><span className={`pill ${w.active ? "ok" : ""}`}>{w.active ? "فعال" : "غیرفعال"}</span></td>
                <td>{faDate(w.updatedAt)}</td>
                <td className="actions">
                  {confirmId === w.id ? (
                    <span className="confirm">
                      با تاریخچه‌ی اجرا حذف می‌شود و برگشت ندارد.
                      <button className="danger" onClick={() => remove(w)}>بله، حذف شود</button>
                      <button onClick={() => setConfirmId(null)}>انصراف</button>
                    </span>
                  ) : (
                    <button className="danger" onClick={() => setConfirmId(w.id)}>حذف</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
