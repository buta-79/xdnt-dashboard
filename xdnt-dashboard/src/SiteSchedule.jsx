import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  todayISO, addDaysISO, diffDays, PROJECT_STAGES,
  SCHED_WHO, SCHED_STAGE_IDS, SCHED_TEMPLATES, isSunday,
  schedWdays, schedEndFromDays, schedPct, schedRange, schedDerive, schedIsLate, schedItems, schedGroups,
  makeSchedItem, makeSchedGroup, parseSchedule, schedFromTemplate, projectPlan,
  schedSetDone, schedPullForward, schedVariance, schedBaseEnd, schedPending, schedDecide, schedDoneMessage,
} from "./data/seed";

/* ---------------------------------------------------------------------- */
/*  TIẾN ĐỘ THI CÔNG — bảng hạng mục chi tiết của từng dự án (kiểu Excel)    */
/*  - project.schedule = { groups[], items[] }  (xem seed.js)                */
/*  - các bước Duyệt mẫu / Manufacturing / Construction / QC / Bàn giao ở     */
/*    kế hoạch 12 bước TỰ LẤY ngày & % từ bảng này                           */
/*  - dán từ Excel · nhập tay · mẫu nhanh                                    */
/* ---------------------------------------------------------------------- */

const d2n = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const n2d = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const fd = (s) => (s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "—");
const fdy = (s) => (s ? fd(s) + "/" + s.slice(0, 4) : "—");
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const stageName = (id) => PROJECT_STAGES.find((s) => s.id === id)?.label || "";
const DW = 24;
// Nhãn sớm / trễ của 1 hạng mục (xem schedVariance): đã xong → so với hạn kế hoạch lúc bấm xong; chưa xong nhưng bị dời → so với kế hoạch gốc
export function varLabel(it) {
  if (schedPending(it)) return { cls: "pend", t: `chờ BOD duyệt · xong thực tế ${fd(it.bd.date)}` };
  const v = schedVariance(it);
  if (!v) return null;
  const done = !!it.doneAt;
  return { cls: v > 0 ? "early" : "late", t: v > 0 ? `${done ? "xong sớm" : "dời sớm"} ${v} ngày` : `${done ? "xong trễ" : "dời trễ"} ${-v} ngày` };
}

/* ---- Hộp thoại "Hoàn thành hạng mục": chọn ngày hoàn thành thực tế (dùng chung ở 3 nơi) ---- */
export function DoneDialog({ item, today, role, onConfirm, onClose }) {
  const yesterday = addDaysISO(today, -1);
  const [mode, setMode] = useState("today");
  const [date, setDate] = useState(item.e < today ? item.e : yesterday);
  const [reason, setReason] = useState("");
  const chosen = mode === "today" ? today : date;
  const v = diffDays(chosen, item.e); // > 0 sớm, < 0 trễ
  const verdict = v > 0 ? `sớm ${v} ngày so với hạn ${fd(item.e)}` : v < 0 ? `trễ ${-v} ngày so với hạn ${fd(item.e)}` : `đúng hạn (${fd(item.e)})`;
  const isBOD = role === "BOD";
  const ok = mode === "today" || (!!date && date <= yesterday && (isBOD || reason.trim().length > 0));
  return (
    <div className="ss-ov" onClick={onClose}>
      <div className="ss-dlg ss-dlgs" onClick={(e) => e.stopPropagation()}>
        <h3>Hoàn thành “{item.t}”</h3>
        <p className="ss-hint">Kế hoạch: {fd(item.s)} → {fd(item.e)}</p>
        <label className="ss-rad"><input type="radio" checked={mode === "today"} onChange={() => setMode("today")} /> <span>Vừa xong <b>hôm nay</b> ({fd(today)})</span></label>
        <label className="ss-rad"><input type="radio" checked={mode === "back"} onChange={() => setMode("back")} /> <span>Thực tế <b>đã xong từ trước</b> (quên cập nhật) — ngày hoàn thành thực tế:
          <input type="date" className="input input-sm" style={{ marginLeft: 6 }} value={date} max={yesterday} onFocus={() => setMode("back")} onChange={(e) => { setDate(e.target.value); setMode("back"); }} /></span></label>
        {mode === "back" && (
          <>
            <textarea className="ss-ta ss-ta-s" placeholder={isBOD ? "Ghi chú (không bắt buộc)" : "Lý do / bằng chứng nhập bù (bắt buộc) — VD: đã bàn giao hôm 18/10, có biên bản"} value={reason} onChange={(e) => setReason(e.target.value)} />
            {!isBOD && <div className="tl-warnbox" style={{ marginTop: 6 }}>Chỉ <b>BOD</b> được duyệt ngày hoàn thành đã qua. Hạng mục sẽ ghi nhận <b>xong hôm nay</b> và hiện “chờ BOD duyệt”; khi BOD duyệt mới tính theo ngày {fd(date)}.</div>}
          </>
        )}
        <div className={`ss-verdict ${v < 0 ? "bad" : "good"}`}>{mode === "back" && !isBOD ? `Nếu BOD duyệt: ${verdict}` : `Kết quả: ${verdict}`}</div>
        <div className="ss-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary btn-sm" disabled={!ok} onClick={() => onConfirm({ date: mode === "back" ? date : today, reason: reason.trim() })}>{mode === "back" && !isBOD ? "Gửi BOD duyệt" : "Xác nhận hoàn thành"}</button>
        </div>
      </div>
    </div>
  );
}

// Ô nhập: chốt khi rời ô / Enter / sau 0,8 giây — không ghi Firestore từng phím gõ
function Cell({ type, value, onCommit, className, min, max, placeholder, title }) {
  const [text, setText] = useState(String(value ?? ""));
  const timer = useRef(null);
  const last = useRef(String(value ?? ""));
  useEffect(() => { setText(String(value ?? "")); last.current = String(value ?? ""); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v, final) => {
    clearTimeout(timer.current);
    if (type !== "text" && v === "") { if (final) setText(last.current); return; }
    if (v !== last.current) { last.current = v; onCommit(v); }
  };
  return (
    <input type={type} className={className} min={min} max={max} placeholder={placeholder} title={title} value={text}
      onChange={(e) => { const v = e.target.value; setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => commit(v), 800); }}
      onBlur={(e) => commit(e.target.value, true)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.target.value, true); }} />
  );
}

/* ---- Hộp thoại dán từ Excel ---- */
const SAMPLE = `I\tChuẩn bị
1\tChốt bản vẽ, shop draw\t05/10\t11/10\t6 Ngày\tNHÀ THẦU & CĐT
2\tTrình & duyệt mẫu vật tư\t05/10\t11/10\t6 Ngày\tNHÀ THẦU & CĐT
II\tXDCB + MEP
1\tTháo dỡ\t06/10\t07/10\t2 Ngày\tNHÀ THẦU
2\tMEP âm tường, âm sàn, thả trần\t08/10\t13/10\t5 Ngày\tNHÀ THẦU
III\tThi công hoàn thiện
1\tSản xuất phần nội thất\t11/10\t23/10\t11 Ngày\tNHÀ THẦU
2\tBàn giao\t31/10\t31/10\t1 Ngày\tCĐT`;

function PasteDialog({ today, hasItems, onClose, onApply }) {
  const [step, setStep] = useState(1);
  const [text, setText] = useState("");
  const [groups, setGroups] = useState([]);
  const [mode, setMode] = useState("replace");
  const n = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="ss-ov" onClick={onClose}>
      <div className="ss-dlg" onClick={(e) => e.stopPropagation()}>
        {step === 1 ? (
          <>
            <h3>Dán bảng tiến độ từ Excel</h3>
            <p className="ss-hint">Bôi các cột STT · Hạng mục · Bắt đầu · Kết thúc · Thời lượng · Thực hiện trong Excel (kể cả dòng nhóm I, II, III) rồi dán vào đây. Cột “Thuộc bước” hệ thống tự đoán theo tên hạng mục, bạn chỉnh lại sau.</p>
            <textarea className="ss-ta" value={text} placeholder="Dán nội dung đã copy từ Excel…" onChange={(e) => setText(e.target.value)} />
            <div className="ss-foot">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Đóng</button>
              <button className="btn btn-outline btn-sm" onClick={() => setText(SAMPLE)}>Điền mẫu</button>
              <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => { setGroups(parseSchedule(text, today)); setStep(2); }}>Phân tích</button>
            </div>
          </>
        ) : (
          <>
            <h3>Kiểm tra trước khi thêm</h3>
            {n === 0 ? <div className="tl-warnbox">Không nhận ra dòng nào có ngày tháng (dạng 05/10 hoặc 05/10/2026). Kiểm tra lại các cột đã copy.</div> : (
              <p className="ss-hint">Nhận được {groups.length} nhóm, {n} hạng mục.</p>
            )}
            <div className="ss-prev">
              {groups.map((g, gi) => (
                <div key={gi} className="ss-pg">
                  <div className="ss-pgh"><b>{g.name}</b><span>{g.items.length} hạng mục</span></div>
                  {g.items.map((i, ii) => (
                    <div key={ii} className="ss-pi"><span className="t">{i.t}</span><span className="d">{fd(i.s)} → {fd(i.e)} · {schedWdays(i.s, i.e)} ngày · {i.who} · bước {i.st}</span></div>
                  ))}
                </div>
              ))}
            </div>
            {n > 0 && hasItems && (
              <div className="ss-opt">
                <label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Thay thế bảng hiện tại (giữ lại % và ghi chú của hạng mục trùng tên)</label>
                <label><input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /> Thêm vào cuối bảng hiện tại</label>
              </div>
            )}
            <div className="ss-foot">
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(1)}>‹ Quay lại</button>
              <button className="btn btn-primary btn-sm" disabled={n === 0} onClick={() => onApply(groups, mode)}>Áp dụng</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Gantt theo ngày ---- */
function SiteGantt({ groups, items, collapsed, today }) {
  const r = schedRange(items);
  if (!r) return null;
  const mn = d2n(r.s) - 2, mx = d2n(r.e) + 3, W = (mx - mn + 1) * DW;
  const tx = (d2n(today) - mn) * DW + DW / 2;
  const months = [];
  for (let cur = mn; cur <= mx;) {
    const d = new Date(cur * 86400000);
    const mEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86400000 - 1;
    const last = Math.min(mEnd, mx);
    months.push({ w: (last - cur + 1) * DW, label: `Th${d.getUTCMonth() + 1}/${d.getUTCFullYear()}` });
    cur = last + 1;
  }
  const days = [];
  for (let x = mn; x <= mx; x++) days.push(n2d(x));
  const Bg = () => <div className="ss-gbg">{days.map((d) => <div key={d} className={isSunday(d) ? "sun" : ""} />)}</div>;
  const rows = [];
  groups.forEach((g) => {
    const gs = items.filter((i) => i.gid === g.id);
    const gr = schedRange(gs);
    rows.push({ k: "g:" + g.id, h: 30, name: <div className="ss-gname grp">{g.name}</div>, bar: gr && <div className="ss-gbar sum" style={{ left: (d2n(gr.s) - mn) * DW, width: (diff(gr.s, gr.e) + 1) * DW - 2 }}><i style={{ width: `${schedPct(gs)}%` }} /></div> });
    if (collapsed[g.id]) return;
    gs.forEach((it, ii) => rows.push({
      k: it.id, h: 26,
      name: <div className="ss-gname" title={it.t}><span className="n">{ii + 1}</span>{it.t}</div>,
      bar: <>
        {it.e0 && it.e0 !== it.e && <div className="ss-gbase" title={`Kế hoạch gốc: ${fd(it.s0 || it.s)} → ${fd(it.e0)}`} style={{ left: (d2n(it.s0 || it.s) - mn) * DW, width: Math.max(DW - 2, (diff(it.s0 || it.s, it.e0) + 1) * DW - 2) }} />}
        <div className={`ss-gbar ${it.pc >= 100 ? "dn" : schedIsLate(it, today) ? "late" : ""}`} title={`${it.t}: ${fd(it.s)} → ${fd(it.e)} · ${it.pc}%${varLabel(it) ? " · " + varLabel(it).t : ""}`}
          style={{ left: (d2n(it.s) - mn) * DW, width: Math.max(DW - 2, (diff(it.s, it.e) + 1) * DW - 2) }}><i style={{ width: `${it.pc}%` }} /><span>{it.pc}%</span></div></>,
    }));
  });
  return (
    <div className="ss-gwrap">
      <div className="ss-gnames">
        <div style={{ height: 48, borderBottom: "1px solid var(--line)" }} />
        {rows.map((r2) => <div key={r2.k} className="ss-grow" style={{ height: r2.h }}>{r2.name}</div>)}
      </div>
      <div className="ss-gscroll">
        <div style={{ width: W, position: "relative" }}>
          <div className="ss-gm">{months.map((m, i) => <div key={i} style={{ flex: `0 0 ${m.w}px` }}>{m.label}</div>)}</div>
          <div className="ss-gh">{days.map((d) => <div key={d} className={isSunday(d) ? "sun" : ""}><div>{d.slice(8)}</div><div className="w">{WD[new Date(d2n(d) * 86400000).getUTCDay()]}</div></div>)}</div>
          {rows.map((r2) => <div key={r2.k} className="ss-grow" style={{ height: r2.h }}><Bg />{r2.bar}</div>)}
          <div className="ss-today" style={{ left: tx }} />
        </div>
      </div>
    </div>
  );
}
const diff = (a, b) => diffDays(a, b);

/* ====================================================================== */
export default function SiteSchedule({ projects, updateProject, focusPid, onOpenPlan, currentRole }) {
  const today = todayISO();
  const active = useMemo(() => projects.filter((p) => p.status !== "closed").sort((a, b) => a.code.localeCompare(b.code)), [projects]);
  const [pid, setPid] = useState(focusPid || null);
  const [collapsed, setCollapsed] = useState({});
  const [dlg, setDlg] = useState(false);
  const [tpl, setTpl] = useState("fb");
  const [tplStart, setTplStart] = useState(today);
  const [askDelG, setAskDelG] = useState(null);
  const [tplAsk, setTplAsk] = useState(false);
  const [doneFor, setDoneFor] = useState(null); // id hạng mục đang mở hộp thoại hoàn thành
  const [toast, setToast] = useState(null);
  const tRef = useRef(null);
  useEffect(() => () => clearTimeout(tRef.current), []);

  const p = active.find((x) => x.id === pid) || active.find((x) => schedItems(x).length) || active[0] || null;
  const groups = p ? schedGroups(p) : [];
  const items = p ? schedItems(p) : [];
  const plan = useMemo(() => (p ? projectPlan(p) : null), [p]);

  const say = (msg, undo, act) => { setToast({ msg, undo: undo || null, act: act || null }); clearTimeout(tRef.current); tRef.current = setTimeout(() => setToast(null), act ? 12000 : 6500); };
  // Ghi cả bảng schedule lên dự án, kèm Hoàn tác (và 1 nút hành động tuỳ chọn)
  const save = (next, msg, act) => {
    const prev = p.schedule || null;
    updateProject(p.id, { schedule: next });
    if (msg) say(msg, () => { updateProject(p.id, { schedule: prev }); setToast(null); }, act);
  };
  // Tick hoàn thành → mở hộp thoại chọn ngày thực tế; bỏ tick → trả về kế hoạch trước khi bấm xong
  const toggleDone = (id, done) => {
    if (done) { setDoneFor(id); return; }
    const it = items.find((x) => x.id === id);
    if (it && it.bd && it.bd.status === "approved" && currentRole !== "BOD") { say("Hạng mục này đã được BOD duyệt ngày hoàn thành — chỉ BOD được bỏ đánh dấu xong"); return; }
    const r = schedSetDone(items, id, false, today);
    save({ groups, items: r.items }, schedDoneMessage(it.t, false, r));
  };
  const confirmDone = (id, { date, reason }) => {
    setDoneFor(null);
    const it = items.find((x) => x.id === id);
    const r = schedSetDone(items, id, true, today, { date, reason, role: currentRole, by: currentRole });
    let act = null;
    if (r.early > 0) {
      act = { label: `Dời các hạng mục sau sớm ${r.early} ngày`, fn: () => {
        const q = schedPullForward(r.items, id, r.early, today);
        updateProject(p.id, { schedule: { groups, items: q.items } });
        say(q.moved ? `Đã dời sớm ${q.moved} hạng mục nối sau — thời gian bàn giao rút ngắn tương ứng` : "Không có hạng mục nào dời được (đã sát hôm nay hoặc không nối sau)", () => { updateProject(p.id, { schedule: { groups, items: r.items } }); setToast(null); });
      } };
    }
    save({ groups, items: r.items }, schedDoneMessage(it.t, true, r), act);
  };
  const decide = (id, approve) => {
    const it = items.find((x) => x.id === id);
    save({ groups, items: schedDecide(items, id, approve, currentRole, today) }, approve ? `BOD đã duyệt “${it.t}” hoàn thành ngày ${fd(it.bd.date)}` : `Đã từ chối ngày nhập bù của “${it.t}” — giữ nguyên xong hôm nay`);
  };
  const setItems = (nextItems, msg) => save({ groups, items: nextItems }, msg);
  const editItem = (id, f, v) => {
    if (f === "pc") {
      const n = Math.round(+v) || 0;
      const cur = items.find((x) => x.id === id);
      if (n >= 100) { if (!(cur.doneAt && cur.pc >= 100)) toggleDone(id, true); return; }  // 100% = hoàn thành
      if (cur.doneAt) { // đang ở trạng thái xong mà hạ % → bỏ hoàn thành rồi đặt %
        const r = schedSetDone(items, id, false, today);
        setItems(r.items.map((x) => (x.id === id ? { ...x, pc: Math.max(0, n) } : x)));
        return;
      }
    }
    setItems(items.map((it) => {
      if (it.id !== id) return it;
      const x = { ...it };
      if (f === "s") { x.s = v; if (x.e < x.s) x.e = x.s; }
      else if (f === "e") { x.e = v < x.s ? x.s : v; }
      else if (f === "d") { x.e = schedEndFromDays(x.s, Math.max(0, Math.round(+v) || 0)); }
      else if (f === "pc") x.pc = Math.max(0, Math.min(99, Math.round(+v) || 0));
      else if (f === "st") x.st = +v;
      else x[f] = v;
      return x;
    }));
  };
  const addItem = (gid) => {
    const mine = items.filter((i) => i.gid === gid);
    const last = mine[mine.length - 1];
    const s = last ? last.e : (schedRange(items)?.s || today);
    const it = makeSchedItem({ gid, s, e: s });
    // chèn ngay sau hạng mục cuối của nhóm đó
    const idx = last ? items.indexOf(last) + 1 : items.length;
    setItems([...items.slice(0, idx), it, ...items.slice(idx)]);
  };
  const delItem = (id) => setItems(items.filter((i) => i.id !== id), "Đã xóa 1 hạng mục");
  const addGroup = () => {
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][groups.length] || String(groups.length + 1);
    save({ groups: [...groups, makeSchedGroup(`${roman} · Nhóm mới`)], items });
  };
  const renameGroup = (gid, name) => save({ groups: groups.map((g) => (g.id === gid ? { ...g, name } : g)), items });
  const delGroup = (gid) => { save({ groups: groups.filter((g) => g.id !== gid), items: items.filter((i) => i.gid !== gid) }, "Đã xóa nhóm"); setAskDelG(null); };

  const keepOld = (it) => items.find((o) => o.t.trim().toLowerCase() === it.t.trim().toLowerCase());
  const applyPaste = (gs, mode) => {
    let ngroups = mode === "append" ? [...groups] : [];
    let nitems = mode === "append" ? [...items] : [];
    gs.forEach((g) => {
      const ex = mode === "append" ? ngroups.find((x) => x.name === g.name) : null;
      const gg = ex || makeSchedGroup(g.name);
      if (!ex) ngroups.push(gg);
      g.items.forEach((i) => {
        const old = mode === "replace" ? keepOld(i) : null;
        nitems.push(makeSchedItem({ ...i, gid: gg.id, pc: old ? old.pc : i.pc, note: old ? old.note : i.note, st: old ? old.st : i.st }));
      });
    });
    save({ groups: ngroups, items: nitems }, `Đã ${mode === "append" ? "thêm" : "thay bảng bằng"} ${gs.reduce((a, g) => a + g.items.length, 0)} hạng mục từ Excel`);
    setDlg(false);
  };
  const applyTemplate = () => {
    if (items.length && !tplAsk) { setTplAsk(true); say("Bảng đang có dữ liệu — bấm “Áp dụng mẫu” lần nữa để thay thế"); return; }
    setTplAsk(false);
    save(schedFromTemplate(tpl, tplStart), `Đã tạo bảng từ mẫu — bắt đầu ${fdy(tplStart)}; chỉnh ngày từng hạng mục theo thực tế`);
  };

  if (!p) return <div className="tl-panel"><div className="tl-panel-b tl-note">Không có dự án nào đang triển khai.</div></div>;

  const r = schedRange(items);
  const pc = schedPct(items);
  const dayN = r ? Math.max(0, diff(r.s, today)) : 0;
  const total = r ? diff(r.s, r.e) + 1 : 0;
  const left = r ? diff(today, r.e) : 0;
  const nLate = items.filter((i) => schedIsLate(i, today)).length;
  const baseEnd = schedBaseEnd(items);
  const linked = SCHED_STAGE_IDS.map((id) => ({ id, d: schedDerive(p, id) })).filter((x) => x.d);

  return (
    <div className="ss">
      <div className="tl-panel">
        <div className="tl-panel-h">
          <h3>Tiến độ thi công</h3>
          <select className="input input-sm" value={p.id} onChange={(e) => { setPid(e.target.value); setCollapsed({}); }}>
            {active.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}{schedItems(x).length ? ` · ${schedPct(schedItems(x))}%` : " · chưa có bảng"}</option>)}
          </select>
          <div className="tl-sp" />
          {onOpenPlan && <button className="btn btn-outline btn-sm" onClick={() => onOpenPlan(p.id)}>Xem kế hoạch 12 bước →</button>}
        </div>
        <div className="tl-panel-b">
          <div className="ss-pills" title="Chuyển nhanh giữa các dự án">
            {active.map((x) => { const its = schedItems(x), lt = its.filter((i) => schedIsLate(i, today)).length; return (
              <button key={x.id} className={`ss-pill ${x.id === p.id ? "on" : ""} ${its.length ? "" : "empty"}`} onClick={() => { setPid(x.id); setCollapsed({}); }}>
                <b>{x.code.slice(5)}</b> {its.length ? `${schedPct(its)}%` : "chưa có bảng"}{lt > 0 && <i className="lt">{lt} trễ</i>}
              </button>); })}
          </div>
          <div className="ss-hint" style={{ marginBottom: 8 }}>Bảng hạng mục chi tiết như file Excel của bạn. Các bước <b>Duyệt mẫu / Manufacturing / Construction / QC / Bàn giao</b> trong kế hoạch 12 bước sẽ <b>tự lấy ngày bắt đầu, kết thúc và % tiến độ</b> từ bảng này.</div>
          <div className="ss-tools">
            <button className="btn btn-primary btn-sm" onClick={() => setDlg(true)}>Dán từ Excel</button>
            <button className="btn btn-outline btn-sm" onClick={addGroup}>+ Thêm nhóm</button>
            <span className="ss-tpl">
              <select className="input input-sm" value={tpl} onChange={(e) => { setTpl(e.target.value); setTplAsk(false); }}>{SCHED_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              <label>bắt đầu <input type="date" className="input input-sm" value={tplStart} onChange={(e) => e.target.value && setTplStart(e.target.value)} /></label>
              <button className={`btn btn-sm ${tplAsk ? "btn-primary" : "btn-outline"}`} onClick={applyTemplate}>{tplAsk ? "Xác nhận thay bảng" : "Áp dụng mẫu"}</button>
            </span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="tl-panel"><div className="tl-panel-b">
          <div className="tl-warnbox" style={{ margin: 0 }}>Dự án này chưa có bảng tiến độ thi công. Chọn <b>Dán từ Excel</b> (nhanh nhất), hoặc <b>Áp dụng mẫu</b> rồi chỉnh lại, hoặc thêm nhóm và nhập từng hạng mục.</div>
        </div></div>
      ) : (
        <>
          <div className="ss-kpis">
            <div className="ss-k"><div className="l">Bắt đầu thi công</div><div className="v">{fdy(r.s)}</div></div>
            <div className="ss-k"><div className="l">Kết thúc dự kiến</div><div className="v">{fdy(r.e)}{baseEnd && baseEnd !== r.e && <small style={{ color: baseEnd > r.e ? "var(--green)" : "var(--red)" }}> · {baseEnd > r.e ? `sớm ${diff(r.e, baseEnd)}` : `trễ ${diff(baseEnd, r.e)}`} ngày so với KH gốc</small>}</div></div>
            <div className="ss-k"><div className="l">Hôm nay</div><div className="v">{fd(today)} <small>{today < r.s ? `· còn ${diff(today, r.s)} ngày tới ngày bắt đầu` : `· đã chạy ${dayN} ngày`}</small></div></div>
            <div className="ss-k"><div className="l">Thời hạn triển khai</div><div className="v">{total} <small>ngày{left >= 0 ? ` · còn ${left}` : ` · quá ${-left}`}</small></div></div>
            <div className="ss-k"><div className="l">Tiến độ chung (theo ngày công)</div><div className="v">{pc}%{nLate > 0 && <small style={{ color: "var(--red)" }}> · {nLate} hạng mục trễ</small>}</div></div>
          </div>

          {items.some(schedPending) && (
            <div className="tl-warnbox" style={{ margin: 0 }}>
              <b>{items.filter(schedPending).length} hạng mục đang chờ BOD duyệt ngày hoàn thành thực tế</b> (nhập bù ngày đã qua): {items.filter(schedPending).map((i) => `${i.t} (xong ${fd(i.bd.date)})`).join(" · ")}.
              {currentRole === "BOD" ? " Bấm “Duyệt” / “Từ chối” ở cột % tiến độ bên dưới." : " Trong lúc chờ, hạng mục ghi nhận xong hôm nay và chưa tính sớm/trễ."}
            </div>
          )}
          <div className="tl-panel">
            <div className="tl-panel-h"><h3>Nối với kế hoạch 12 bước</h3><span className="sub">các bước này tự lấy ngày & % từ bảng hạng mục bên dưới</span></div>
            {!plan && <div className="tl-panel-b"><div className="tl-warnbox" style={{ margin: 0 }}>Dự án chưa có kế hoạch 12 bước nên chưa nối được — tạo kế hoạch nhanh ở tab “Lịch triển khai”. Bảng này vẫn dùng bình thường.</div></div>}
            {plan && (
              <div className="tl-tbl-wrap"><table className="ss-lnk"><tbody>
                {linked.map(({ id, d }) => (
                  <tr key={id}>
                    <td><b>{id}. {stageName(id)}</b></td><td>{d.n} hạng mục</td><td className="num">{fd(d.s)} → {fd(d.e)}</td>
                    <td style={{ minWidth: 120 }}><div className="ss-pb"><i style={{ width: `${d.pc}%` }} /></div></td><td className="num">{d.pc}%</td>
                    <td>{p.stages?.[id]?.state === "done" ? <span className="tl-pill good">bước đã xong</span> : p.stages?.[id]?.skipped ? <span className="tl-pill none">đang bỏ qua</span> : null}</td>
                  </tr>
                ))}
                {linked.length === 0 && <tr><td className="tl-note">Chưa hạng mục nào gắn với bước — chọn cột “Thuộc bước” ở bảng dưới.</td></tr>}
              </tbody></table></div>
            )}
          </div>

          <div className="tl-panel">
            <div className="tl-panel-h"><h3>Bảng hạng mục</h3><span className="sub">{items.length} hạng mục · “Số ngày” = ngày làm việc, không tính Chủ nhật · sửa ngày hoặc số ngày đều được</span></div>
            <div className="tl-tbl-wrap">
              <table className="ss-tbl">
                <thead><tr><th>STT</th><th>Hạng mục</th><th>Bắt đầu</th><th>Kết thúc</th><th>Số ngày</th><th>Thực hiện</th><th>Thuộc bước</th><th>% tiến độ</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {groups.map((g) => {
                    const gs = items.filter((i) => i.gid === g.id);
                    const gr = schedRange(gs);
                    const open = !collapsed[g.id];
                    return (
                      <React.Fragment key={g.id}>
                        <tr className="grp">
                          <td colSpan={10}>
                            <span className="tg" onClick={() => setCollapsed({ ...collapsed, [g.id]: open })}>{open ? "▾" : "▸"}</span>
                            <Cell type="text" className="ss-gin" value={g.name} onCommit={(v) => renameGroup(g.id, v.trim() || g.name)} />
                            <span className="r">{gs.length} hạng mục{gr ? ` · ${fd(gr.s)} → ${fd(gr.e)} · ${schedPct(gs)}%` : ""}</span>
                            {askDelG === g.id
                              ? <span className="ss-ask">Xóa nhóm + {gs.length} hạng mục? <button className="btn btn-primary btn-sm" onClick={() => delGroup(g.id)}>Xóa</button> <button className="btn btn-ghost btn-sm" onClick={() => setAskDelG(null)}>Hủy</button></span>
                              : <button className="btn btn-ghost btn-sm ss-gdel" title="Xóa nhóm" onClick={() => setAskDelG(g.id)}>✕</button>}
                          </td>
                        </tr>
                        {open && gs.map((it, ii) => {
                          const late = schedIsLate(it, today);
                          const now = it.pc < 100 && it.s <= today && it.e >= today;
                          return (
                            <tr key={it.id} className={it.pc >= 100 ? "dn" : now ? "now" : ""}>
                              <td className="c">{ii + 1}</td>
                              <td><Cell type="text" className="input input-sm ss-t" value={it.t} onCommit={(v) => editItem(it.id, "t", v)} /></td>
                              <td><Cell type="date" className="input input-sm ss-d" value={it.s} onCommit={(v) => editItem(it.id, "s", v)} /></td>
                              <td><Cell type="date" className="input input-sm ss-d" value={it.e} onCommit={(v) => editItem(it.id, "e", v)} /></td>
                              <td className="c"><Cell type="number" min="0" className="input input-sm ss-n" value={schedWdays(it.s, it.e)} onCommit={(v) => editItem(it.id, "d", v)} /></td>
                              <td><select className="input input-sm" value={it.who} onChange={(e) => editItem(it.id, "who", e.target.value)}>{SCHED_WHO.includes(it.who) ? null : <option>{it.who}</option>}{SCHED_WHO.map((w) => <option key={w}>{w}</option>)}</select></td>
                              <td><select className="input input-sm" value={it.st} title="Hạng mục này thuộc bước nào của kế hoạch 12 bước" onChange={(e) => editItem(it.id, "st", e.target.value)}>
                                {SCHED_STAGE_IDS.includes(it.st) ? null : <option value={it.st}>{it.st}. {stageName(it.st)}</option>}
                                {SCHED_STAGE_IDS.map((id) => <option key={id} value={id}>{id}. {stageName(id)}</option>)}</select></td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                <input type="checkbox" className="ss-chk" checked={it.pc >= 100} title="Đánh dấu hoàn thành — xong sớm thì rút ngắn thời gian" onChange={(e) => toggleDone(it.id, e.target.checked)} />
                                <Cell type="number" min="0" max="100" className="input input-sm ss-n" value={it.pc} onCommit={(v) => editItem(it.id, "pc", v)} /> %
                                {late && <span className="tl-pill bad" style={{ marginLeft: 6 }}>trễ</span>}
                                {(() => {
                                  const vl = varLabel(it);
                                  return ((vl || it.bd) ? (<div className="ss-vrow">
                                    {vl && <span className={`ss-var ${vl.cls}`} title={schedPending(it) ? `${it.bd.by} đề nghị: ${it.bd.reason}` : it.doneAt ? `Hạn kế hoạch lúc bấm xong: ${fd(it.ep || it.e)}` : `Kế hoạch gốc: ${fd(it.s0 || it.s)} → ${fd(it.e0)}`}>{vl.t}</span>}
                                    {it.bd && it.bd.status === "approved" && <span className="ss-var ok" title={`${it.bd.by} nhập bù: ${it.bd.reason || "—"} · BOD duyệt ${fd(it.bd.decidedAt)}`}>nhập bù · BOD duyệt</span>}
                                    {schedPending(it) && currentRole === "BOD" && <span className="ss-dec"><button className="btn btn-primary btn-sm" onClick={() => decide(it.id, true)}>Duyệt</button><button className="btn btn-outline btn-sm" onClick={() => decide(it.id, false)}>Từ chối</button></span>}
                                  </div>) : null);
                                })()}</td>
                              <td style={{ whiteSpace: "nowrap" }}><Cell type="text" className="input input-sm ss-note" placeholder="Ghi chú" value={it.note} onCommit={(v) => editItem(it.id, "note", v)} /></td>
                              <td><button className="btn btn-ghost btn-sm" title="Xóa hạng mục" onClick={() => delItem(it.id)}>×</button></td>
                            </tr>
                          );
                        })}
                        {open && <tr><td /><td colSpan={9}><button className="btn btn-outline btn-sm" onClick={() => addItem(g.id)}>+ Thêm hạng mục vào “{g.name}”</button></td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tl-panel">
            <div className="tl-panel-h"><h3>Tiến độ theo ngày</h3><span className="sub">ô xanh nhạt = Chủ nhật · vạch cam = hôm nay · thanh đỏ = đang trễ</span></div>
            <SiteGantt groups={groups} items={items} collapsed={collapsed} today={today} />
          </div>
        </>
      )}

      {doneFor && items.find((x) => x.id === doneFor) && <DoneDialog item={items.find((x) => x.id === doneFor)} today={today} role={currentRole} onConfirm={(o) => confirmDone(doneFor, o)} onClose={() => setDoneFor(null)} />}
      {dlg && <PasteDialog today={today} hasItems={items.length > 0} onClose={() => setDlg(false)} onApply={applyPaste} />}
      {toast && <div className="tl-toast"><span>{toast.msg}</span>{toast.act && <button className="ss-act" onClick={() => { const f = toast.act.fn; setToast(null); f(); }}>{toast.act.label}</button>}{toast.undo && <button onClick={toast.undo}>Hoàn tác</button>}</div>}
    </div>
  );
}
