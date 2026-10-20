import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  todayISO, OPP_STAGES, formatCompactVND, isSunday,
  schedItems, schedPct, schedRange, schedIsLate, schedDerive, diffDays,
} from "./data/seed";

/* ---------------------------------------------------------------------- */
/*  TIMELINE TỔNG HỢP CÁC CƠ HỘI — mỗi cơ hội 1 dòng, các bước Stage-Gate là   */
/*  các đoạn màu lấy từ bảng công việc của cơ hội; bấm vào dòng để xem chi tiết */
/* ---------------------------------------------------------------------- */

const DW = 24;
const d2n = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const n2d = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const fd = (s) => (s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "—");
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const ROW_H = 46;
const stageLabel = (id) => OPP_STAGES.find((s) => s.id === id)?.label || "";

const SORTS = [
  { id: "end", label: "Dự kiến chốt (sớm → muộn)" },
  { id: "start", label: "Ngày bắt đầu" },
  { id: "late", label: "Nhiều việc trễ nhất" },
  { id: "value", label: "Giá trị lớn nhất" },
];

export default function OppTimeline({ opportunities, onOpen, selectedId }) {
  const today = todayISO();
  const [sort, setSort] = useState("end");
  const scRef = useRef(null);

  const rows = useMemo(() => opportunities.map((o) => {
    const items = schedItems(o);
    const r = schedRange(items);
    const late = items.filter((i) => schedIsLate(i, today)).length;
    const segs = [];
    OPP_STAGES.forEach((st) => {
      const d = schedDerive(o, st.id);
      if (d) segs.push({ id: st.id, label: st.label, ...d, late: items.filter((i) => i.st === st.id && schedIsLate(i, today)).length });
    });
    return { o, items, r, late, segs, pc: schedPct(items) };
  }), [opportunities, today]);

  const withPlan = rows.filter((x) => x.items.length > 0);
  const noPlan = rows.filter((x) => x.items.length === 0);
  const sorted = [...withPlan].sort((a, b) => {
    if (sort === "start") return a.r.s.localeCompare(b.r.s);
    if (sort === "late") return b.late - a.late || a.r.e.localeCompare(b.r.e);
    if (sort === "value") return (b.o.value || 0) - (a.o.value || 0);
    return a.r.e.localeCompare(b.r.e);
  });

  const nLate = withPlan.reduce((a, x) => a + x.late, 0);
  const soonest = [...withPlan].filter((x) => x.o.status === "open").sort((a, b) => a.r.e.localeCompare(b.r.e))[0];

  let mn = d2n(today) - 3, mx = d2n(today) + 14;
  withPlan.forEach((x) => { mn = Math.min(mn, d2n(x.r.s) - 2); mx = Math.max(mx, d2n(x.r.e) + 12); });
  const W = (mx - mn + 1) * DW;
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

  // mở ra là cuộn tới vạch "hôm nay" (cách mép trái ~1/4 khung)
  const hasRows = sorted.length > 0;
  useEffect(() => {
    const el = scRef.current;
    if (el) el.scrollLeft = Math.max(0, tx - el.clientWidth * 0.25);
  }, [hasRows, mn]);

  const segCls = (o, sg) => (sg.pc >= 100 ? "dn" : sg.late > 0 ? "late" : o.status === "open" && o.currentStage === sg.id ? "cur" : "");

  return (
    <div className="oppt">
      <div className="ss-kpis">
        <div className="ss-k"><div className="l">Cơ hội có lịch</div><div className="v">{withPlan.length}<small> / {rows.length}</small></div></div>
        <div className="ss-k"><div className="l">Việc đang trễ</div><div className="v" style={{ color: nLate ? "var(--red)" : "inherit" }}>{nLate}</div></div>
        <div className="ss-k"><div className="l">Dự kiến chốt sớm nhất</div><div className="v">{soonest ? fd(soonest.r.e) : "—"}{soonest && <small> · {soonest.o.title}</small>}</div></div>
        <div className="ss-k"><div className="l">Chưa có bảng công việc</div><div className="v">{noPlan.length}</div></div>
      </div>

      <div className="oppt-bar">
        <label className="oppt-sort">Sắp theo
          <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <span className="oppt-leg">
          <i className="dn" />xong <i className="cur" />bước hiện tại <i className="" />chưa tới <i className="late" />có việc trễ <i className="tdy" />hôm nay
        </span>
        <span className="oppt-tip">Bấm vào cơ hội để xem bảng công việc chi tiết</span>
      </div>

      {sorted.length === 0 ? (
        <div className="tl-warnbox">Chưa cơ hội nào có bảng công việc. Mở một cơ hội và chọn <b>Áp dụng mẫu</b> để lên timeline.</div>
      ) : (
        <div className="ss-gwrap oppt-wrap">
          <div className="ss-gnames oppt-names">
            <div style={{ height: 48, borderBottom: "1px solid var(--line)" }} />
            {sorted.map(({ o, pc, late }) => (
              <button type="button" key={o.id} className={`oppt-name ${selectedId === o.id ? "on" : ""}`} style={{ height: ROW_H }} onClick={() => onOpen(o.id)} title={`Mở chi tiết: ${o.title}`}>
                <b>{o.title}</b>
                <span>{o.customerName} · {o.status === "won" ? "WON" : o.status === "lost" ? "LOST" : `Bước ${o.currentStage}/${OPP_STAGES.length} ${stageLabel(o.currentStage)}`} · {formatCompactVND(o.value)}</span>
              </button>
            ))}
          </div>
          <div className="ss-gscroll" ref={scRef}>
            <div style={{ width: W, position: "relative" }}>
              <div className="ss-gm">{months.map((m, i) => <div key={i} style={{ flex: `0 0 ${m.w}px` }}>{m.label}</div>)}</div>
              <div className="ss-gh">{days.map((d) => <div key={d} className={isSunday(d) ? "sun" : ""}><div>{d.slice(8)}</div><div className="w">{WD[new Date(d2n(d) * 86400000).getUTCDay()]}</div></div>)}</div>
              {sorted.map(({ o, segs, r, pc, late }) => (
                <div key={o.id} className={`ss-grow oppt-row ${selectedId === o.id ? "on" : ""}`} style={{ height: ROW_H }} onClick={() => onOpen(o.id)}>
                  <Bg />
                  {segs.map((sg) => (
                    <div key={sg.id} className={`oppt-seg ${segCls(o, sg)}`} style={{ left: (d2n(sg.s) - mn) * DW, width: Math.max(DW - 2, (diffDays(sg.s, sg.e) + 1) * DW - 2) }}
                      title={`${sg.id}. ${sg.label}: ${fd(sg.s)} → ${fd(sg.e)} · ${sg.pc}% · ${sg.n} việc${sg.late ? ` · ${sg.late} trễ` : ""}`}>
                      <i style={{ width: `${sg.pc}%` }} />
                      <span>{sg.id}</span>
                    </div>
                  ))}
                  <div className="oppt-lbl" style={{ left: (d2n(r.e) - mn + 1) * DW + 4 }}>
                    <b>{pc}%</b>{late > 0 && <em> · {late} trễ</em>} · chốt {fd(r.e)}
                  </div>
                </div>
              ))}
              <div className="ss-today" style={{ left: tx }} />
            </div>
          </div>
        </div>
      )}

      {noPlan.length > 0 && (
        <div className="oppt-none">
          <div className="oppss-h">Chưa có bảng công việc ({noPlan.length}) <span>bấm để mở và lập bảng</span></div>
          <div className="oppt-chips">
            {noPlan.map(({ o }) => <button type="button" key={o.id} className="chip" onClick={() => onOpen(o.id)}>{o.title} <small>· {o.status === "open" ? stageLabel(o.currentStage) : o.status === "won" ? "WON" : "LOST"}</small></button>)}
          </div>
        </div>
      )}
    </div>
  );
}
