import React, { useState, useRef, useEffect } from "react";
import {
  todayISO, OPP_STAGES, OPP_SCHED_WHO, OPP_SCHED_STAGE_IDS, OPP_SCHED_TEMPLATES, oppSchedFromTemplate,
  schedWdays, schedEndFromDays, schedPct, schedRange, schedDerive, schedIsLate, schedItems, schedGroups,
  makeSchedItem, makeSchedGroup,
  schedSetDone, schedPullForward, schedBaseEnd, schedPending, schedDecide, schedDoneMessage,
} from "./data/seed";
import { DoneDialog, varLabel, Cell, SiteGantt, fd, fdy, diff } from "./SiteSchedule";

/* ---------------------------------------------------------------------- */
/*  CÔNG VIỆC & TIMELINE của từng CƠ HỘI BÁN HÀNG                            */
/*  - opportunity.schedule = { groups[], items[] } (cùng mô hình bảng thi công)*/
/*  - mỗi hạng mục gắn với 1 bước Stage-Gate → bước tự lấy ngày & % từ bảng    */
/*  - tick hoàn thành chọn ngày thực tế; nhập bù ngày đã qua cần BOD duyệt     */
/* ---------------------------------------------------------------------- */

const stageName = (id) => OPP_STAGES.find((s) => s.id === id)?.label || "";

export default function OppSchedule({ opp, onSave, currentRole }) {
  const today = todayISO();
  const [collapsed, setCollapsed] = useState({});
  const [tpl, setTpl] = useState("full");
  const [tplStart, setTplStart] = useState(today);
  const [tplAsk, setTplAsk] = useState(false);
  const [askDelG, setAskDelG] = useState(null);
  const [doneFor, setDoneFor] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState(null);
  const tRef = useRef(null);
  useEffect(() => () => clearTimeout(tRef.current), []);

  const groups = schedGroups(opp);
  const items = schedItems(opp);

  const say = (msg, undo, act) => { setToast({ msg, undo: undo || null, act: act || null }); clearTimeout(tRef.current); tRef.current = setTimeout(() => setToast(null), act ? 12000 : 6500); };
  const write = (next) => onSave({ ...opp, schedule: next });
  const save = (next, msg, act) => {
    const prev = opp.schedule || null;
    write(next);
    if (msg) say(msg, () => { write(prev); setToast(null); }, act);
  };
  const setItems = (nextItems, msg) => save({ groups, items: nextItems }, msg);

  const toggleDone = (id, done) => {
    if (done) { setDoneFor(id); return; }
    const it = items.find((x) => x.id === id);
    if (it && it.bd && it.bd.status === "approved" && currentRole !== "BOD") { say("Việc này đã được BOD duyệt ngày hoàn thành — chỉ BOD được bỏ đánh dấu xong"); return; }
    const r = schedSetDone(items, id, false, today);
    save({ groups, items: r.items }, schedDoneMessage(it.t, false, r));
  };
  const confirmDone = (id, { date, reason }) => {
    setDoneFor(null);
    const it = items.find((x) => x.id === id);
    const r = schedSetDone(items, id, true, today, { date, reason, role: currentRole, by: currentRole });
    let act = null;
    if (r.early > 0) {
      act = { label: `Dời các việc sau sớm ${r.early} ngày`, fn: () => {
        const q = schedPullForward(r.items, id, r.early, today);
        write({ groups, items: q.items });
        say(q.moved ? `Đã dời sớm ${q.moved} việc nối sau — thời gian chốt cơ hội rút ngắn tương ứng` : "Không có việc nào dời được (đã sát hôm nay hoặc không nối sau)", () => { write({ groups, items: r.items }); setToast(null); });
      } };
    }
    save({ groups, items: r.items }, schedDoneMessage(it.t, true, r), act);
  };
  const decide = (id, approve) => {
    const it = items.find((x) => x.id === id);
    save({ groups, items: schedDecide(items, id, approve, currentRole, today) }, approve ? `BOD đã duyệt “${it.t}” hoàn thành ngày ${fd(it.bd.date)}` : `Đã từ chối ngày nhập bù của “${it.t}” — giữ nguyên xong hôm nay`);
  };
  const editItem = (id, f, v) => {
    if (f === "pc") {
      const n = Math.round(+v) || 0;
      const cur = items.find((x) => x.id === id);
      if (n >= 100) { if (!(cur.doneAt && cur.pc >= 100)) toggleDone(id, true); return; }
      if (cur.doneAt) {
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
    const g = groups.find((x) => x.id === gid);
    const guess = (g && OPP_SCHED_STAGE_IDS.find((id) => g.name.includes(stageName(id)))) || (last ? last.st : opp.currentStage) || 1;
    const it = makeSchedItem({ gid, s, e: s, who: last ? last.who : "KD", st: guess });
    const idx = last ? items.indexOf(last) + 1 : items.length;
    setItems([...items.slice(0, idx), it, ...items.slice(idx)]);
  };
  const delItem = (id) => setItems(items.filter((i) => i.id !== id), "Đã xóa 1 việc");
  const addGroup = () => {
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][groups.length] || String(groups.length + 1);
    save({ groups: [...groups, makeSchedGroup(`${roman} · Nhóm mới`)], items });
  };
  const renameGroup = (gid, name) => save({ groups: groups.map((g) => (g.id === gid ? { ...g, name } : g)), items });
  const delGroup = (gid) => { save({ groups: groups.filter((g) => g.id !== gid), items: items.filter((i) => i.gid !== gid) }, "Đã xóa nhóm"); setAskDelG(null); };
  const applyTemplate = () => {
    if (items.length && !tplAsk) { setTplAsk(true); say("Bảng đang có dữ liệu — bấm “Áp dụng mẫu” lần nữa để thay thế"); return; }
    setTplAsk(false);
    save(oppSchedFromTemplate(tpl, tplStart), `Đã tạo bảng công việc từ mẫu — bắt đầu ${fdy(tplStart)}; chỉnh ngày từng việc theo thực tế`);
  };

  const r = schedRange(items);
  const pc = schedPct(items);
  const nDone = items.filter((i) => (i.pc || 0) >= 100).length;
  const nLate = items.filter((i) => schedIsLate(i, today)).length;
  const baseEnd = schedBaseEnd(items);
  const linked = OPP_SCHED_STAGE_IDS.map((id) => ({ id, d: schedDerive(opp, id) })).filter((x) => x.d);
  const total = r ? diff(r.s, r.e) + 1 : 0;
  const left = r ? diff(today, r.e) : 0;

  const mkBody = (compact) => (
    <div className={`ss oppss ${compact ? "oppss-inline" : ""}`}>
      <div className="ss-hint" style={{ marginBottom: 8 }}>Mỗi việc gắn với một <b>bước Stage-Gate</b>; ngày bắt đầu, kết thúc và % của từng bước tự lấy từ bảng này. Hoàn thành sớm thì rút ngắn thời gian chốt cơ hội.{compact && <> Bấm <b>⤢ Mở rộng</b> để xem đủ cột (số ngày, thực hiện, thuộc bước, ghi chú).</>}</div>
      <div className="ss-tools">
        <button className="btn btn-outline btn-sm" onClick={addGroup}>+ Thêm nhóm</button>
        <span className="ss-tpl">
          <select className="input input-sm" value={tpl} onChange={(e) => { setTpl(e.target.value); setTplAsk(false); }}>{OPP_SCHED_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <label>bắt đầu <input type="date" className="input input-sm" value={tplStart} onChange={(e) => e.target.value && setTplStart(e.target.value)} /></label>
          <button className={`btn btn-sm ${tplAsk ? "btn-primary" : "btn-outline"}`} onClick={applyTemplate}>{tplAsk ? "Xác nhận thay bảng" : "Áp dụng mẫu"}</button>
        </span>
      </div>

      {items.length === 0 && groups.length === 0 && (
        <div className="tl-warnbox" style={{ margin: "10px 0 0" }}>Cơ hội này chưa có bảng công việc. Chọn <b>Áp dụng mẫu</b> (theo 7 bước bán hàng) rồi chỉnh lại, hoặc <b>+ Thêm nhóm</b> và nhập từng việc — cơ hội đơn giản chỉ cần 1–2 việc.</div>
      )}

      {items.length > 0 && (
        <>
          <div className="ss-kpis" style={{ marginTop: 10 }}>
            <div className="ss-k"><div className="l">Bắt đầu</div><div className="v">{fdy(r.s)}</div></div>
            <div className="ss-k"><div className="l">Dự kiến chốt</div><div className="v">{fdy(r.e)}{baseEnd && baseEnd !== r.e && <small style={{ color: baseEnd > r.e ? "var(--green)" : "var(--red)" }}> · {baseEnd > r.e ? `sớm ${diff(r.e, baseEnd)}` : `trễ ${diff(baseEnd, r.e)}`} ngày so với KH gốc</small>}</div></div>
            <div className="ss-k"><div className="l">Thời hạn</div><div className="v">{total} <small>ngày{left >= 0 ? ` · còn ${left}` : ` · quá ${-left}`}</small></div></div>
            <div className="ss-k"><div className="l">Việc đã xong</div><div className="v">{nDone}/{items.length}{nLate > 0 && <small style={{ color: "var(--red)" }}> · {nLate} việc trễ</small>}</div></div>
            <div className="ss-k"><div className="l">Tiến độ chung</div><div className="v">{pc}%</div></div>
          </div>

          {items.some(schedPending) && (
            <div className="tl-warnbox" style={{ margin: "0 0 10px" }}>
              <b>{items.filter(schedPending).length} việc đang chờ BOD duyệt ngày hoàn thành thực tế</b> (nhập bù ngày đã qua): {items.filter(schedPending).map((i) => `${i.t} (xong ${fd(i.bd.date)})`).join(" · ")}.
              {currentRole === "BOD" ? " Bấm “Duyệt” / “Từ chối” ở cột % tiến độ bên dưới." : " Trong lúc chờ, việc ghi nhận xong hôm nay và chưa tính sớm/trễ."}
            </div>
          )}

          <div className="oppss-link">
            <div className="oppss-h">Nối với Stage-Gate <span>các bước tự lấy ngày & % từ bảng bên dưới</span></div>
            <div className="tl-tbl-wrap"><table className="ss-lnk"><tbody>
              {linked.map(({ id, d }) => {
                const isCur = opp.status === "open" && opp.currentStage === id;
                const passed = opp.currentStage > id || opp.status === "won";
                const late = items.filter((i) => i.st === id && schedIsLate(i, today)).length;
                return (
                  <tr key={id} className={isCur ? "cur" : ""}>
                    <td><b>{id}. {stageName(id)}</b></td><td>{d.n} việc</td><td className="num">{fd(d.s)} → {fd(d.e)}</td>
                    <td style={{ minWidth: 100 }}><div className="ss-pb"><i style={{ width: `${d.pc}%` }} /></div></td><td className="num">{d.pc}%</td>
                    <td>{passed ? <span className="tl-pill good">bước đã qua</span> : isCur ? (d.pc >= 100 ? <span className="tl-pill good">đủ việc — có thể tick gate &amp; chuyển bước</span> : <span className="tl-pill none">đang ở bước này</span>) : null}{late > 0 && <span className="tl-pill bad" style={{ marginLeft: 4 }}>{late} trễ</span>}</td>
                  </tr>
                );
              })}
            </tbody></table></div>
          </div>
        </>
      )}

      {(items.length > 0 || groups.length > 0) && (
        <div className="tl-tbl-wrap" style={{ marginTop: 10 }}>
          <table className="ss-tbl">
            <thead><tr><th>STT</th><th>Công việc</th><th>Bắt đầu</th><th>Kết thúc</th><th>Số ngày</th><th>Thực hiện</th><th>Thuộc bước</th><th>% tiến độ</th><th>Note</th><th /></tr></thead>
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
                        <span className="r">{gs.length} việc{gr ? ` · ${fd(gr.s)} → ${fd(gr.e)} · ${schedPct(gs)}%` : ""}</span>
                        {askDelG === g.id
                          ? <span className="ss-ask">Xóa nhóm + {gs.length} việc? <button className="btn btn-primary btn-sm" onClick={() => delGroup(g.id)}>Xóa</button> <button className="btn btn-ghost btn-sm" onClick={() => setAskDelG(null)}>Hủy</button></span>
                          : <button className="btn btn-ghost btn-sm ss-gdel" title="Xóa nhóm" onClick={() => setAskDelG(g.id)}>✕</button>}
                      </td>
                    </tr>
                    {open && gs.map((it, ii) => {
                      const late = schedIsLate(it, today);
                      const now = it.pc < 100 && it.s <= today && it.e >= today;
                      const vl = varLabel(it);
                      return (
                        <tr key={it.id} className={it.pc >= 100 ? "dn" : now ? "now" : ""}>
                          <td className="c">{ii + 1}</td>
                          <td><Cell type="text" className="input input-sm ss-t" value={it.t} onCommit={(v) => editItem(it.id, "t", v)} /></td>
                          <td><Cell type="date" className="input input-sm ss-d" value={it.s} onCommit={(v) => editItem(it.id, "s", v)} /></td>
                          <td><Cell type="date" className="input input-sm ss-d" value={it.e} onCommit={(v) => editItem(it.id, "e", v)} /></td>
                          <td className="c"><Cell type="number" min="0" className="input input-sm ss-n" value={schedWdays(it.s, it.e)} onCommit={(v) => editItem(it.id, "d", v)} /></td>
                          <td><select className="input input-sm" value={it.who} onChange={(e) => editItem(it.id, "who", e.target.value)}>{OPP_SCHED_WHO.includes(it.who) ? null : <option>{it.who}</option>}{OPP_SCHED_WHO.map((w) => <option key={w}>{w}</option>)}</select></td>
                          <td><select className="input input-sm" value={it.st} title="Việc này thuộc bước nào của Sales Stage-Gate" onChange={(e) => editItem(it.id, "st", e.target.value)}>
                            {OPP_SCHED_STAGE_IDS.includes(it.st) ? null : <option value={it.st}>{it.st}</option>}
                            {OPP_SCHED_STAGE_IDS.map((id) => <option key={id} value={id}>{id}. {stageName(id)}</option>)}</select></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <input type="checkbox" className="ss-chk" checked={it.pc >= 100} title="Đánh dấu hoàn thành — chọn ngày thực tế" onChange={(e) => toggleDone(it.id, e.target.checked)} />
                            <Cell type="number" min="0" max="100" className="input input-sm ss-n" value={it.pc} onCommit={(v) => editItem(it.id, "pc", v)} /> %
                            {late && <span className="tl-pill bad" style={{ marginLeft: 6 }}>trễ</span>}
                            {(vl || it.bd) && (
                              <div className="ss-vrow">
                                {vl && <span className={`ss-var ${vl.cls}`} title={schedPending(it) ? `${it.bd.by} đề nghị: ${it.bd.reason}` : it.doneAt ? `Hạn kế hoạch lúc bấm xong: ${fd(it.ep || it.e)}` : `Kế hoạch gốc: ${fd(it.s0 || it.s)} → ${fd(it.e0)}`}>{vl.t}</span>}
                                {it.bd && it.bd.status === "approved" && <span className="ss-var ok" title={`${it.bd.by} nhập bù: ${it.bd.reason || "—"} · BOD duyệt ${fd(it.bd.decidedAt)}`}>nhập bù · BOD duyệt</span>}
                                {schedPending(it) && currentRole === "BOD" && <span className="ss-dec"><button className="btn btn-primary btn-sm" onClick={() => decide(it.id, true)}>Duyệt</button><button className="btn btn-outline btn-sm" onClick={() => decide(it.id, false)}>Từ chối</button></span>}
                              </div>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}><Cell type="text" className="input input-sm ss-note" placeholder="Ghi chú" value={it.note} onCommit={(v) => editItem(it.id, "note", v)} /></td>
                          <td><button className="btn btn-ghost btn-sm" title="Xóa việc" onClick={() => delItem(it.id)}>×</button></td>
                        </tr>
                      );
                    })}
                    {open && <tr><td /><td colSpan={9}><button className="btn btn-outline btn-sm" onClick={() => addItem(g.id)}>+ Thêm việc vào “{g.name}”</button></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="oppss-h">Timeline theo ngày <span>ô xanh nhạt = Chủ nhật · vạch cam = hôm nay · thanh đỏ = đang trễ</span></div>
          <SiteGantt groups={groups} items={items} collapsed={collapsed} today={today} />
        </div>
      )}
    </div>
  );

  const body = mkBody(true);
  const bodyFull = mkBody(false);
  const toastEl = toast && <div className="tl-toast"><span>{toast.msg}</span>{toast.act && <button className="ss-act" onClick={() => { const f = toast.act.fn; setToast(null); f(); }}>{toast.act.label}</button>}{toast.undo && <button onClick={toast.undo}>Hoàn tác</button>}</div>;
  const doneEl = doneFor && items.find((x) => x.id === doneFor) && <DoneDialog item={items.find((x) => x.id === doneFor)} today={today} role={currentRole} onConfirm={(o) => confirmDone(doneFor, o)} onClose={() => setDoneFor(null)} />;

  return (
    <div className="pd-stages oppss-wrap">
      <div className="oppss-top">
        <h4>Công việc &amp; timeline{items.length > 0 && <span className="oppss-sub"> · {nDone}/{items.length} việc · {pc}%{nLate > 0 ? ` · ${nLate} trễ` : ""}</span>}</h4>
        <button className="btn btn-outline btn-sm" onClick={() => setExpanded(true)} title="Mở rộng để xem đủ cột và timeline">⤢ Mở rộng</button>
      </div>
      {expanded ? <div className="ss-hint">Đang mở rộng toàn màn hình…</div> : body}
      {expanded && (
        <div className="ss-ov" onClick={() => setExpanded(false)}>
          <div className="ss-dlg oppss-full" onClick={(e) => e.stopPropagation()}>
            <div className="oppss-top"><h3>Công việc &amp; timeline — {opp.title}</h3><button className="btn btn-ghost btn-sm" onClick={() => setExpanded(false)}>Đóng ✕</button></div>
            {bodyFull}
          </div>
        </div>
      )}
      {doneEl}
      {toastEl}
    </div>
  );
}
