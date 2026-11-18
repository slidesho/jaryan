import {
  addEdge, Background, Controls, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState,
  type Connection, type Edge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, faDate, faNum, SAMPLE_INPUT, SECRET_PLACEHOLDER,
  type ExecSummary, type Execution, type FieldDef, type NodeTypeDef, type Workflow,
} from "./api";
import { NodeCard, type FlowNode } from "./NodeCard";

const nodeTypes = { card: NodeCard };

function toFlow(w: Workflow, types: NodeTypeDef[]) {
  const byType = new Map(types.map((t) => [t.type, t]));
  const nodes: FlowNode[] = w.nodes.map((n, i) => ({
    id: n.id,
    type: "card",
    position: w.positions?.[n.id] ?? { x: 700 - i * 260, y: 120 },
    data: { type: n.type, name: n.name, label: byType.get(n.type)?.label ?? n.type, group: byType.get(n.type)?.group ?? "", params: n.params },
  }));
  const edges: Edge[] = w.connections.map((c) => ({
    id: `${c.from}-${c.output ?? "main"}-${c.to}`,
    source: c.from, target: c.to, sourceHandle: c.output ?? "main", targetHandle: "in",
  }));
  return { nodes, edges };
}

function ParamField({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const [jsonText, setJsonText] = useState(() => (value === undefined || value === null ? "" : JSON.stringify(value, null, 2)));
  const [jsonErr, setJsonErr] = useState("");
  const id = `f-${field.key}`;

  let input;
  if (field.type === "select") {
    input = (
      <select id={id} value={String(value ?? field.default ?? "")} onChange={(e) => onChange(e.target.value)}>
        {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (field.type === "number") {
    input = <input id={id} type="number" value={String(value ?? field.default ?? "")} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
  } else if (field.type === "json") {
    input = (
      <>
        <textarea
          id={id} dir="ltr" rows={5} value={jsonText} placeholder={field.placeholder}
          onChange={(e) => {
            const t = e.target.value;
            setJsonText(t);
            if (t.trim() === "") { setJsonErr(""); onChange(undefined); return; }
            try { onChange(JSON.parse(t)); setJsonErr(""); } catch { setJsonErr("JSON معتبر نیست؛ آخرین مقدار معتبر نگه داشته می‌شود"); }
          }}
        />
        {jsonErr && <div className="field-err">{jsonErr}</div>}
      </>
    );
  } else if (field.type === "secret") {
    const saved = value === SECRET_PLACEHOLDER;
    input = (
      <input
        id={id} type="password" dir="ltr" autoComplete="off"
        value={saved ? "" : String(value ?? "")}
        placeholder={saved ? "•••••• (ذخیره‌شده؛ برای تغییر، مقدار تازه بنویسید)" : ""}
        onChange={(e) => onChange(e.target.value === "" && saved ? SECRET_PLACEHOLDER : e.target.value)}
      />
    );
  } else {
    input = <input id={id} type="text" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      {input}
    </div>
  );
}

function Inner({ id }: { id: string }) {
  const [types, setTypes] = useState<NodeTypeDef[]>([]);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [name, setName] = useState("");
  const [active, setActive] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Execution | null>(null);
  const [history, setHistory] = useState<ExecSummary[]>([]);
  const [runInput, setRunInput] = useState(SAMPLE_INPUT);
  const [busy, setBusy] = useState(false);
  const [bottom, setBottom] = useState<"result" | "history">("result");
  const counter = useRef(0);

  const load = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([api.nodeTypes(), api.get(id)]);
      setTypes(t);
      setWf(w);
      setName(w.name);
      setActive(w.active);
      const f = toFlow(w, t);
      setNodes(f.nodes);
      setEdges(f.edges);
      setDirty(false);
      api.executions(id).then(setHistory).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }, [id, setNodes, setEdges]);
  useEffect(() => { void load(); }, [load]);

  const selected = nodes.find((n) => n.selected);
  const typeDef = useMemo(() => types.find((t) => t.type === selected?.data.type), [types, selected?.data.type]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => addEdge({ ...c, id: `${c.source}-${c.sourceHandle}-${c.target}` }, es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle && e.target === c.target))));
    setDirty(true);
  }, [setEdges]);

  function addNode(t: NodeTypeDef) {
    counter.current += 1;
    const nid = `n${Date.now().toString(36)}${counter.current}`;
    const existing = new Set(nodes.map((n) => n.data.name));
    let k = 1;
    let nm = t.label;
    while (existing.has(nm)) { k += 1; nm = `${t.label} ${k}`; }
    const params: Record<string, unknown> = {};
    for (const f of t.fields) if (f.default !== undefined) params[f.key] = f.default;
    const maxX = nodes.length ? Math.min(...nodes.map((n) => n.position.x)) : 700;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), {
      id: nid, type: "card", selected: true, position: { x: maxX - 260, y: 120 + (nodes.length % 3) * 40 },
      data: { type: t.type, name: nm, label: t.label, group: t.group, params },
    }]);
    setDirty(true);
  }

  function patchSelected(fn: (d: FlowNode["data"]) => FlowNode["data"]) {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: fn(n.data) } : n)));
    setDirty(true);
  }

  function deleteSelected() {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setDirty(true);
  }

  function build() {
    return {
      name: name.trim(),
      active,
      nodes: nodes.map((n) => ({ id: n.id, name: n.data.name, type: n.data.type, params: n.data.params })),
      connections: edges.map((e) => ({ from: e.source, to: e.target, ...(e.sourceHandle && e.sourceHandle !== "main" ? { output: e.sourceHandle } : {}) })),
      positions: Object.fromEntries(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
    };
  }

  async function save(): Promise<boolean> {
    setError(""); setNotice("");
    try {
      const w = await api.update(id, build());
      setWf(w);
      const f = toFlow(w, types);
      // وضعیت اجرای قبلی روی گره‌ها حفظ می‌شود
      setNodes((old) => f.nodes.map((n) => ({ ...n, selected: old.find((o) => o.id === n.id)?.selected, data: { ...n.data, status: old.find((o) => o.id === n.id)?.data.status } })));
      setEdges(f.edges);
      setDirty(false);
      setNotice("ذخیره شد");
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  async function run() {
    let input: unknown[] | undefined;
    if (runInput.trim()) {
      try {
        const p = JSON.parse(runInput);
        if (!Array.isArray(p)) throw new Error();
        input = p;
      } catch { setError("ورودی آزمایشی باید یک فهرست JSON باشد، مثل [{\"نام\": \"علی\"}]"); return; }
    }
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      const ex = await api.run(id, input);
      setResult(ex);
      setBottom("result");
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: ex.runs.find((r) => r.nodeId === n.id)?.status === "success" ? "success" : ex.runs.find((r) => r.nodeId === n.id)?.status === "error" ? "error" : undefined } })));
      api.executions(id).then(setHistory).catch(() => {});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function toggleActive() {
    const next = !active;
    setActive(next);
    try {
      const w = await api.update(id, { ...build(), active: next });
      setWf(w);
      setNotice(next ? "گردش‌کار فعال شد؛ وب‌هوک آماده است" : "گردش‌کار غیرفعال شد");
    } catch (e) { setActive(!next); setError((e as Error).message); }
  }

  async function openExec(eid: string) {
    try { setResult(await api.execution(eid)); setBottom("result"); } catch (e) { setError((e as Error).message); }
  }

  if (!wf) return <section className="page">{error ? <div className="alert">{error}</div> : <p className="muted">در حال بارگذاری…</p>}</section>;

  const groups = [...new Set(types.map((t) => t.group))];
  const hook = `${location.origin}/webhook/${id}`;
  const dupName = selected && nodes.some((n) => n.id !== selected.id && n.data.name === selected.data.name);

  return (
    <div className="editor">
      <div className="toolbar">
        <a href="#/" className="back">→ گردش‌کارها</a>
        <input className="name-input" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="نام گردش‌کار" />
        {dirty && <span className="muted">ذخیره نشده</span>}
        {notice && !dirty && <span className="ok-text">{notice}</span>}
        <span className="spacer" />
        <button onClick={toggleActive}>{active ? "غیرفعال کردن" : "فعال‌سازی وب‌هوک"}</button>
        <button onClick={save} disabled={!dirty}>ذخیره</button>
        <button className="primary" onClick={run} disabled={busy}>{busy ? "در حال اجرا…" : "▶ اجرا"}</button>
      </div>
      {error && <div className="alert" onClick={() => setError("")}>{error} <small>(برای بستن کلیک کنید)</small></div>}
      {active && (
        <div className="hook">
          نشانی وب‌هوک (با POST و بدنه‌ی JSON): <code dir="ltr">{hook}</code>
          <button onClick={() => navigator.clipboard?.writeText(hook).then(() => setNotice("نشانی کپی شد"))}>کپی</button>
        </div>
      )}

      <div className="body">
        <aside className="palette">
          <h3>گره‌ها</h3>
          {groups.map((g) => (
            <div key={g}>
              <div className="pal-group">{g}</div>
              {types.filter((t) => t.group === g).map((t) => (
                <button key={t.type} className="pal-item" title={t.description} onClick={() => addNode(t)}>+ {t.label}</button>
              ))}
            </div>
          ))}
        </aside>

        <div className="canvas" dir="ltr">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" || x.type === "remove")) setDirty(true); }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === "remove")) setDirty(true); }}
            onConnect={onConnect} fitView fitViewOptions={{ padding: 0.3 }} deleteKeyCode={["Delete", "Backspace"]}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="panel">
          {!selected && (
            <div className="muted">
              <h3>تنظیمات گره</h3>
              <p>روی یک گره کلیک کنید تا تنظیماتش را ببینید. برای وصل کردن، از دایره‌ی کنار گره بکشید.</p>
              <h3>ورودی آزمایشی</h3>
              <textarea dir="ltr" rows={6} value={runInput} onChange={(e) => setRunInput(e.target.value)} aria-label="ورودی آزمایشی" />
              <p>فهرستی از شیءها که به محرک داده می‌شود. با وب‌هوک، داده‌ها در «body» می‌آیند.</p>
            </div>
          )}
          {selected && typeDef && (
            <div>
              <h3>{typeDef.label}</h3>
              <p className="muted">{typeDef.description}</p>
              <div className="field">
                <label htmlFor="f-name">نام گره</label>
                <input id="f-name" value={selected.data.name} onChange={(e) => patchSelected((d) => ({ ...d, name: e.target.value }))} />
                {dupName && <div className="field-err">این نام تکراری است؛ ذخیره نمی‌شود</div>}
              </div>
              {typeDef.fields.map((f) => (
                <ParamField key={`${selected.id}-${f.key}`} field={f} value={selected.data.params[f.key]}
                  onChange={(v) => patchSelected((d) => ({ ...d, params: { ...d.params, [f.key]: v } }))} />
              ))}
              <button className="danger" onClick={deleteSelected}>حذف این گره</button>
            </div>
          )}
        </aside>
      </div>

      <div className="bottom">
        <div className="tabs">
          <button className={bottom === "result" ? "on" : ""} onClick={() => setBottom("result")}>نتیجه‌ی اجرا</button>
          <button className={bottom === "history" ? "on" : ""} onClick={() => setBottom("history")}>تاریخچه</button>
        </div>
        {bottom === "result" && (
          <div className="results">
            {!result && <p className="muted">هنوز اجرا نشده. دکمه‌ی «اجرا» را بزنید.</p>}
            {result && (
              <>
                <div className={`exec-head ${result.status}`}>
                  {result.status === "success" ? "اجرا موفق بود" : `اجرا ناموفق: ${result.error ?? ""}`}
                  <small> — {faDate(result.startedAt)} — {result.mode === "webhook" ? "وب‌هوک" : "دستی"}</small>
                </div>
                {result.runs.map((r, i) => (
                  <details key={i} open={r.status === "error"} className={`run ${r.status}`}>
                    <summary>{r.status === "success" ? "✓" : "✕"} {r.nodeName} <small>({faNum(r.durationMs)} میلی‌ثانیه)</small></summary>
                    {r.error && <div className="field-err">{r.error}</div>}
                    <div className="io">
                      <div><b>ورودی</b><pre dir="ltr">{JSON.stringify(r.input, null, 2)}</pre></div>
                      <div><b>خروجی</b><pre dir="ltr">{JSON.stringify(r.output, null, 2)}</pre></div>
                    </div>
                  </details>
                ))}
              </>
            )}
          </div>
        )}
        {bottom === "history" && (
          <div className="results">
            {history.length === 0 && <p className="muted">اجرایی ثبت نشده.</p>}
            {history.map((h) => (
              <button key={h.id} className={`hist ${h.status}`} onClick={() => openExec(h.id)}>
                {h.status === "success" ? "✓ موفق" : "✕ ناموفق"} — {h.mode === "webhook" ? "وب‌هوک" : "دستی"} — {faDate(h.startedAt)}
                {h.error ? ` — ${h.error}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Editor({ id }: { id: string }) {
  return <ReactFlowProvider><Inner id={id} /></ReactFlowProvider>;
}
