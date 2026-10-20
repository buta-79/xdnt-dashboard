import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  todayISO, formatCompactVND, PROJECT_STAGES, PRIORITY_LABELS,
  projectCollected, projectAR, milestoneStatus, milestoneAmount, canAdvanceGate, ROLE_LABELS,
  NOTE_LABELS, NOTE_SYMBOL, NOTE_NEED_OPTIONS, NOTE_PRESETS, makeNote, openNotes,
  PLAN_STAGE_COUNT, PLAN_PHASES, PLAN_SIZE_OPTIONS, suggestPlanDays,
  projectPlan, planToPatch, suggestPlan, shiftPlanFrom, applyStageEnd, setStageSkip, setPlanStart, planStatus, planProgressPct,
  stepStart, stepDays, stepEndForDays, stepIsOwnStart, setStageStart, planOverlaps,
  schedItems, schedGroups, schedPct, schedIsLate, schedRange, schedSetDone, schedPullForward, schedDoneMessage, schedPending,
  addDaysISO, diffDays,
} from "./data/seed";
import { JobsBoard, ProjectJobs, JobRow, QuickAdd, jobOps } from "./JobsBoard";
import SiteSchedule, { varLabel, DoneDialog } from "./SiteSchedule";

/* ---------------------------------------------------------------------- */
/*  LỊCH TRIỂN KHAI CHUNG (Gantt) — thay cho bảng "Kế hoạch triển khai" cũ   */
/*  - 1 lịch theo ngày cho mọi dự án đang chạy                              */
/*  - lập kế hoạch nhanh: chỉ cần ngày bắt đầu + quy mô/ngày kết thúc        */
/*  - bước "Kiểm tra kế hoạch" trước khi xác nhận                           */
/*  - ghi chú tắc nghẽn / cần hỗ trợ theo bước (nhất là Sản xuất, Thi công)   */
/* ---------------------------------------------------------------------- */

const DAYW = { week: 16, month: 8, quarter: 4 };
const d2n = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const n2d = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const fd = (s) => (s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "—");
const fdy = (s) => (s ? fd(s) + "/" + s.slice(0, 4) : "—");
const stageLabel = (id) => PROJECT_STAGES.find((s) => s.id === id)?.label || "";
const RANK = { bad: 0, warn: 1, none: 2, good: 3, ready: 4, done: 5 };
const PRIO_N = { high: 3, normal: 2, low: 1 };
const PRIO_NEXT = { low: "normal", normal: "high", high: "low" };

function Dots({ priority }) {
  const n = PRIO_N[priority] || 2;
  return (
    <span className="tl-dots" title={`Ưu tiên: ${PRIORITY_LABELS[priority] || "Trung bình"}`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}
    </span>
  );
}

function StatusPill({ st }) {
  if (st.k === "good") return <span className="tl-pill good">✓ Đúng tiến độ</span>;
  if (st.k === "warn") return <span className="tl-pill warn">▲ Sắp hạn · còn {st.left}n</span>;
  if (st.k === "bad") return <span className="tl-pill bad">✕ {st.late > 0 ? `Trễ ${st.late} ngày` : "Điểm nghẽn"}</span>;
  if (st.k === "ready") return <span className="tl-pill ready">✓ Xong 12/12</span>;
  if (st.k === "done") return <span className="tl-pill none">Đã lưu trữ</span>;
  return <span className="tl-pill none">○ Chưa có kế hoạch</span>;
}

// Ô nhập "chốt giá trị khi rời ô / Enter / sau 0,9 giây" — tránh ghi lên Firestore từng phím gõ.
function CommitInput({ type, value, onCommit, className, min }) {
  const [text, setText] = useState(String(value));
  const timer = useRef(null);
  const last = useRef(String(value));
  useEffect(() => { setText(String(value)); last.current = String(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v, final) => {
    clearTimeout(timer.current);
    if (v === "") { if (final) setText(last.current); return; } // ô để trống (VD bấm “Xóa” ở lịch) → trả về giá trị cũ
    if (v !== last.current) { last.current = v; onCommit(v); }
  };
  return (
    <input
      type={type} className={className} min={min} value={text}
      onChange={(e) => { const v = e.target.value; setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => commit(v), 900); }}
      onBlur={(e) => commit(e.target.value, true)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.target.value, true); }}
    />
  );
}

/* ====================================================================== */
/*  GANTT                                                                  */
/* ====================================================================== */

function ganttRange(rows, today) {
  let mn = d2n(today) - 14, mx = d2n(today) + 30;
  rows.forEach(({ p, plan, st }) => {
    mn = Math.min(mn, d2n(plan ? (plan.minStart || plan.start) : (p.plannedStart || p.createdAt || today)));
    if (plan) mx = Math.max(mx, d2n(plan.end) + (st.late || 0));
    (p.paymentMilestones || []).forEach((m) => { if (m.plannedDate) mx = Math.max(mx, d2n(m.plannedDate)); });
    const sr = schedRange(schedItems(p));
    if (sr) { mn = Math.min(mn, d2n(sr.s)); mx = Math.max(mx, d2n(sr.e)); }
  });
  mn -= 5; mx += 14; mn -= (mn + 3) % 7; // lùi về thứ Hai
  return { mn, mx };
}

// Các giai đoạn của 1 kế hoạch + làn vẽ. Giai đoạn chạy chồng lên nhau được xếp xuống làn dưới (song song).
function phaseLayout(plan) {
  const sk = plan.skips || [];
  const list = [];
  PLAN_PHASES.forEach((ph, k) => {
    const idx = [];
    for (let i = ph.from - 1; i <= ph.to - 1; i++) if (!sk[i]) idx.push(i);
    if (!idx.length) return; // cả giai đoạn được bỏ qua → không vẽ
    const a = idx.map((i) => stepStart(plan, i)).reduce((m, x) => (x < m ? x : m));
    const b = idx.map((i) => plan.ends[i]).reduce((m, x) => (x > m ? x : m));
    const own = idx.some((i) => stepIsOwnStart(plan, i));
    const w0 = Math.max(1, d2n(b) - d2n(a) + (own ? 1 : 0)); // giai đoạn xong trong 1 ngày vẫn vẽ 1 ô
    list.push({ ph, k, a, b, w0 });
  });
  const laneEnd = [];
  [...list].sort((x, y) => d2n(x.a) - d2n(y.a) || x.k - y.k).forEach((it) => {
    let L = laneEnd.findIndex((e) => d2n(it.a) >= e);
    if (L < 0) { L = laneEnd.length; laneEnd.push(0); }
    laneEnd[L] = d2n(it.a) + it.w0;
    it.lane = L;
  });
  return { items: list, lanes: Math.max(1, laneEnd.length) };
}

function GanttChart({ rows, meta, zoom, layers, selId, onSelect, onHandleDown, today, tasksByCode, scrollRef, expanded, onToggleExp, onOpenSite, onToggleItem }) {
  const dw = DAYW[zoom], { mn, mx } = meta, W = (mx - mn) * dw, wkw = 7 * dw;
  const tn = d2n(today), tx = (tn - mn) * dw;

  const months = [];
  {
    const d0 = new Date(mn * 86400000);
    let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1) / 86400000;
    while (cur < mx) {
      const dt = new Date(cur * 86400000), next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / 86400000;
      months.push({ left: Math.max(0, (cur - mn) * dw), width: (Math.min(next, mx) - Math.max(cur, mn)) * dw, label: `Th${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}` });
      cur = next;
    }
  }
  const weeks = [];
  for (let d = mn; d < mx; d += 7) weeks.push(d);

  const load = [];
  for (let d = mn; d < mx; d += 7) {
    const n = rows.filter(({ plan }) => plan && d2n(plan.start) < d + 7 && d2n(plan.end) >= d).length;
    if (n) load.push({ d, n });
  }

  return (
    <div className="tl-g-scroll" ref={scrollRef}>
      <div className="tl-g-inner" style={{ "--tl-wkw": `${wkw}px`, minWidth: `calc(var(--tl-namew) + ${W}px)` }}>
        <div className="tl-g-hd">
          <div className="tl-g-name">Dự án / bước hiện tại</div>
          <div className="tl-g-track" style={{ width: W }}>
            {months.map((m, i) => <div className="tl-mth" key={i} style={{ left: m.left, width: m.width }}>{m.label}</div>)}
            {weeks.map((d) => <div className="tl-wk" key={d} style={{ left: (d - mn) * dw, width: wkw }}>{zoom === "week" ? fd(n2d(d)) : ""}</div>)}
            <div className="tl-today-lbl" style={{ left: tx }}>Hôm nay {fd(today)}</div>
            <div className="tl-today" style={{ left: tx }} />
          </div>
        </div>

        {rows.map(({ p, plan, st }) => {
          const cur = p.currentStage;
          const myTasks = tasksByCode[p.code] || [];
          const nOpen = openNotes(p);
          const nb = nOpen.filter((n) => n.type === "block").length, nh = nOpen.filter((n) => n.type === "help").length;
          const openBn = (p.bottlenecks || []).filter((b) => !b.resolvedAt);
          const pct = planProgressPct(p, today);
          const stage = PROJECT_STAGES.find((s) => s.id === cur);
          const lay = plan ? phaseLayout(plan) : null;     // các giai đoạn + làn (làn 2, 3… = chạy song song)
          const LH = 24, extra = lay ? (lay.lanes - 1) * LH : 0;
          const its = schedItems(p), isOpen = !!(expanded && expanded[p.id]) && its.length > 0;
          const curLane = lay ? (lay.items.find((x) => x.ph.from <= cur && cur <= x.ph.to)?.lane || 0) : 0;
          return (
            <React.Fragment key={p.id}>
            <div className={`tl-g-row ${p.id === selId ? "sel" : ""}`} style={extra ? { height: 84 + extra } : undefined} onClick={() => onSelect(p.id)}>
              <div className="tl-g-name" title="Nhấp đúp để mở bảng Tiến độ thi công của dự án" onDoubleClick={() => onOpenSite(p.id)}>
                <div className="tl-gn1"><span style={{ display: "inline-flex", alignItems: "center" }}>{its.length > 0 && <button className={`tl-xp ${isOpen ? "on" : ""}`} title="Xem / ẩn các hạng mục thi công của dự án này" onClick={(e) => { e.stopPropagation(); onToggleExp(p.id); }} onDoubleClick={(e) => e.stopPropagation()}>{isOpen ? "▾" : "▸"} {its.length}</button>}<b>{p.code.replace("TDDB-", "")}</b></span><Dots priority={p.priority} /><StatusPill st={st} /></div>
                <div className="tl-gn2" title={p.name}>{p.name}</div>
                <div className="tl-gn3">
                  Bước {cur}/{PROJECT_STAGES.length} · {stage?.label} · {pct}%
                  {plan && p.planConfirmed === false ? " · KH nháp" : ""}
                  {lay && lay.lanes > 1 && <> · <b className="par">⇉ song song</b></>}
                  {nb > 0 && <> · <b className="r">!{nb}</b></>}
                  {nh > 0 && <> · <b className="a">+{nh}</b></>}
                </div>
              </div>
              <div className="tl-g-track" style={{ width: W }}>
                {plan ? lay.items.map(({ ph, k, a, b, lane, w0 }) => {
                  const state = ph.to < cur ? "done" : (ph.from <= cur && cur <= ph.to) ? "cur" : "fut";
                  const left = (d2n(a) - mn) * dw, w = Math.max(2, w0 * dw);
                  const label = w > 78 ? ph.name : (w > 30 ? ph.name.split(" ")[0] : "");
                  const fillw = state === "cur" ? Math.max(0, Math.min(w0, tn - d2n(a))) * dw : 0;
                  const top = 26 + lane * LH;
                  return (
                    <React.Fragment key={k}>
                      <div className={`tl-seg-b ${state}`} style={{ left, width: w, top }} title={`${ph.name}: ${fd(a)} → ${fd(b)}${lane > 0 ? " (chạy song song)" : ""}`}>
                        {state === "cur" && <span className="fill" style={{ width: fillw }} />}
                        <span style={{ position: "relative", color: state === "cur" && fillw > w * 0.5 ? "#fff" : undefined }}>{label}</span>
                      </div>
                      {ph.to >= cur && (
                        <div className="tl-hd" style={{ left: (d2n(b) - mn) * dw, top: top - 4 }}
                          title={`Kéo để dời mốc “${ph.name}” (các bước sau dời theo)`}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => onHandleDown(e, p, k)} />
                      )}
                    </React.Fragment>
                  );
                }) : (
                  <div className="tl-noplan" style={{ left: (d2n(p.plannedStart || p.createdAt || today) - mn) * dw, width: Math.max(210, (tn - d2n(p.plannedStart || p.createdAt || today)) * dw) }}>
                    Chưa có kế hoạch · đã chạy {Math.max(0, diffDays(p.plannedStart || p.createdAt || today, today))} ngày
                  </div>
                )}
                {plan && st.k === "bad" && st.late > 0 && (() => {
                  const cb = plan.ends[Math.min(cur, PLAN_STAGE_COUNT) - 1];
                  return (
                    <>
                      <div className="tl-over" style={{ left: (d2n(cb) - mn) * dw, width: (tn - d2n(cb)) * dw, top: 26 + curLane * LH }} title={`Bước hiện tại đã quá hạn ${st.late} ngày`}>{st.late}n</div>
                      <div className="tl-tail" style={{ left: (d2n(plan.end) - mn) * dw, width: st.late * dw, top: 26 + curLane * LH }} title={`Dự báo hoàn thành ${fdy(st.forecastEnd)}`}>+{st.late}n</div>
                    </>
                  );
                })()}

                {layers.ms && (p.paymentMilestones || []).map((m, i) => m.plannedDate && (
                  <span key={m.id || i} className={`tl-mk ms tl-ms-${milestoneStatus(p, i)}`} style={{ left: (d2n(m.plannedDate) - mn) * dw }}
                    title={`Thu ${m.label} · ${formatCompactVND(milestoneAmount(p, i))} · ${fdy(m.plannedDate)}`}>◆</span>
                ))}
                {layers.bn && openBn.map((b) => (
                  <span key={b.id} className="tl-mk bn" style={{ left: (d2n(b.at) - mn) * dw }} title={`Điểm nghẽn từ ${fdy(b.at)}: ${b.reason}`}>⚑</span>
                ))}
                {layers.tk && myTasks.map((t) => {
                  const od = diffDays(t.dueDate, today) > 0;
                  return <span key={t.id} className={`tl-mk tk ${od ? "tl-tk-od" : "tl-tk-ok"}`} style={{ left: (d2n(t.dueDate) - mn) * dw, top: 69 + extra }} title={`Hạn: ${t.title} · ${fdy(t.dueDate)}${od ? " (quá hạn)" : ""}`}>●</span>;
                })}
                {layers.nt && plan && (() => {
                  const cnt = {};
                  return nOpen.map((n) => {
                    const a = stepStart(plan, n.stage - 1), b = plan.ends[n.stage - 1];
                    const dn = Math.max(d2n(a), Math.min(d2n(b), d2n(n.date)));
                    cnt[n.stage] = (cnt[n.stage] || 0) + 1;
                    return (
                      <span key={n.id} className="tl-mk nt" style={{ left: (dn - mn) * dw + (cnt[n.stage] - 1) * 17, top: 52 + extra }}
                        title={`${NOTE_LABELS[n.type]} · bước ${n.stage} ${stageLabel(n.stage)}: ${n.text}${n.need ? " (cần " + n.need + ")" : ""}`}>
                        <i className={`tl-nm ${n.type}`}>{NOTE_SYMBOL[n.type]}</i>
                      </span>
                    );
                  });
                })()}
                <div className="tl-today" style={{ left: tx }} />
              </div>
            </div>
            {isOpen && schedGroups(p).map((g) => {
              const gs = its.filter((i) => i.gid === g.id);
              if (!gs.length) return null;
              const gr = schedRange(gs);
              return (
                <React.Fragment key={g.id}>
                  <div className="tl-g-row tl-g-sub grp">
                    <div className="tl-g-name"><span className="tx">{g.name}</span><span className="tl-note">{schedPct(gs)}%</span></div>
                    <div className="tl-g-track" style={{ width: W }}>
                      <div className="tl-sbar sum" style={{ left: (d2n(gr.s) - mn) * dw, width: Math.max(3, (d2n(gr.e) - d2n(gr.s) + 1) * dw - 1) }}><i style={{ width: `${schedPct(gs)}%` }} /></div>
                      <div className="tl-today" style={{ left: tx }} />
                    </div>
                  </div>
                  {gs.map((it) => {
                    const vl = varLabel(it);
                    const cls = it.pc >= 100 ? "dn" : schedIsLate(it, today) ? "late" : "";
                    return (
                      <div className="tl-g-row tl-g-sub" key={it.id}>
                        <div className="tl-g-name" title={it.t}>
                          <input type="checkbox" checked={it.pc >= 100} title="Đánh dấu hoàn thành — xong sớm thì rút ngắn thời gian" onChange={(e) => onToggleItem(p, it.id, e.target.checked)} />
                          <span className="tx">{it.t}</span>
                          {vl && <span className={`ss-var ${vl.cls}`}>{vl.t}</span>}
                        </div>
                        <div className="tl-g-track" style={{ width: W }}>
                          {it.e0 && it.e0 !== it.e && <div className="tl-sbase" title={`Kế hoạch gốc: ${fd(it.s0 || it.s)} → ${fd(it.e0)}`} style={{ left: (d2n(it.s0 || it.s) - mn) * dw, width: Math.max(3, (d2n(it.e0) - d2n(it.s0 || it.s) + 1) * dw - 1) }} />}
                          <div className={`tl-sbar ${cls}`} title={`${it.t}: ${fd(it.s)} → ${fd(it.e)} · ${it.pc}%${vl ? " · " + vl.t : ""}`} style={{ left: (d2n(it.s) - mn) * dw, width: Math.max(3, (d2n(it.e) - d2n(it.s) + 1) * dw - 1) }}><i style={{ width: `${it.pc}%` }} /></div>
                          <div className="tl-today" style={{ left: tx }} />
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
            </React.Fragment>
          );
        })}
        {rows.length === 0 && <div className="tl-panel-b tl-note">Không có dự án nào đang triển khai.</div>}

        <div className="tl-g-load">
          <div className="tl-g-name">Số DA chạy song song / tuần</div>
          <div className="tl-g-track" style={{ width: W }}>
            {load.map(({ d, n }) => (
              <div key={d} className="tl-ldb" style={{ left: (d - mn) * dw + 1, width: wkw - 2, height: 6 + n * 7 }}>{wkw > 40 ? n : ""}</div>
            ))}
            <div className="tl-today" style={{ left: tx }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  BƯỚC KIỂM TRA KẾ HOẠCH                                                 */
/* ====================================================================== */

function ReviewPanel({ p, plan, cascade, setCascade, onEditEnd, onSetSkip, onSetStart, onSetStageStart, onOpenSite, onConfirm, onClose, onReplan, reviewRef }) {
  const cur = p.currentStage;
  const total = Math.max(1, diffDays(plan.minStart || plan.start, plan.end));
  const overlaps = planOverlaps(plan);
  const bar = PROJECT_STAGES.slice(0, PLAN_STAGE_COUNT).map((s, i) => {
    const dur = stepDays(plan, i);
    const c = i + 1 < cur ? "d" : i + 1 === cur ? "c" : "f";
    if (dur === 0) return null; // bước bỏ qua: không chiếm thời gian
    return <div key={s.id} className={c} style={{ flex: `${dur} 1 0` }} title={`${s.id}. ${s.label}: ${dur} ngày`}>{s.id}</div>;
  });
  const notes = openNotes(p);
  const firstIdx = (() => { let k = 0; while (k < PLAN_STAGE_COUNT - 1 && plan.skips && plan.skips[k]) k += 1; return k; })();
  const skipNames = PROJECT_STAGES.slice(0, PLAN_STAGE_COUNT).filter((s, i) => plan.skips && plan.skips[i]).map((s) => `${s.id}. ${s.label}`);
  const ms = p.paymentMilestones || [];
  const lastMs = ms.length ? ms[ms.length - 1].plannedDate : null;
  const gap = lastMs ? diffDays(lastMs, plan.end) : null;
  const goodDate = (v) => v && v >= "2000-01-01";

  return (
    <div className="tl-panel tl-rv" ref={reviewRef}>
      <div className="tl-panel-h">
        <h3>Kiểm tra kế hoạch · {p.code}</h3><span className="sub">{p.name}</span><div className="tl-sp" />
        {p.planConfirmed === false ? <span className="tl-pill draft">Nháp — chờ bạn xác nhận</span> : <span className="tl-pill good">✓ Đã xác nhận</span>}
      </div>
      <div className="tl-panel-b">
        <div className="tl-row2" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span>{fdy(plan.minStart || plan.start)} → <b>{fdy(plan.end)}</b> · tổng <b>{diffDays(plan.minStart || plan.start, plan.end)} ngày</b></span>
          <label className="tl-note" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} /> Đổi hạn một bước thì dời các bước sau theo
          </label>
        </div>
        <div className="tl-rv-bar" title="Độ dài các bước theo tỷ lệ">{bar}</div>
        <div className="tl-tbl-wrap">
          <table>
            <thead><tr><th></th><th>Bước</th><th>Phụ trách</th><th>Bắt đầu</th><th>Hạn kết thúc</th><th>Số ngày</th><th>Tỷ trọng</th><th>Song song / ghi chú</th></tr></thead>
            <tbody>
              {PROJECT_STAGES.slice(0, PLAN_STAGE_COUNT).map((s, i) => {
                const a = stepStart(plan, i), b = plan.ends[i], dur = stepDays(plan, i);
                const done = p.stages[s.id]?.state === "done";
                const skipped = !!(plan.skips && plan.skips[i]);
                const dv = !done && !skipped ? plan.derived[i] : null; // bước lấy ngày từ "Tiến độ thi công"
                const own = stepIsOwnStart(plan, i);
                const par = overlaps.find((o) => o.idx === i);
                const firstActive = i === firstIdx && !done;
                const nts = notes.filter((x) => x.stage === s.id);
                const minEnd = a; // được chọn hạn = đúng ngày bắt đầu (xong trong ngày)
                return (
                  <tr key={s.id} className={skipped ? "rv-skip" : done ? "rv-done" : s.id === cur ? "rv-cur" : ""}>
                    <td>{done ? "✓" : s.id === cur ? "▶" : s.id}</td>
                    <td><b>{s.label}</b>{(s.id === 6 || s.id === 7) && <> <span className="tl-pill warn" style={{ fontSize: 10 }}>trọng tâm</span></>}{skipped && <> <span className="tl-pill none" style={{ fontSize: 10 }}>bỏ qua</span></>}</td>
                    <td>{s.who}</td>
                    <td className="tl-num">{skipped ? "—" : done || dv ? fd(a)
                      : firstActive
                        ? <CommitInput type="date" className="input input-sm" value={a} onCommit={(v) => goodDate(v) && onSetStart(v)} />
                        : <span className="rv-own"><CommitInput type="date" className="input input-sm" value={a} onCommit={(v) => goodDate(v) && onSetStageStart(i, v)} />
                          {own && <button className="rv-reset" title="Quay về: bắt đầu ngay khi bước trước kết thúc" onClick={() => onSetStageStart(i, null)}>↺</button>}</span>}</td>
                    <td>{done ? <span className="tl-num">{skipped ? "bỏ qua" : `${fd(b)} (xong)`}</span>
                      : dv ? <span className="tl-num">{fd(b)}</span>
                      : skipped ? <CommitInput type="date" className="input input-sm" value={b} min={a} onCommit={(v) => goodDate(v) && diffDays(a, v) >= 0 && onSetSkip(i, false, Math.max(1, diffDays(a, v)))} />
                      : <CommitInput type="date" className="input input-sm" value={b} min={minEnd} onCommit={(v) => goodDate(v) && onEditEnd(i, v)} />}</td>
                    <td>{done || dv ? <span className="tl-num">{skipped ? 0 : dur}</span>
                      : <CommitInput type="number" min="0" className="input input-sm dur" value={dur}
                          onCommit={(v) => {
                            const n = Math.round(+v);
                            if (!(n >= 0)) return;
                            if (n === 0) { if (!skipped) onSetSkip(i, true, 0); }
                            else if (skipped) onSetSkip(i, false, n);
                            else onEditEnd(i, stepEndForDays(plan, i, n));
                          }} />}</td>
                    <td className="tl-num">{Math.round((dur / total) * 100)}%</td>
                    <td>
                      {dv && <span className="tl-pill warn rv-chip" title="Ngày bắt đầu, kết thúc và % lấy từ bảng Tiến độ thi công — sửa ở đó" onClick={onOpenSite} style={{ cursor: "pointer" }}>lấy từ Tiến độ thi công · {dv.pc}%</span>}
                      {par && <span className="tl-pill ready rv-chip" title="Bước này bắt đầu khi bước trước chưa kết thúc">song song với bước {par.with[par.with.length - 1] + 1}</span>}
                      {nts.map((x) => <i key={x.id} className={`tl-nm ${x.type}`} title={`${NOTE_LABELS[x.type]}: ${x.text}`} style={{ marginRight: 3 }}>{NOTE_SYMBOL[x.type]}</i>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {skipNames.length > 0 && <div className="tl-okbox" style={{ marginTop: 8 }}>↷ Bỏ qua {skipNames.length} bước (không cần ở dự án này): {skipNames.join(" · ")} — tự chuyển qua khi tới lượt, không cần tick điều kiện.</div>}
        {gap !== null && (gap > 0
          ? <div className="tl-warnbox">▲ Kế hoạch kết thúc <b>sau</b> đợt thu cuối ({fd(lastMs)}) {gap} ngày — nên rút kế hoạch hoặc dời đợt thu <span className="tl-src">Thu hồi công nợ</span></div>
          : <div className="tl-okbox" style={{ marginTop: 8 }}>✓ Kế hoạch kết thúc {gap === 0 ? "đúng" : `sớm ${-gap} ngày so với`} đợt thu cuối ({fd(lastMs)}) <span className="tl-src">Thu hồi công nợ</span></div>)}
        <div className="tl-row2" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={onConfirm}>{p.planConfirmed === false ? "Xác nhận kế hoạch" : "Lưu & đóng"}</button>
          <button className="btn btn-outline" onClick={onClose}>Đóng</button>
          <button className="btn btn-ghost" onClick={onReplan}>Lập lại từ đầu…</button>
          <span className="tl-note">Bước đã xong được khóa; sửa hạn hoặc số ngày đều được (lưu khi rời ô hoặc nhấn Enter). <b>Nhập 0 ngày = bỏ qua bước đó</b>; nhập lại số ngày ≥ 1 để bật lại. <b>Mỗi bước có ngày bắt đầu riêng</b> — đặt ngày bắt đầu sớm hơn hạn của bước trước thì hai bước <b>chạy song song</b> (nhấn ↺ để quay về “bắt đầu khi bước trước xong”). Ngày bắt đầu của bước đầu tiên chọn được cả ngày đã qua. Các bước có nhãn <b>lấy từ Tiến độ thi công</b> tự cập nhật theo bảng hạng mục, không dời theo các bước khác.</span>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  PANEL CHI TIẾT BÊN PHẢI                                                */
/* ====================================================================== */

function PlanSetup({ p, today, onCreate }) {
  const [start, setStart] = useState(p.plannedStart || p.createdAt || today);
  const [days, setDays] = useState(suggestPlanDays(p.contractValue));
  const [end, setEnd] = useState("");
  const cur = Math.min(p.currentStage, PLAN_STAGE_COUNT);
  const preview = useMemo(() => {
    try { return suggestPlan(p, { start, days, end: end || null }, today); } catch (e) { return null; }
  }, [p, start, days, end, today]);
  const opts = [{ days: suggestPlanDays(p.contractValue), label: `Đề xuất theo HĐ (~${suggestPlanDays(p.contractValue)} ngày)` }, ...PLAN_SIZE_OPTIONS];
  return (
    <div className="tl-sec">
      <h4>Tạo kế hoạch nhanh · 2 thông tin</h4>
      <div className="tl-row2" style={{ marginBottom: 6 }}>
        <label className="tl-row2">Bắt đầu <input type="date" className="input input-sm" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="tl-row2">Kết thúc <input type="date" className="input input-sm" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <div className="tl-note">Không biết ngày kết thúc? Chọn quy mô:</div>
      <div className="tl-opt">
        {opts.map((o, i) => <button key={i} className={!end && days === o.days ? "on" : ""} onClick={() => { setDays(o.days); setEnd(""); }}>{o.label}</button>)}
      </div>
      {preview && (
        <div className="tl-okbox">
          <div className="tl-kv"><span>Dự kiến hoàn thành</span><b className="tl-num">{fdy(preview.end)}</b></div>
          <div className="tl-kv"><span>Bước {cur} “{stageLabel(cur)}” hết hạn</span><b className="tl-num">{fd(preview.ends[cur - 1])}</b></div>
          <div className="tl-note">Hệ thống tự chia 12 bước theo tỷ trọng thời gian thông thường{cur > 1 ? `; ${cur - 1} bước đã qua dùng ngày hoàn thành thực tế (nếu có)` : ""}. Chỉnh sau bằng cách kéo mốc trên lịch hoặc ở bước kiểm tra.</div>
        </div>
      )}
      <div className="tl-row2" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={!preview || !start} onClick={() => preview && onCreate(preview)}>Tạo kế hoạch</button>
      </div>
    </div>
  );
}

function CurrentStepCard({ p, plan, st, currentRole, isBOD, onShift, onToggleGate, onAdvance }) {
  const cur = p.currentStage;
  if (cur > PLAN_STAGE_COUNT) {
    return (
      <div className="tl-sec"><h4>Trạng thái</h4>
        <div className="tl-okbox">✓ Đã xong 12 bước triển khai (tới Thu tiền). Warranty / CLOSED tiếp tục ở trang Dự án — hoặc lưu trữ dự án ở cuối panel này.</div>
      </div>
    );
  }
  const def = PROJECT_STAGES.find((s) => s.id === cur);
  const stage = p.stages[cur];
  const canAct = isBOD || currentRole === def.who;
  const ok = canAdvanceGate(def, stage);
  return (
    <div className="tl-sec">
      <h4>Bước hiện tại</h4>
      <div className="tl-curcard">
        <div className="tl-row2" style={{ justifyContent: "space-between" }}><b>{cur}. {def.label}</b><span className="tl-note">Phụ trách: {def.who}</span></div>
        {plan && <div className="tl-kv"><span>Hạn hoàn thành</span><b className="tl-num">{fdy(plan.ends[cur - 1])}</b></div>}
        {(cur === 6 || cur === 7) && <div className="tl-note" style={{ margin: "2px 0 6px" }}>Giai đoạn trọng tâm — ghi lại tắc nghẽn / cần hỗ trợ ở mục “Ghi chú & hỗ trợ” bên dưới.</div>}
        {plan && (
          <div className="tl-row2" style={{ margin: "4px 0 6px" }}>
            <span className="tl-note">Dời hạn bước này và các bước sau:</span>
            {[-7, -1, 1, 7].map((d) => <button key={d} className="btn btn-outline btn-sm" onClick={() => onShift(d)}>{d > 0 ? "+" : ""}{d}n</button>)}
          </div>
        )}
        {def.gate.length > 0 && <div className="tl-note" style={{ marginBottom: 2 }}>Điều kiện hoàn thành bước:</div>}
        {def.gate.map((t, i) => (
          <label className="tl-gate" key={i}>
            <input type="checkbox" checked={!!stage.gateChecked?.[i]} disabled={!canAct} onChange={() => onToggleGate(cur, i)} /><span>{t}</span>
          </label>
        ))}
        <div className="tl-row2" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={!canAct || !ok} onClick={onAdvance}>Hoàn thành bước {cur} →</button>
          {canAct ? (!ok && <span className="tl-note">Tick đủ điều kiện để mở nút</span>)
            : <span className="tl-note">Chỉ {ROLE_LABELS[def.who]} hoặc BOD thực hiện bước này.</span>}
        </div>
      </div>
    </div>
  );
}

function NotesSection({ p, currentRole, onAdd, onToggle, onRemove }) {
  const cur = Math.min(p.currentStage, PLAN_STAGE_COUNT);
  const [type, setType] = useState("help");
  const [stage, setStage] = useState(cur);
  const [need, setNeed] = useState("BOD");
  const [text, setText] = useState("");
  const ord = ["block", "help", "note"];
  const all = p.notes || [];
  const open = all.filter((n) => !n.resolved).sort((a, b) => ord.indexOf(a.type) - ord.indexOf(b.type) || a.stage - b.stage);
  const done = all.filter((n) => n.resolved);
  const item = (n, first) => (
    <div className={`tl-nt ${n.resolved ? "res" : ""} ${first ? "first" : ""}`} key={n.id}>
      <i className={`tl-nm ${n.type}`}>{NOTE_SYMBOL[n.type]}</i>
      <div className="tl-nt-b">
        <div><b>{NOTE_LABELS[n.type]}</b> · <span className="tl-note">Bước {n.stage} {stageLabel(n.stage)}</span></div>
        <div>{n.text}</div>
        <div className="tl-note">{n.need ? `Cần: ${n.need} · ` : ""}{fd(n.date)}</div>
      </div>
      <div className="tl-nt-a">
        <button className="btn btn-outline btn-sm" onClick={() => onToggle(n.id)}>{n.resolved ? "Mở lại" : "Đã xử lý"}</button>
        <button className="btn btn-ghost btn-sm" title="Xóa" onClick={() => onRemove(n.id)}>✕</button>
      </div>
    </div>
  );
  const add = () => {
    if (!text.trim()) return;
    onAdd({ stage, type, need, text: text.trim() });
    setText("");
  };
  return (
    <div className="tl-sec">
      <h4>Ghi chú & hỗ trợ <span className="tl-src">{open.length} đang mở</span></h4>
      {open.length === 0 ? <div className="tl-note">Chưa có ghi chú nào đang mở.</div> : open.map((n, i) => item(n, i === 0))}
      <div className="tl-nform">
        <div className="tl-note" style={{ marginBottom: 4 }}>Thêm nhanh — nhất là cho bước ★ Manufacturing / Construction</div>
        <div className="tl-opt" style={{ marginTop: 0 }}>
          {ord.map((t) => <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}><i className={`tl-nm ${t}`}>{NOTE_SYMBOL[t]}</i> {NOTE_LABELS[t]}</button>)}
        </div>
        <div className="tl-row2" style={{ margin: "4px 0" }}>
          <label className="tl-row2">Bước
            <select className="input input-sm" value={stage} onChange={(e) => setStage(+e.target.value)}>
              {PROJECT_STAGES.slice(0, PLAN_STAGE_COUNT).map((s) => <option key={s.id} value={s.id}>{s.id}. {s.label}{s.id === 6 || s.id === 7 ? " ★" : ""}</option>)}
            </select>
          </label>
          {type !== "note" && (
            <label className="tl-row2">Cần
              <select className="input input-sm" value={need} onChange={(e) => setNeed(e.target.value)}>
                {NOTE_NEED_OPTIONS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="tl-opt">{NOTE_PRESETS[type].map((t) => <button key={t} onClick={() => setText(t)}>{t}</button>)}</div>
        <div className="tl-row2" style={{ flexWrap: "nowrap" }}>
          <input type="text" className="input input-sm tl-nin" placeholder="Chọn mẫu trên hoặc gõ ghi chú ngắn…" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={add}>Thêm</button>
        </div>
      </div>
      {done.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="tl-note" style={{ cursor: "pointer" }}>Đã xử lý ({done.length})</summary>
          {done.map((n, i) => item(n, i === 0))}
        </details>
      )}
    </div>
  );
}

function OtherPages({ p, tasks, today }) {
  const ms = p.paymentMilestones || [];
  const lbl = { paid: "Đã thu", overdue: "Quá hạn", upcoming: "Sắp tới", ontrack: "Theo kế hoạch" };
  const openBn = (p.bottlenecks || []).filter((b) => !b.resolvedAt);
  const wi = (p.workItems || []).filter((w) => w.status !== "done");
  const costs = p.costs || [];
  const budget = costs.reduce((s, c) => s + (c.budget || 0), 0), actual = costs.reduce((s, c) => s + (c.actual || 0), 0);
  const extra = costs.filter((c) => /phát sinh/i.test(c.category || "")).reduce((s, c) => s + (c.actual || 0), 0);
  return (
    <>
      <div className="tl-sec">
        <h4>Đợt thu tiền <span className="tl-src">Thu hồi công nợ</span></h4>
        {ms.length === 0 && <div className="tl-note">Chưa thiết lập đợt thanh toán — vào “Thu hồi công nợ” để thêm.</div>}
        {ms.map((m, i) => {
          const s = milestoneStatus(p, i);
          return <div className="tl-ms-i" key={m.id || i}><span>◆ {m.label} · {fd(m.plannedDate)}</span><span className="tl-num">{formatCompactVND(milestoneAmount(p, i))} <span className={`tl-st ${s}`}>{lbl[s]}</span></span></div>;
        })}
        <div className="tl-kv" style={{ marginTop: 4 }}><span>Đã thu / còn lại</span><b className="tl-num">{formatCompactVND(projectCollected(p))} / {formatCompactVND(Math.max(0, projectAR(p)))}</b></div>
      </div>
      {(tasks.length > 0 || openBn.length > 0) && (
        <div className="tl-sec">
          <h4>Điểm nghẽn & nhiệm vụ <span className="tl-src">Nhiệm vụ & Deadline</span></h4>
          {openBn.map((b) => (
            <div className="tl-badbox" key={b.id} style={{ marginBottom: 6 }}>⚑ {b.reason}<div className="tl-note" style={{ color: "#7C2A1C" }}>Từ {fdy(b.at)} · {Math.max(0, diffDays(b.at, today))} ngày · bước {b.stageId}</div></div>
          ))}
          {tasks.map((t) => {
            const od = diffDays(t.dueDate, today) > 0;
            return <div className="tl-ms-i" key={t.id}><span>{od ? "●" : "○"} {t.title}{t.assignee ? <span className="tl-note"> · {t.assignee}</span> : null}</span><span className={`tl-num tl-st ${od ? "overdue" : "ontrack"}`}>{fd(t.dueDate)}{od ? " quá hạn" : ""}</span></div>;
          })}
        </div>
      )}
      {wi.length > 0 && (
        <div className="tl-sec">
          <h4>Công tác bổ sung <span className="tl-src">Dự án</span></h4>
          {wi.map((w) => <div className="tl-ms-i" key={w.id}><span>{w.title}</span><span className="tl-st ontrack">{w.status === "doing" ? "Đang làm" : "Chưa làm"}</span></div>)}
        </div>
      )}
      {costs.length > 0 && (
        <div className="tl-sec">
          <h4>Chi phí <span className="tl-src">Chi phí dự án</span></h4>
          <div className="tl-kv"><span>Thực tế / dự kiến</span><b className="tl-num">{formatCompactVND(actual)} / {formatCompactVND(budget)}{budget > 0 ? ` (${Math.round((actual / budget) * 100)}%)` : ""}</b></div>
          <div className="tl-kv"><span>Trong đó phát sinh</span><b className="tl-num">{formatCompactVND(extra)}</b></div>
        </div>
      )}
    </>
  );
}

function ArchiveSection({ p, isBOD, openTasksCount, onArchive }) {
  const [ask, setAsk] = useState(false);
  if (!isBOD) return <div className="tl-sec"><span className="tl-note">Chỉ BOD được đánh dấu hoàn thành → lưu trữ dự án.</span></div>;
  if (!ask) return <div className="tl-sec"><button className="btn btn-outline btn-sm" onClick={() => setAsk(true)}>Lưu trữ dự án…</button></div>;
  const ar = Math.max(0, projectAR(p));
  const openW = (p.workItems || []).filter((w) => w.status !== "done").length + openNotes(p).filter((n) => n.type !== "note").length + (p.jobs || []).filter((j) => !j.done).length;
  const total = openTasksCount + openW;
  return (
    <div className="tl-sec">
      <h4>Xác nhận lưu trữ</h4>
      <div className={p.currentStage > 10 ? "tl-okbox" : "tl-warnbox"} style={{ margin: "0 0 6px" }}>{p.currentStage > 10 ? "✓ Đã nghiệm thu & bàn giao" : `▲ Dự án mới ở bước ${p.currentStage}/${PROJECT_STAGES.length} — chưa tới bàn giao`}</div>
      <div className={ar > 0 ? "tl-warnbox" : "tl-okbox"} style={{ margin: "0 0 6px" }}>{ar > 0 ? `▲ Còn nợ ${formatCompactVND(ar)} — vẫn theo dõi ở “Thu hồi công nợ”` : "✓ Đã thu đủ công nợ"}</div>
      <div className={total > 0 ? "tl-warnbox" : "tl-okbox"} style={{ margin: "0 0 8px" }}>{total > 0 ? `▲ Còn ${openTasksCount} nhiệm vụ & ${openW} công tác / ghi chú chưa xử lý` : "✓ Không còn việc mở"}</div>
      <div className="tl-row2">
        <button className="btn btn-primary btn-sm" onClick={() => { onArchive(); setAsk(false); }}>Lưu trữ</button>
        <button className="btn btn-outline btn-sm" onClick={() => setAsk(false)}>Hủy</button>
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  BOARD                                                                  */
/* ====================================================================== */

export default function TimelineBoard({
  projects, tasks, currentRole, updateProject, toggleProjectGate, advanceProject, archiveProject, goToProject, focusCode,
}) {
  const today = todayISO();
  const isBOD = currentRole === "BOD";
  const [view, setView] = useState("active");
  const [mode, setMode] = useState("gantt"); // gantt | jobs | site
  const [jobsFocus, setJobsFocus] = useState(null);
  const [siteFocus, setSiteFocus] = useState(null);
  const [openAtt, setOpenAtt] = useState(null); // dòng "Cần xử lý" đang mở ô thêm công tác
  const [sort, setSort] = useState("risk");
  const [zoom, setZoom] = useState("month");
  const [layers, setLayers] = useState({ ms: true, bn: true, tk: true, nt: true });
  const [selId, setSelId] = useState(null);
  const [expanded, setExpanded] = useState({}); // dự án đang mở chi tiết hạng mục thi công trên Lịch chung
  const [reviewId, setReviewId] = useState(null);
  const [cascade, setCascade] = useState(true);
  const [toast, setToast] = useState(null);
  const [dragView, setDragView] = useState(null);
  const scrollRef = useRef(null);
  const reviewRef = useRef(null);
  const toastTimer = useRef(null);
  const dragRef = useRef(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!focusCode) return;
    const p = projects.find((x) => x.code === focusCode);
    if (p) { setSelId(p.id); setMode("gantt"); setView(p.status === "closed" ? "archived" : "active"); }
  }, [focusCode]);

  const showToast = (msg, undo, act) => {
    setToast({ msg, undo: undo || null, act: act || null });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), act ? 12000 : 7000);
  };
  // Ghi 1 patch lên dự án, kèm "Hoàn tác" (đưa các trường vừa đổi về giá trị cũ).
  const commit = (project, patch, msg) => {
    const prev = {};
    Object.keys(patch).forEach((k) => { prev[k] = project[k] ?? null; });
    updateProject(project.id, patch);
    if (msg) showToast(msg, () => { updateProject(project.id, prev); setToast(null); });
  };

  const rows = useMemo(() => projects.map((p) => ({ p, plan: projectPlan(p), st: planStatus(p, today) })), [projects, today]);
  const activeRows = useMemo(() => {
    const list = rows.filter((r) => r.p.status !== "closed");
    const cp = list.slice();
    if (sort === "risk") cp.sort((a, b) => RANK[a.st.k] - RANK[b.st.k] || (PRIO_N[b.p.priority] || 2) - (PRIO_N[a.p.priority] || 2));
    if (sort === "end") cp.sort((a, b) => (a.plan ? d2n(a.plan.end) : 9e9) - (b.plan ? d2n(b.plan.end) : 9e9));
    if (sort === "prio") cp.sort((a, b) => (PRIO_N[b.p.priority] || 2) - (PRIO_N[a.p.priority] || 2));
    if (sort === "value") cp.sort((a, b) => (b.p.contractValue || 0) - (a.p.contractValue || 0));
    return cp;
  }, [rows, sort]);
  const archivedRows = rows.filter((r) => r.p.status === "closed");

  const tasksByCode = useMemo(() => {
    const m = {};
    (tasks || []).forEach((t) => { if (t.projectCode && t.status === "open" && t.dueDate) (m[t.projectCode] = m[t.projectCode] || []).push(t); });
    return m;
  }, [tasks]);

  const selRow = rows.find((r) => r.p.id === selId) || activeRows[0] || archivedRows[0] || null;
  const reviewRow = reviewId ? rows.find((r) => r.p.id === reviewId) : null;
  const dragRow = dragView ? { ...dragView } : null;

  // dự án đang kéo: dùng kế hoạch tạm (chưa ghi) để vẽ
  const drawRows = activeRows.map((r) => (dragRow && dragRow.id === r.p.id ? { ...r, plan: dragRow.plan, st: planStatus({ ...r.p, ...planToPatch(r.p, dragRow.plan, r.p.planConfirmed !== false) }, today) } : r));
  const meta = ganttRange(drawRows, today);
  const showG = view !== "archived";

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (d2n(today) - meta.mn) * DAYW[zoom] - 200);
  };
  useEffect(() => { scrollToToday(); }, [zoom, showG, mode]);
  const reviewReady = !!(reviewRow && reviewRow.plan);
  useEffect(() => {
    if (reviewId && reviewReady && reviewRef.current) reviewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reviewId, reviewReady]);

  /* ---- KPI ---- */
  const act = activeRows.map((r) => r.p);
  let in30 = 0, over = 0, tasksOver = 0;
  act.forEach((p) => {
    (p.paymentMilestones || []).forEach((m, i) => {
      const s = milestoneStatus(p, i);
      if (s === "overdue") over += milestoneAmount(p, i);
      else if (s !== "paid" && m.plannedDate && diffDays(today, m.plannedDate) <= 30) in30 += milestoneAmount(p, i);
    });
    tasksOver += (tasksByCode[p.code] || []).filter((t) => diffDays(t.dueDate, today) > 0).length;
  });
  const allOpenNotes = act.flatMap((p) => openNotes(p));
  const nBlock = allOpenNotes.filter((n) => n.type === "block").length, nHelp = allOpenNotes.filter((n) => n.type === "help").length;
  const nLate = activeRows.filter((r) => r.st.k === "bad").length, nWarn = activeRows.filter((r) => r.st.k === "warn").length;
  const noPlan = activeRows.filter((r) => !r.plan && r.p.currentStage <= PLAN_STAGE_COUNT);
  const drafts = activeRows.filter((r) => r.plan && r.p.planConfirmed === false);
  const totalValue = act.reduce((s, p) => s + (p.contractValue || 0), 0);
  const lateJobsTotal = act.reduce((s, p) => s + (p.jobs || []).filter((j) => !j.done && j.due < today).length, 0);
  const lateSiteTotal = act.reduce((s, p) => s + schedItems(p).filter((i) => schedIsLate(i, today)).length, 0);

  /* ---- hành động ---- */
  const sel = selRow?.p;
  const doCreatePlan = (p, plan) => {
    commit(p, planToPatch(p, plan, false), `Đã tạo kế hoạch NHÁP cho ${p.code} — kiểm tra từng bước rồi bấm Xác nhận`);
    setReviewId(p.id);
  };
  const doBulk = () => {
    const todo = noPlan.map((r) => r.p);
    const undos = [];
    todo.forEach((p) => {
      const plan = suggestPlan(p, { start: p.plannedStart || p.createdAt || today, days: suggestPlanDays(p.contractValue) }, today);
      const patch = planToPatch(p, plan, false);
      const prev = {};
      Object.keys(patch).forEach((k) => { prev[k] = p[k] ?? null; });
      undos.push([p.id, prev]);
      updateProject(p.id, patch);
    });
    showToast(`Đã đề xuất kế hoạch NHÁP cho ${todo.length} dự án — mở từng cái để kiểm tra rồi xác nhận`, () => { undos.forEach(([id, prev]) => updateProject(id, prev)); setToast(null); });
  };
  const doShift = (p, plan, delta, msg) => {
    const cur = Math.min(p.currentStage, PLAN_STAGE_COUNT);
    commit(p, planToPatch(p, shiftPlanFrom(plan, cur - 1, delta), p.planConfirmed !== false), msg);
  };
  const doClearPlan = (p) => {
    const stages = { ...p.stages };
    for (let id = 1; id <= PLAN_STAGE_COUNT; id++) if (stages[id] && stages[id].state !== "done") stages[id] = { ...stages[id], plannedDate: null };
    commit(p, { plannedEnd: null, planBaseEnd: null, planConfirmed: null, stages }, "Đã xóa kế hoạch — tạo lại ở panel bên phải");
    setReviewId(null);
  };
  const addNote = (p, data) => {
    updateProject(p.id, { notes: [...(p.notes || []), makeNote(data)] });
    showToast(`Đã thêm ${NOTE_LABELS[data.type].toLowerCase()} cho bước ${data.stage} “${stageLabel(data.stage)}”`);
  };
  const toggleNote = (p, id) => updateProject(p.id, { notes: (p.notes || []).map((n) => (n.id === id ? { ...n, resolved: !n.resolved } : n)) });
  const removeNote = (p, id) => updateProject(p.id, { notes: (p.notes || []).filter((n) => n.id !== id) });

  /* ---- tick hoàn thành hạng mục thi công ngay trên Lịch chung (chọn ngày thực tế qua hộp thoại) ---- */
  const [doneDlg, setDoneDlg] = useState(null); // { pid, id }
  const applyDone = (p, id, done, opts) => {
    const items0 = schedItems(p), groups0 = schedGroups(p);
    const r = schedSetDone(items0, id, done, today, opts);
    const it = items0.find((x) => x.id === id);
    const prevSchedule = p.schedule || null;
    updateProject(p.id, { schedule: { groups: groups0, items: r.items } });
    const undo = () => { updateProject(p.id, { schedule: prevSchedule }); setToast(null); };
    const msg = `${p.code.slice(5)} · ${schedDoneMessage(it.t, done, r)}`;
    if (done && r.early > 0) {
      showToast(msg, undo, {
        label: `Dời các hạng mục sau sớm ${r.early} ngày`,
        fn: () => {
          const q = schedPullForward(r.items, id, r.early, today);
          updateProject(p.id, { schedule: { groups: groups0, items: q.items } });
          showToast(q.moved ? `Đã dời sớm ${q.moved} hạng mục nối sau — thời gian bàn giao rút ngắn tương ứng` : "Không có hạng mục nào dời được (đã sát hôm nay hoặc không nối sau)", () => { updateProject(p.id, { schedule: { groups: groups0, items: r.items } }); setToast(null); });
        },
      });
    } else showToast(msg, undo);
  };
  const toggleSiteItem = (p, id, done) => {
    if (done) { setDoneDlg({ pid: p.id, id }); return; }
    const it = schedItems(p).find((x) => x.id === id);
    if (it && it.bd && it.bd.status === "approved" && currentRole !== "BOD") { showToast("Hạng mục này đã được BOD duyệt ngày hoàn thành — chỉ BOD được bỏ đánh dấu xong"); return; }
    applyDone(p, id, false);
  };
  const openSite = (pid) => { setSelId(pid); setSiteFocus(pid); setMode("site"); };

  /* ---- kéo mốc trên Gantt ---- */
  const onHandleDown = (e, p, k) => {
    e.preventDefault(); e.stopPropagation();
    const plan0 = projectPlan(p);
    if (!plan0) return;
    setSelId(p.id);
    const d = { id: p.id, idx: PLAN_PHASES[k].to - 1, k, x0: e.clientX, plan0, dw: DAYW[zoom], moved: false, last: plan0 };
    dragRef.current = d;
    const move = (ev) => {
      const delta = Math.round((ev.clientX - d.x0) / d.dw);
      const np = shiftPlanFrom(d.plan0, d.idx, delta);
      d.last = np; d.moved = delta !== 0;
      const shown = diffDays(d.plan0.ends[d.idx], np.ends[d.idx]);
      setDragView({ id: d.id, plan: np, x: ev.clientX, y: ev.clientY, label: `${PLAN_PHASES[d.k].name}: ${fd(np.ends[d.idx])} (${shown >= 0 ? "+" : ""}${shown}n)` });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      setDragView(null);
      if (d.moved) {
        const proj = projectsRef.current.find((x) => x.id === d.id);
        if (proj) commit(proj, planToPatch(proj, d.last, proj.planConfirmed !== false), `Đã dời mốc “${PLAN_PHASES[d.k].name}”; các bước sau dời theo`);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ---- danh sách "Cần xử lý" ---- */
  const attention = [];
  activeRows.forEach(({ p, plan, st }) => {
    const c = p.code.slice(5);
    const cur = p.currentStage;
    if (st.k === "bad") {
      const bn = (p.bottlenecks || []).filter((b) => !b.resolvedAt);
      attention.push({ sev: 0, k: "bad", id: p.id, stage: cur, t: `${c} · ${st.late > 0 ? `Trễ ${st.late} ngày tại bước ${cur} “${stageLabel(cur)}”` : "Có điểm nghẽn"}`, sub: bn.length ? "⚑ " + bn[bn.length - 1].reason : "Dời kế hoạch hoặc xử lý" });
    }
    if (st.k === "warn") attention.push({ sev: 1, k: "warn", id: p.id, stage: cur, t: `${c} · Bước ${cur} “${stageLabel(cur)}” hết hạn sau ${st.left} ngày`, sub: "Xác nhận điều kiện để chốt bước" });
    (tasksByCode[p.code] || []).filter((t) => diffDays(t.dueDate, today) > 0).forEach((t) => attention.push({ sev: 2, k: "bad", id: p.id, t: `${c} · Nhiệm vụ quá hạn ${diffDays(t.dueDate, today)} ngày`, sub: `${t.title}${t.assignee ? " · " + t.assignee : ""}` }));
    (p.paymentMilestones || []).forEach((m, i) => {
      const s = milestoneStatus(p, i);
      if (s === "overdue") attention.push({ sev: 2, k: "bad", id: p.id, t: `${c} · Đợt thu “${m.label}” quá hạn ${diffDays(m.plannedDate, today)} ngày`, sub: formatCompactVND(milestoneAmount(p, i)) });
      else if (s === "upcoming" && diffDays(today, m.plannedDate) <= 7) attention.push({ sev: 3, k: "warn", id: p.id, t: `${c} · Đợt thu “${m.label}” đến hạn ${fd(m.plannedDate)}`, sub: formatCompactVND(milestoneAmount(p, i)) });
    });
    const lateJobs = (p.jobs || []).filter((j) => !j.done && j.due < today);
    if (lateJobs.length) attention.push({ sev: 2.2, k: "bad", id: p.id, t: `${c} · ${lateJobs.length} việc triển khai trễ hạn`, sub: lateJobs.slice(0, 2).map((j) => j.text).join(" · ") });
    const lateSite = schedItems(p).filter((i) => schedIsLate(i, today));
    if (lateSite.length) attention.push({ sev: 2.1, k: "bad", id: p.id, t: `${c} · ${lateSite.length} hạng mục thi công trễ hạn`, sub: lateSite.slice(0, 2).map((i) => `${i.t} (${i.pc}%)`).join(" · ") });
    const pendSite = schedItems(p).filter(schedPending);
    if (pendSite.length) attention.push({ sev: 2.4, k: "warn", id: p.id, t: `${c} · ${pendSite.length} hạng mục thi công chờ BOD duyệt ngày hoàn thành`, sub: pendSite.slice(0, 2).map((i) => `${i.t} (xong ${fd(i.bd.date)})`).join(" · ") });
    if (p.revert && p.revert.status === "pending") attention.push({ sev: 2.3, k: "warn", id: p.id, t: `${c} · đề nghị chuyển về Cơ hội chờ BOD duyệt`, sub: `${p.revert.by}: ${p.revert.reason}` });
    const starJobs = (p.jobs || []).filter((j) => !j.done && j.star && j.due >= today && j.date <= today);
    if (starJobs.length) attention.push({ sev: 2.8, k: "warn", id: p.id, t: `${c} · ★ ${starJobs.length} việc quan trọng hôm nay`, sub: starJobs.slice(0, 2).map((j) => j.text).join(" · ") });
    openNotes(p).filter((n) => n.type !== "note").forEach((n) => attention.push({ sev: 2.5, k: n.type === "block" ? "bad" : "warn", id: p.id, stage: n.stage, t: `${c} · ${NOTE_LABELS[n.type]} (bước ${n.stage} ${stageLabel(n.stage)})`, sub: `${n.text}${n.need ? " · cần " + n.need : ""}` }));
    if (plan && p.planConfirmed === false) attention.push({ sev: 3.5, k: "warn", id: p.id, t: `${c} · Kế hoạch nháp chờ kiểm tra`, sub: "Mở “Kiểm tra & xác nhận kế hoạch”" });
    if (!plan && cur <= PLAN_STAGE_COUNT) attention.push({ sev: 4, k: "none", id: p.id, t: `${c} · Chưa có kế hoạch`, sub: "Tạo nhanh với 2 thông tin" });
  });
  attention.sort((a, b) => a.sev - b.sev);

  const onSelect = (id) => { setSelId(id); if (reviewId && reviewId !== id) setReviewId(null); };

  return (
    <div className="tl-board">
      <div className="tl-modebar">
        <div className="tl-seg">
          <button className={mode === "gantt" ? "on" : ""} onClick={() => setMode("gantt")}>Lịch triển khai</button>
          <button className={mode === "site" ? "on" : ""} onClick={() => { setSiteFocus(selRow && selRow.p.status !== "closed" ? selRow.p.id : null); setMode("site"); }}>Tiến độ thi công{lateSiteTotal > 0 ? ` · ${lateSiteTotal} trễ` : ""}</button>
          <button className={mode === "jobs" ? "on" : ""} onClick={() => { setJobsFocus(null); setMode("jobs"); }}>Việc hằng ngày{lateJobsTotal > 0 ? ` · ${lateJobsTotal} trễ` : ""}</button>
        </div>
      </div>
      {mode === "site" ? (
        <SiteSchedule key={siteFocus || "all"} projects={projects} updateProject={updateProject} focusPid={siteFocus} currentRole={currentRole}
          onOpenPlan={(pid) => { setSelId(pid); setReviewId(pid); setMode("gantt"); }} />
      ) : mode === "jobs" ? (
        <JobsBoard key={jobsFocus || "all"} projects={projects} updateProject={updateProject} focusPid={jobsFocus} currentRole={currentRole}
          onOpenProject={(pid) => { setSelId(pid); setMode("gantt"); }} />
      ) : (
      <>
      <div className="tl-kpis">
        <div className="tl-kpi"><div className="l">Đang triển khai</div><div className="v">{act.length}</div><div className="s">dự án</div></div>
        <div className="tl-kpi"><div className="l">Tổng giá trị HĐ</div><div className="v">{formatCompactVND(totalValue)}</div><div className="s">đang chạy</div></div>
        <div className={`tl-kpi ${nLate ? "bad" : ""}`}><div className="l">Trễ / điểm nghẽn</div><div className="v">{nLate}</div><div className="s">{nWarn} dự án sắp hạn</div></div>
        <div className={`tl-kpi ${nBlock + nHelp ? "warn" : ""}`}><div className="l">Tắc nghẽn / cần hỗ trợ</div><div className="v">{nBlock + nHelp}</div><div className="s">{nBlock} tắc nghẽn · {nHelp} cần hỗ trợ</div></div>
        <div className={`tl-kpi ${tasksOver ? "bad" : ""}`}><div className="l">Việc quá hạn</div><div className="v">{tasksOver}</div><div className="s">từ Nhiệm vụ & Deadline</div></div>
        <div className="tl-kpi"><div className="l">Thu trong 30 ngày</div><div className="v">{formatCompactVND(in30)}</div><div className="s">{over ? `quá hạn thu ${formatCompactVND(over)}` : "không có khoản quá hạn"}</div></div>
        <div className={`tl-kpi ${noPlan.length ? "warn" : ""}`}><div className="l">Chưa có kế hoạch</div><div className="v">{noPlan.length}</div><div className="s">cần tạo nhanh</div></div>
      </div>

      {noPlan.length > 0 && view !== "archived" && (
        <div className="tl-banner">
          <div><b>{noPlan.length} dự án chưa có kế hoạch</b> ({noPlan.map((r) => r.p.code.slice(5)).join(", ")}). Hệ thống tự đề xuất từ ngày bắt đầu + giá trị HĐ — bạn kiểm tra và chỉnh sau.</div>
          <div className="tl-sp" /><button className="btn btn-primary btn-sm" onClick={doBulk}>Tự đề xuất cho tất cả</button>
        </div>
      )}
      {drafts.length > 0 && view !== "archived" && (
        <div className="tl-banner">
          <div><b>{drafts.length} kế hoạch nháp chờ bạn kiểm tra</b> ({drafts.map((r) => r.p.code.slice(5)).join(", ")}). Mở từng cái để chỉnh hạn từng bước rồi xác nhận.</div>
          <div className="tl-sp" /><button className="btn btn-primary btn-sm" onClick={() => { setSelId(drafts[0].p.id); setReviewId(drafts[0].p.id); }}>Kiểm tra {drafts[0].p.code.slice(5)}</button>
        </div>
      )}

      <div className="tl-toolbar">
        <div className="filter-tabs" style={{ margin: 0 }}>
          {[["active", `Đang triển khai (${activeRows.length})`], ["archived", `Đã lưu trữ (${archivedRows.length})`], ["all", "Tất cả"]].map(([k, l]) => (
            <button key={k} className={`chip ${view === k ? "chip-active" : ""}`} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        <label>Sắp xếp
          <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="risk">Rủi ro cao trước</option><option value="end">Ngày kết thúc</option><option value="prio">Ưu tiên</option><option value="value">Giá trị HĐ</option>
          </select>
        </label>
        <div className="tl-seg">
          {[["week", "Tuần"], ["month", "Tháng"], ["quarter", "Quý"]].map(([k, l]) => <button key={k} className={zoom === k ? "on" : ""} onClick={() => setZoom(k)}>{l}</button>)}
        </div>
        <div className="tl-lay">
          {[["ms", "◆ Đợt thu"], ["bn", "⚑ Điểm nghẽn"], ["tk", "● Hạn nhiệm vụ"], ["nt", "Ⓘ Ghi chú"]].map(([k, l]) => (
            <label key={k}><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />{l}</label>
          ))}
        </div>
        {(() => {
          const withItems = activeRows.filter((r) => schedItems(r.p).length);
          if (!withItems.length) return null;
          const all = withItems.every((r) => expanded[r.p.id]);
          return <button className="btn btn-outline btn-sm" onClick={() => setExpanded(all ? {} : Object.fromEntries(withItems.map((r) => [r.p.id, true])))}>{all ? "▾ Ẩn chi tiết thi công" : "▸ Mở chi tiết thi công"}</button>;
        })()}
        <div className="tl-sp" /><button className="btn btn-outline btn-sm" onClick={scrollToToday}>Về hôm nay</button>
      </div>

      <div className="tl-main">
        <div className="tl-col">
          {reviewRow && reviewRow.plan && reviewRow.p.status !== "closed" && (
            <ReviewPanel p={reviewRow.p} plan={reviewRow.plan} cascade={cascade} setCascade={setCascade} reviewRef={reviewRef}
              onEditEnd={(i, nd) => {
                const np = applyStageEnd(reviewRow.plan, i, nd, cascade);
                if (np !== reviewRow.plan) commit(reviewRow.p, planToPatch(reviewRow.p, np, reviewRow.p.planConfirmed !== false), `Đã đổi hạn bước ${i + 1} “${stageLabel(i + 1)}” → ${fd(np.ends[i])}${cascade && i < PLAN_STAGE_COUNT - 1 ? "; các bước sau dời theo" : ""}`);
              }}
              onSetSkip={(i, skip, days) => {
                const rp = reviewRow.p;
                const np = setStageSkip(reviewRow.plan, i, skip, days, cascade);
                const patch = planToPatch(rp, np, rp.planConfirmed !== false, currentRole);
                const nm = `bước ${i + 1} “${stageLabel(i + 1)}”`;
                const moved = patch.currentStage && patch.currentStage !== rp.currentStage ? `; dự án tự chuyển sang bước ${patch.currentStage} “${stageLabel(patch.currentStage)}”` : "";
                commit(rp, patch, skip ? `Đã bỏ qua ${nm} (0 ngày)${moved}` : `Đã bật lại ${nm} — ${Math.max(1, Math.round(days) || 1)} ngày`);
              }}
              onSetStageStart={(i, v) => {
                const rp = reviewRow.p;
                const np = setStageStart(reviewRow.plan, i, v);
                commit(rp, planToPatch(rp, np, rp.planConfirmed !== false, currentRole), v ? `Bước ${i + 1} “${stageLabel(i + 1)}” bắt đầu ${fdy(np.starts[i] || v)} — các bước khác giữ nguyên (chạy song song nếu chồng lên bước trước)` : `Bước ${i + 1} “${stageLabel(i + 1)}” quay về bắt đầu khi bước trước kết thúc`);
              }}
              onOpenSite={() => { setSiteFocus(reviewRow.p.id); setMode("site"); }}
              onSetStart={(v) => {
                const rp = reviewRow.p;
                const np = setPlanStart(reviewRow.plan, v, cascade);
                commit(rp, planToPatch(rp, np, rp.planConfirmed !== false, currentRole), `Đã đặt ngày bắt đầu ${fdy(np.start)}${cascade ? "; hạn các bước dời theo" : ""}`);
              }}
              onConfirm={() => { if (reviewRow.p.planConfirmed === false) commit(reviewRow.p, { planConfirmed: true }, `Đã xác nhận kế hoạch ${reviewRow.p.code}`); setReviewId(null); }}
              onClose={() => setReviewId(null)}
              onReplan={() => doClearPlan(reviewRow.p)} />
          )}

          {showG && (
            <div className="tl-panel">
              <div className="tl-panel-h"><h3>Lịch triển khai chung</h3><span className="sub">{activeRows.length} dự án · kéo vạch đen cuối mỗi giai đoạn để dời mốc · <b>nhấp đúp tên dự án</b> để mở Tiến độ thi công · bấm ▸ để xem từng hạng mục</span></div>
              <GanttChart rows={drawRows} meta={meta} zoom={zoom} layers={layers} selId={selRow?.p.id} onSelect={onSelect} onHandleDown={onHandleDown}
                today={today} tasksByCode={tasksByCode} scrollRef={scrollRef}
                expanded={expanded} onToggleExp={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))} onOpenSite={openSite} onToggleItem={toggleSiteItem} />
              <div className="tl-legend">
                <span><i className="tl-sw" style={{ background: "var(--green)" }} />Giai đoạn đã xong</span>
                <span><i className="tl-sw" style={{ background: "var(--blue)" }} />Đang làm (đã chạy)</span>
                <span><i className="tl-sw" style={{ background: "repeating-linear-gradient(135deg,var(--red) 0 3px,#D9786A 3px 6px)" }} />Quá hạn</span>
                <span><i className="tl-sw" style={{ border: "1px dashed var(--red)", background: "var(--red-soft)" }} />Dự báo trễ</span>
                <span><i className="tl-sw" style={{ border: "1px dashed var(--line-dark)" }} />Chưa tới</span>
                <span style={{ color: "var(--green)" }}>◆ đã thu</span><span style={{ color: "var(--amber)" }}>◆ sắp thu</span><span style={{ color: "var(--red)" }}>◆ quá hạn</span>
                <span><i className="tl-nm note">i</i>lưu ý</span><span><i className="tl-nm block">!</i>tắc nghẽn</span><span><i className="tl-nm help">+</i>cần hỗ trợ</span>
              </div>
            </div>
          )}

          {view !== "active" && (
            <div className="tl-panel">
              <div className="tl-panel-h"><h3>Dự án đã lưu trữ</h3><span className="sub">còn công nợ vẫn theo dõi ở “Thu hồi công nợ”</span></div>
              {archivedRows.length === 0 ? <div className="tl-panel-b tl-note">Chưa có dự án nào được lưu trữ.</div> : (
                <div className="tl-tbl-wrap">
                  <table className="tl-arch">
                    <thead><tr><th>Dự án</th><th>Khách hàng</th><th>Giá trị HĐ</th><th>Còn nợ</th><th></th></tr></thead>
                    <tbody>
                      {archivedRows.map(({ p }) => {
                        const ar = Math.max(0, projectAR(p));
                        return (
                          <tr key={p.id}>
                            <td><b>{p.code}</b><br />{p.name}</td><td>{p.customerName}</td>
                            <td className="tl-num">{formatCompactVND(p.contractValue || 0)}</td>
                            <td className="tl-num" style={{ color: ar > 0 ? "var(--red)" : "var(--green)" }}>{formatCompactVND(ar)}</td>
                            <td>{isBOD ? <button className="btn btn-outline btn-sm" onClick={() => { archiveProject(p.id); showToast(`Đã khôi phục ${p.code}`); }}>Khôi phục</button> : <span className="tl-note">chỉ BOD</span>}
                              {" "}<button className="btn btn-ghost btn-sm" onClick={() => goToProject(p.code)}>Mở</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="tl-panel">
            <div className="tl-panel-h"><h3>Cần xử lý hôm nay</h3><span className="sub">tự tổng hợp từ lịch, nhiệm vụ, thu tiền, ghi chú</span></div>
            <div>
              {attention.map((a, i) => {
                const key = `${a.id}:${i}`;
                const pr = projects.find((x) => x.id === a.id);
                const open = openAtt === key;
                const oj = pr ? (pr.jobs || []).filter((j) => !j.done) : [];
                const mine = a.stage ? oj.filter((j) => j.stage === a.stage) : [];
                const list = (mine.length ? mine : oj).slice(0, 6);
                const ops = pr ? jobOps(pr, updateProject, today) : null;
                return (
                  <React.Fragment key={key}>
                    <div className="tl-att-i" onClick={() => onSelect(a.id)}>
                      <span className={`ic ${a.k}`}>{a.k === "bad" ? "✕" : a.k === "warn" ? "▲" : "○"}</span>
                      <div className="t">{a.t}<small>{a.sub}</small></div>
                      {pr && <button className={`tl-att-add ${open ? "on" : ""}`} title="Thêm / xem công tác cụ thể cho việc này"
                        onClick={(e) => { e.stopPropagation(); setOpenAtt(open ? null : key); }}>＋ Công tác{oj.length ? ` (${oj.length})` : ""}</button>}
                    </div>
                    {open && pr && (
                      <div className="tl-att-jobs">
                        <div className="tl-note" style={{ marginBottom: 4 }}>{pr.code.slice(5)} · công tác cụ thể{a.stage ? ` (gắn với bước ${a.stage} “${stageLabel(a.stage)}”)` : ""}</div>
                        {list.length === 0 && <div className="tl-note">Chưa có công tác nào đang mở.</div>}
                        {list.map((j) => <JobRow key={j.id} j={j} day={today} onToggle={ops.toggle} onStar={ops.star} onDel={ops.del} />)}
                        {oj.length > list.length && <div className="tl-note">… còn {oj.length - list.length} việc khác ở mục “Việc hằng ngày”</div>}
                        <QuickAdd placeholder="+ Thêm công tác (Enter) — có thể gõ ngày: “giao sàn 15.10”" onAdd={(txt) => ops.add(txt, today, a.stage)} />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
              {attention.length === 0 && <div className="tl-panel-b tl-note">Không có việc cần xử lý.</div>}
            </div>
          </div>
        </div>

        <div className="tl-panel tl-det">
          {!sel ? <div className="tl-panel-b tl-note">Chọn một dự án trên lịch để xem chi tiết.</div> : (() => {
            const { p, plan, st } = selRow;
            const myTasks = tasksByCode[p.code] || [];
            const archived = p.status === "closed";
            return (
              <>
                <div className="tl-sec">
                  <div className="tl-row2" style={{ justifyContent: "space-between" }}><b style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 15 }}>{p.code}</b><StatusPill st={st} /></div>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div className="tl-note">
                    {p.customerName} · HĐ {formatCompactVND(p.contractValue || 0)} · Ưu tiên{" "}
                    <span style={{ cursor: isBOD ? "pointer" : "default" }} title={isBOD ? "Bấm để đổi mức ưu tiên" : "Chỉ BOD đổi mức ưu tiên"}
                      onClick={() => isBOD && updateProject(p.id, { priority: PRIO_NEXT[p.priority || "normal"] })}><Dots priority={p.priority} /></span>
                  </div>
                  <div className="tl-row2" style={{ marginTop: 6 }}><button className="btn btn-ghost btn-sm" onClick={() => goToProject(p.code)}>Mở trang Dự án (Stage-Gate, chi phí, doanh thu) →</button></div>
                </div>

                {archived ? (
                  <div className="tl-sec">
                    <div className="tl-kv"><span>Công nợ còn lại</span><b className="tl-num">{formatCompactVND(Math.max(0, projectAR(p)))}</b></div>
                    {isBOD && <div className="tl-row2" style={{ marginTop: 8 }}><button className="btn btn-outline btn-sm" onClick={() => { archiveProject(p.id); showToast(`Đã khôi phục ${p.code}`); }}>Khôi phục dự án</button></div>}
                  </div>
                ) : (
                  <>
                    {!plan && p.currentStage <= PLAN_STAGE_COUNT && (
                      <>
                        <div className="tl-sec"><div className="tl-warnbox" style={{ margin: 0 }}>Dự án đang ở bước {p.currentStage} nhưng chưa có kế hoạch nên chưa theo dõi được trễ/đúng hạn.</div></div>
                        <PlanSetup key={p.id} p={p} today={today} onCreate={(plan2) => doCreatePlan(p, plan2)} />
                      </>
                    )}
                    {plan && (
                      <div className="tl-sec">
                        <h4>Kế hoạch</h4>
                        <div className="tl-kv"><span>Bắt đầu → kết thúc</span><b className="tl-num">{fd(plan.start)} → {fdy(plan.end)}</b></div>
                        {st.k === "bad" && st.late > 0 && <div className="tl-kv"><span>Dự báo hoàn thành</span><b className="tl-num" style={{ color: "var(--red)" }}>{fdy(st.forecastEnd)} (+{st.late}n)</b></div>}
                        {diffDays(plan.baseEnd, plan.end) !== 0 && <div className="tl-kv"><span>So với kế hoạch ban đầu</span><b className="tl-num" style={{ color: diffDays(plan.baseEnd, plan.end) > 0 ? "var(--red)" : "var(--green)" }}>{diffDays(plan.baseEnd, plan.end) > 0 ? "+" : ""}{diffDays(plan.baseEnd, plan.end)} ngày</b></div>}
                        <div className="tl-kv"><span>Tiến độ theo tỷ trọng</span><b className="tl-num">{planProgressPct(p, today)}%</b></div>
                        {st.k === "bad" && st.late > 0 && p.currentStage <= PLAN_STAGE_COUNT && (
                          <div className="tl-warnbox">
                            <b>Bước hiện tại quá hạn {st.late} ngày.</b>
                            <div className="tl-note" style={{ color: "var(--ink-soft)" }}>Chấp nhận trễ? Một bấm để dời hạn bước này sang {fd(addDaysISO(today, 7))} và dời toàn bộ các bước sau theo; mức trễ vẫn được lưu so với kế hoạch ban đầu.</div>
                            <div className="tl-row2" style={{ marginTop: 6 }}>
                              <button className="btn btn-primary btn-sm" onClick={() => doShift(p, plan, st.late + 7, `Đã dời kế hoạch +${st.late + 7} ngày — hạn bước ${p.currentStage} là ${fd(addDaysISO(today, 7))}`)}>Dời kế hoạch +{st.late + 7} ngày</button>
                            </div>
                          </div>
                        )}
                        {p.planConfirmed === false
                          ? <div className="tl-warnbox"><b>Kế hoạch nháp</b> — hệ thống mới đề xuất, cần bạn kiểm tra rồi xác nhận.</div>
                          : <div className="tl-note" style={{ marginTop: 6 }}>✓ Kế hoạch đã được xác nhận</div>}
                        <div className="tl-row2" style={{ marginTop: 8 }}>
                          <button className={`btn btn-sm ${p.planConfirmed === false ? "btn-primary" : "btn-outline"}`} onClick={() => setReviewId(p.id)}>{p.planConfirmed === false ? "Kiểm tra & xác nhận kế hoạch" : "Kiểm tra / chỉnh kế hoạch"}</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => doClearPlan(p)}>Lập lại…</button>
                        </div>
                      </div>
                    )}
                    <CurrentStepCard p={p} plan={plan} st={st} currentRole={currentRole} isBOD={isBOD}
                      onShift={(d) => doShift(p, plan, d, `Đã dời hạn bước ${p.currentStage} ${d > 0 ? "+" : ""}${d} ngày`)}
                      onToggleGate={(stageId, i) => toggleProjectGate(p.id, stageId, i)}
                      onAdvance={() => advanceProject(p.id)} />
                    {!archived && (() => {
                      const its = schedItems(p), lt = its.filter((i) => schedIsLate(i, today)).length;
                      return (
                        <div className="tl-sec">
                          <h4>Tiến độ thi công <span className="tl-src">{its.length ? `${its.length} hạng mục · ${schedPct(its)}%${lt ? ` · ${lt} trễ` : ""}` : "chưa có bảng"}</span></h4>
                          {its.length > 0 && <div className="tl-prog"><i style={{ width: `${schedPct(its)}%` }} /></div>}
                          <div className="tl-note" style={{ margin: "4px 0 6px" }}>{its.length ? "Các bước Duyệt mẫu / Manufacturing / Construction / QC / Bàn giao lấy ngày & % từ bảng này." : "Nhập hạng mục thi công chi tiết (dán từ Excel hoặc mẫu nhanh) để theo dõi từng việc và nối với kế hoạch 12 bước."}</div>
                          <button className="btn btn-outline btn-sm" onClick={() => { setSiteFocus(p.id); setMode("site"); }}>{its.length ? "Mở bảng tiến độ thi công →" : "Lập bảng tiến độ thi công →"}</button>
                        </div>
                      );
                    })()}
                    <ProjectJobs key={"j" + p.id} p={p} today={today} updateProject={updateProject}
                      onOpenAll={() => { setJobsFocus(p.id); setMode("jobs"); }} />
                    <NotesSection key={p.id} p={p} currentRole={currentRole}
                      onAdd={(data) => addNote(p, data)} onToggle={(id) => toggleNote(p, id)} onRemove={(id) => removeNote(p, id)} />
                    {plan && (
                      <div className="tl-sec">
                        <h4>12 bước</h4>
                        <div className="tl-stl">
                          {PROJECT_STAGES.slice(0, PLAN_STAGE_COUNT).map((s, i) => {
                            const c = s.id < p.currentStage ? "done" : s.id === p.currentStage ? "cur" : "fut";
                            return (
                              <React.Fragment key={s.id}>
                                <span className={c}>{c === "done" ? "✓" : c === "cur" ? "▶" : "○"}</span>
                                <span className={c}>{s.id}. {s.label}</span>
                                <span className="d">{plan.skips && plan.skips[i] ? "bỏ qua" : <>{stepIsOwnStart(plan, i) && c !== "done" ? `${fd(stepStart(plan, i))} → ` : ""}{c === "done" ? "xong " : "hạn "}{fd(plan.ends[i])}</>}</span>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
                <OtherPages p={p} tasks={myTasks} today={today} />
                {!archived && <ArchiveSection key={"a" + p.id} p={p} isBOD={isBOD} openTasksCount={myTasks.length}
                  onArchive={() => { archiveProject(p.id); showToast(`Đã lưu trữ ${p.code}${projectAR(p) > 0 ? " — còn nợ chuyển sang Thu hồi công nợ" : ""}`); }} />}
              </>
            );
          })()}
        </div>
      </div>

      </>
      )}

      {doneDlg && (() => {
        const dp = projects.find((x) => x.id === doneDlg.pid), di = dp && schedItems(dp).find((x) => x.id === doneDlg.id);
        return di ? <DoneDialog item={di} today={today} role={currentRole} onClose={() => setDoneDlg(null)}
          onConfirm={({ date, reason }) => { setDoneDlg(null); applyDone(dp, di.id, true, { date, reason, role: currentRole, by: currentRole }); }} /> : null;
      })()}
      {toast && (
        <div className="tl-toast"><span>{toast.msg}</span>{toast.act && <button className="ss-act" onClick={() => { const f = toast.act.fn; setToast(null); f(); }}>{toast.act.label}</button>}{toast.undo && <button onClick={toast.undo}>Hoàn tác</button>}</div>
      )}
      {dragRow && <div className="tl-dragtip" style={{ left: dragRow.x + 14, top: dragRow.y - 34 }}>{dragRow.label}</div>}
    </div>
  );
}
