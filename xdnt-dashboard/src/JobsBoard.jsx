import React, { useState, useRef, useEffect } from "react";
import {
  todayISO, addDaysISO, diffDays, PLAN_STAGE_COUNT, PROJECT_STAGES,
  makeJob, makeNote, jobIsLate, parseJobDates, parseJobList,
  schedItems, schedDueItems, schedIsLate,
} from "./data/seed";
const stageName = (id) => PROJECT_STAGES.find((s) => s.id === id)?.label || "";

/* ---------------------------------------------------------------------- */
/*  VIỆC TRIỂN KHAI HẰNG NGÀY                                               */
/*  - mỗi dự án có danh sách việc chi tiết: project.jobs[]                   */
/*  - dán nguyên danh sách (kiểu Notion) → tự tách theo dự án / ngày / lưu ý  */
/*  - chế độ Hôm nay / 7 ngày tới / Tất cả; việc chưa xong tự báo "Trễ"        */
/* ---------------------------------------------------------------------- */

const fd = (s) => (s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "—");
const SAMPLE = `1. Anra MĐ Chi
    a. Sơn cửa ra vào
    b. Thay nẹp sàn bị hỏng
2. Anra 115 Ng.Trãi ⇒ chụp hình lại hết
    a. Nhận sàn gỗ 8 - 9h tối
    b. sáng 15.10: chở sàn gỗ cũ đi bỏ
    c. Thi công 2 đêm 14 - 15/10`;

function dueLabel(j, day) {
  if (!j.done && j.due < day) return { cls: "late", t: `Trễ ${diffDays(j.due, day)} ngày` };
  if (j.date !== j.due) return { cls: "", t: `${fd(j.date)}–${fd(j.due)}` };
  if (j.date === day) return { cls: "", t: "Hôm nay" };
  return { cls: "", t: fd(j.date) };
}

export function JobRow({ j, day, onToggle, onStar, onDel }) {
  const d = dueLabel(j, day);
  return (
    <div className={`jb-job ${j.done ? "done" : ""}`}>
      <input type="checkbox" checked={!!j.done} onChange={() => onToggle(j.id)} />
      <span className="jb-tx">{j.text}{j.stage ? <span className="jb-chip stage" style={{ marginLeft: 6 }}>B{j.stage} {stageName(j.stage)}</span> : null}</span>
      <span className={`jb-d ${d.cls}`}>{d.t}</span>
      <span className="jb-acts">
        <button className={`jb-star ${j.star ? "on" : ""}`} title="Đánh dấu quan trọng" onClick={() => onStar(j.id)}>★</button>
        <button className="jb-x" title="Xóa việc" onClick={() => onDel(j.id)}>×</button>
      </span>
    </div>
  );
}

export function QuickAdd({ onAdd, placeholder }) {
  const [t, setT] = useState("");
  const go = () => { if (t.trim()) { onAdd(t.trim()); setT(""); } };
  return (
    <div className="jb-add">
      <input className="input input-sm" value={t} placeholder={placeholder || "+ Thêm việc (Enter) — có thể gõ ngày: “giao sàn 15.10”"} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
      <button className="btn btn-outline btn-sm" disabled={!t.trim()} onClick={go}>Thêm</button>
    </div>
  );
}

// Thao tác sửa danh sách việc của 1 dự án (hàm thuần — dùng chung cho JobsBoard và panel chi tiết ở Gantt)
export function jobOps(p, updateProject, today) {
  const jobs = p.jobs || [];
  const save = (next) => updateProject(p.id, { jobs: next });
  return {
    toggle: (id) => save(jobs.map((j) => (j.id === id ? { ...j, done: !j.done, doneAt: !j.done ? todayISO() : null } : j))),
    star: (id) => save(jobs.map((j) => (j.id === id ? { ...j, star: !j.star } : j))),
    del: (id) => save(jobs.filter((j) => j.id !== id)),
    // text có ngày ("giao sàn 15.10") → dùng ngày đó; không có → tính cho ngày đang xem
    add: (text, day, stage) => {
      const dt = parseJobDates(text, today);
      const hasDate = /\d{1,2}\s*[/.]\s*\d{1,2}/.test(text);
      save([...jobs, makeJob({ text, stage, date: hasDate ? dt.date : (day || today), due: hasDate ? dt.due : (day || today) }, today)]);
    },
  };
}

// Hạng mục thi công (từ bảng "Tiến độ thi công") đang chạy hôm nay / trễ — sửa nhanh % tại chỗ
function SiteRow({ it, day, onPct }) {
  const late = schedIsLate(it, day);
  const [v, setV] = useState(String(it.pc));
  useEffect(() => { setV(String(it.pc)); }, [it.pc]);
  const commit = () => { const n = Math.max(0, Math.min(100, Math.round(+v) || 0)); if (n !== it.pc) onPct(it.id, n); else setV(String(it.pc)); };
  return (
    <div className={`jb-job jb-site ${it.pc >= 100 ? "done" : ""}`}>
      <span className="jb-sico" title="Hạng mục thi công">▣</span>
      <span className="jb-tx">{it.t}<span className="jb-chip stage" style={{ marginLeft: 6 }}>B{it.st} {stageName(it.st)}</span>{it.note ? <span className="jb-hint" style={{ marginLeft: 6 }}>· {it.note}</span> : null}</span>
      <span className={`jb-d ${late ? "late" : ""}`}>{late ? `Trễ ${diffDays(it.e, day)} ngày` : it.s === it.e ? fd(it.s) : `${fd(it.s)}–${fd(it.e)}`}</span>
      <span className="jb-acts" style={{ opacity: 1 }}>
        <input className="input input-sm jb-pc" type="number" min="0" max="100" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />%
      </span>
    </div>
  );
}

/* ---- Panel nhỏ trong chi tiết dự án ở Gantt ---- */
export function ProjectJobs({ p, today, updateProject, onOpenAll }) {
  const ops = jobOps(p, updateProject, today);
  const jobs = p.jobs || [];
  const open = jobs.filter((j) => !j.done).sort((a, b) => a.due.localeCompare(b.due));
  const late = open.filter((j) => jobIsLate(j, today)).length;
  const shown = open.slice(0, 8);
  return (
    <div className="tl-sec">
      <h4>Việc triển khai <span className="tl-src">{jobs.filter((j) => j.done).length}/{jobs.length} xong{late ? ` · ${late} trễ` : ""}</span></h4>
      {shown.length === 0 && <div className="tl-note">Chưa có việc nào đang mở.</div>}
      {shown.map((j) => <JobRow key={j.id} j={j} day={today} onToggle={ops.toggle} onStar={ops.star} onDel={ops.del} />)}
      {open.length > shown.length && <div className="tl-note">… và {open.length - shown.length} việc khác</div>}
      <QuickAdd onAdd={(t) => ops.add(t, today)} />
      <div className="tl-row2" style={{ marginTop: 4 }}><button className="btn btn-ghost btn-sm" onClick={onOpenAll}>Xem tất cả việc của dự án →</button></div>
    </div>
  );
}

/* ---- Hộp thoại dán danh sách ---- */
function PasteDialog({ projects, today, onClose, onApply }) {
  const [step, setStep] = useState(1);
  const [text, setText] = useState("");
  const [groups, setGroups] = useState([]);
  const analyse = () => { setGroups(parseJobList(text, projects, today)); setStep(2); };
  const setG = (gi, patch) => setGroups(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setItem = (gi, ii, on) => setGroups(groups.map((g, i) => (i === gi ? { ...g, items: g.items.map((it, k) => (k === ii ? { ...it, on } : it)) } : g)));
  const total = groups.reduce((s, g) => s + (g.pid && g.pid !== "_skip" ? g.items.filter((i) => i.on).length : 0), 0);
  const unassigned = groups.some((g) => !g.pid);
  return (
    <div className="jb-ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="jb-dlg">
        {step === 1 ? (
          <>
            <h3>Dán danh sách việc</h3>
            <p className="jb-hint">Dán nguyên danh sách như trong Notion (đánh số 1. 2. và a. b.). App tự nhận tên dự án, ngày (15.10, 14 - 15/10) và dòng “⇒ …” làm Lưu ý của dự án.</p>
            <textarea className="input jb-ta" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} />
            <div className="jb-foot">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Đóng</button>
              <button className="btn btn-outline btn-sm" onClick={() => setText(SAMPLE)}>Điền mẫu</button>
              <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={analyse}>Phân tích</button>
            </div>
          </>
        ) : (
          <>
            <h3>Kiểm tra trước khi thêm</h3>
            <p className="jb-hint">Chọn dự án cho từng nhóm (nhóm chưa nhận ra thì chọn lại hoặc bỏ qua). Bỏ tích dòng nào không muốn thêm.</p>
            {groups.length === 0 && <div className="tl-note">Không nhận ra nhóm nào — kiểm tra lại cách đánh số (1. … / a. …).</div>}
            {groups.map((g, gi) => (
              <div className="jb-pv" key={gi}>
                <div className="jb-pvh">
                  <b>{g.title}</b>
                  <select className="input input-sm" value={g.pid} onChange={(e) => setG(gi, { pid: e.target.value })}>
                    <option value="">— Chọn dự án —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.code.slice(5)} · {p.name}</option>)}
                    <option value="_skip">Bỏ qua nhóm này</option>
                  </select>
                  {g.note && <span className="jb-chip note">⚑ Lưu ý: {g.note}</span>}
                </div>
                {g.items.map((it, ii) => (
                  <label className="jb-pvi" key={ii}>
                    <input type="checkbox" checked={it.on} onChange={(e) => setItem(gi, ii, e.target.checked)} />
                    <span>{it.text}</span>
                    <span className="jb-d">{it.date === it.due ? (it.date === today ? "Hôm nay" : fd(it.date)) : `${fd(it.date)}–${fd(it.due)}`}</span>
                  </label>
                ))}
              </div>
            ))}
            <div className="jb-foot">
              <span className="jb-hint" style={{ marginRight: "auto" }}>{total} việc sẽ được thêm{unassigned ? " · còn nhóm chưa chọn dự án" : ""}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>‹ Sửa lại</button>
              <button className="btn btn-primary btn-sm" disabled={unassigned || !total} onClick={() => onApply(groups)}>Thêm {total} việc</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Trang chính ---- */
export function JobsBoard({ projects, updateProject, focusPid, onOpenProject }) {
  const today = todayISO();
  const active = projects.filter((p) => p.status !== "closed").sort((a, b) => a.code.localeCompare(b.code));
  const [range, setRange] = useState("today");
  const [day, setDay] = useState(today);
  const [pid, setPid] = useState(focusPid || null);
  const [dlg, setDlg] = useState(false);
  const [toast, setToast] = useState("");
  const tRef = useRef(null);
  useEffect(() => () => clearTimeout(tRef.current), []);
  const say = (m) => { setToast(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setToast(""), 4000); };

  const visible = (j) => {
    if (pid || range === "all") return true;
    if (!j.done && j.due < day) return true; // việc trễ luôn hiện
    const hi = range === "week" ? addDaysISO(day, 6) : day;
    return j.date <= hi && j.due >= day;
  };
  const scope = pid ? active.filter((p) => p.id === pid) : active;
  const siteFor = (p) => {
    const hi = pid || range === "all" ? "9999-12-31" : range === "week" ? addDaysISO(day, 6) : day;
    return schedDueItems(p, pid || range === "all" ? "0000-01-01" : day, hi).sort((a, b) => a.s.localeCompare(b.s));
  };
  const groups = scope.map((p) => ({ p, items: (p.jobs || []).filter(visible).sort((a, b) => Number(!!a.done) - Number(!!b.done) || a.due.localeCompare(b.due)), site: siteFor(p) }))
    .filter((g) => pid || g.items.length > 0 || g.site.length > 0);

  const allJobs = scope.flatMap((p) => p.jobs || []);
  const shown = groups.flatMap((g) => g.items);
  const doneN = shown.filter((j) => j.done).length;
  const lateN = allJobs.filter((j) => jobIsLate(j, day)).length;
  const starN = allJobs.filter((j) => !j.done && j.star).length;
  const pc = shown.length ? Math.round((doneN * 100) / shown.length) : 0;

  const apply = (gs) => {
    const byP = {};
    let added = 0, dup = 0, notes = 0;
    gs.forEach((g) => {
      if (!g.pid || g.pid === "_skip") return;
      const p = active.find((x) => x.id === g.pid);
      if (!p) return;
      const acc = (byP[p.id] = byP[p.id] || { p, jobs: [...(p.jobs || [])], notes: [...(p.notes || [])] });
      g.items.filter((i) => i.on).forEach((it) => {
        if (acc.jobs.some((j) => j.text === it.text && j.date === it.date)) { dup += 1; return; }
        acc.jobs.push(makeJob({ text: it.text, date: it.date, due: it.due }, today)); added += 1;
      });
      if (g.note && !acc.notes.some((n) => !n.resolved && n.text === g.note)) {
        acc.notes.push(makeNote({ stage: Math.min(p.currentStage, PLAN_STAGE_COUNT), type: "note", text: g.note })); notes += 1;
      }
    });
    Object.values(byP).forEach((a) => updateProject(a.p.id, { jobs: a.jobs, notes: a.notes }));
    setDlg(false);
    say(`Đã thêm ${added} việc${notes ? ` và ${notes} lưu ý` : ""}${dup ? ` · bỏ qua ${dup} dòng đã có` : ""}`);
  };

  return (
    <div className="jb">
      <div className="jb-top">
        <div>
          <h3 style={{ margin: 0 }}>Việc triển khai hằng ngày</h3>
          <div className="jb-hint">Danh sách việc chi tiết của từng dự án. Việc chưa xong tự chuyển sang ngày sau và báo “Trễ”.</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setDlg(true)}>Dán danh sách</button>
      </div>

      <div className="jb-bar">
        {pid ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setPid(null)}>‹ Tất cả dự án</button>
        ) : (
          <>
            <div className="tl-seg">
              {[["today", "Hôm nay"], ["week", "7 ngày tới"], ["all", "Tất cả"]].map(([k, l]) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>)}
            </div>
            {range !== "all" && (
              <div className="jb-date">
                <button onClick={() => setDay(addDaysISO(day, -1))}>‹</button>
                <b>{day === today ? "Hôm nay · " : ""}{fd(day)}</b>
                <button onClick={() => setDay(addDaysISO(day, 1))}>›</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="jb-grid">
        <div className="jb-card">
          {groups.length === 0 && <div className="jb-empty">Không có việc nào trong khoảng này.<br /><span className="jb-hint">Dùng “Dán danh sách” hoặc thêm việc cho từng dự án.</span></div>}
          {groups.map(({ p, items, site }) => {
            const all = p.jobs || [];
            const setPct = (id, n) => updateProject(p.id, { schedule: { ...(p.schedule || {}), items: schedItems(p).map((x) => (x.id === id ? { ...x, pc: n } : x)) } });
            const lateSite = site.filter((x) => schedIsLate(x, day)).length;
            const dn = all.filter((j) => j.done).length;
            const late = items.filter((j) => jobIsLate(j, day)).length;
            const ops = jobOps(p, updateProject, today);
            const stg = PROJECT_STAGES.find((s) => s.id === p.currentStage);
            return (
              <div className="jb-grp" key={p.id}>
                <div className="jb-gh">
                  <span className="jb-nm" onClick={() => { setPid(p.id); }}>{p.name}</span>
                  <span className="jb-cu">{p.customerName}</span>
                  {stg && <span className="jb-chip stage">{stg.label}</span>}
                  {late + lateSite > 0 && <span className="jb-chip late">{late + lateSite} việc trễ</span>}
                  <span className="jb-cnt">{dn}/{all.length} xong</span>
                </div>
                {(p.notes || []).filter((n) => !n.resolved && n.type === "note").map((n) => (
                  <div className="jb-note" key={n.id}>⚑ <span><b>Lưu ý:</b> {n.text}</span></div>
                ))}
                {site.length > 0 && <div className="jb-sitehd">Thi công theo tiến độ · {site.length} hạng mục</div>}
                {site.map((it) => <SiteRow key={it.id} it={it} day={day} onPct={setPct} />)}
                {items.map((j) => <JobRow key={j.id} j={j} day={day} onToggle={ops.toggle} onStar={ops.star} onDel={ops.del} />)}
                <QuickAdd onAdd={(t) => ops.add(t, day)} />
              </div>
            );
          })}
        </div>

        <div className="jb-side">
          <div className="jb-card jb-pad">
            <h4>{pid ? scope[0]?.name : "Tiến độ trong khoảng này"}</h4>
            <div className="jb-prog"><i style={{ width: `${pc}%` }} /></div>
            <div className="jb-kv"><span>Đã xong</span><b>{doneN}/{shown.length}</b></div>
            <div className="jb-kv"><span>Việc trễ hạn</span><b style={{ color: lateN ? "var(--red)" : "inherit" }}>{lateN}</b></div>
            <div className="jb-kv"><span>Việc quan trọng ★</span><b>{starN}</b></div>
            {pid && onOpenProject && <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => onOpenProject(pid)}>Xem trên lịch Gantt →</button>}
          </div>
          <div className="jb-card jb-pad">
            <h4>Liên kết với các phần khác</h4>
            <div className="jb-hint" style={{ lineHeight: 1.6 }}>
              • Hạng mục ở tab <b>Tiến độ thi công</b> đang chạy hôm nay (hoặc trễ) tự hiện ở đây — sửa % ngay tại chỗ.<br />
              • Dòng “⇒ …” khi dán thành <b>Lưu ý</b> của dự án (xem ở panel chi tiết trên Gantt).<br />
              • Việc trễ và việc ★ hiện trong danh sách <b>Cần xử lý hôm nay</b> của lịch Gantt.<br />
              • Dự án chỉ lưu trữ được khi không còn việc mở.
            </div>
          </div>
        </div>
      </div>

      {dlg && <PasteDialog projects={active} today={today} onClose={() => setDlg(false)} onApply={apply} />}
      {toast && <div className="tl-toast"><span>{toast}</span></div>}
    </div>
  );
}
