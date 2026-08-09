import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard, Target, FolderKanban, Users, ListChecks, ShieldCheck, TrendingUp,
  GitBranch, Plus, X, Check, ChevronRight, ChevronDown, ChevronLeft, AlertTriangle,
  Trash2, Building2, User, Calendar, RotateCcw, PhoneCall, Award, Search, CircleCheck,
  Circle, Clock, DollarSign, Save, PenLine, UserPlus, Link2, Flag, Wallet, Download,
} from "lucide-react";
import { storage } from "./lib/storage";
import { exportMonthlyReport } from "./lib/report";
import {
  todayISO, ROLES, ROLE_LABELS, MONTHS, uid, formatVND, formatCompactVND, addMonths,
  nextProjectCode, canAdvanceGate, toggleGateCheck, advanceGateStage, sendBackGate,
  hasOpenBottleneck, resolveLastBottleneck,
  OPP_STAGES, OPP_DECISION_STAGE_ID, makeOpportunity,
  PROJECT_STAGES, PROJECT_FINAL_STAGE_ID, PROJECT_WARRANTY_STAGE_ID, PROJECT_ACCEPTANCE_STAGE_ID, makeProject,
  projectCollected, projectAR, projectStagePct, projectRiskLevel, makeRevenueEvent, makeCost,
  makeTask, isTaskOverdue, makeWarrantyRecord, makeEmployee, employeeSummary,
  seedCustomers, seedOpportunities, seedProjects, seedWarrantyRecords, seedTasks, seedForecast, seedEmployees,
} from "./data/seed";
// TODAY = ngày neo cho dữ liệu MẪU (chỉ dùng khi hiển thị/seed). Mọi hành
// động thật của người dùng (qua bước, báo điểm nghẽn, tạo mới, ghi nhận...)
// phải dùng todayISO() để lấy đúng ngày thực tế trên máy — xem seed.js.

/* ---------------------------------------------------------------------- */
/*  SMALL UI PRIMITIVES                                                     */
/* ---------------------------------------------------------------------- */

const formatNumberPlain = (n) => {
  if (n === null || n === undefined || isNaN(n) || n === "") return "";
  return Math.round(n).toLocaleString("vi-VN");
};

function NumberInput({ value, onChange, className = "", placeholder }) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(formatNumberPlain(value));
  useEffect(() => { if (!focused) setText(formatNumberPlain(value)); }, [value, focused]);
  return (
    <input
      className={className}
      inputMode="numeric"
      placeholder={placeholder}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, "");
        setText(digits === "" ? "" : formatNumberPlain(Number(digits)));
        onChange(digits === "" ? 0 : Number(digits));
      }}
      onBlur={() => { setFocused(false); setText(formatNumberPlain(value)); }}
    />
  );
}

function KPICard({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`kpi-card tone-${tone}`}>
      <div className="kpi-icon"><Icon size={18} strokeWidth={2} /></div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}
function ProgressBar({ pct, tone = "blue" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="pbar-track">
      <div className={`pbar-fill fill-${tone}`} style={{ width: clamped + "%" }} />
    </div>
  );
}
function TierBadge({ tier }) {
  return <span className={`tier-badge tier-${tier}`}>{tier === "high" ? "Tiềm năng Cao" : "Tiềm năng Bình thường"}</span>;
}
function StatusPill({ status, map }) {
  return <span className={`status-pill status-${status}`}>{map[status] || status}</span>;
}
function RiskBadge({ level }) {
  if (!level || level === "none") return null;
  return (
    <span className={`risk-badge risk-${level}`}>
      {level === "red" ? <><AlertTriangle size={11} /> Có điểm nghẽn</> : <><CircleCheck size={11} /> Bình thường</>}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/*  STAGE-GATE STEPPER — dùng chung cho Opportunity & Project               */
/* ---------------------------------------------------------------------- */

function GateChecklist({ stageDef, stageState, canEdit, onToggle }) {
  if (!stageDef.gate.length) {
    return <div className="empty-note" style={{ padding: "2px 0 8px" }}>Bước này không có điều kiện bắt buộc.</div>;
  }
  return (
    <div className="gate-checklist">
      {stageDef.gate.map((g, idx) => (
        <label key={idx} className={`gate-check-item ${stageState.gateChecked[idx] ? "gate-check-done" : ""}`}>
          <input type="checkbox" checked={stageState.gateChecked[idx]} disabled={!canEdit} onChange={() => onToggle(idx)} />
          <span>{g}</span>
        </label>
      ))}
    </div>
  );
}

function BottleneckLog({ bottlenecks, stageDefs }) {
  if (!bottlenecks || !bottlenecks.length) return null;
  return (
    <div className="bn-log panel-sub panel">
      <div className="attach-head-label" style={{ marginBottom: 8 }}><AlertTriangle size={12} /> Lịch sử điểm nghẽn</div>
      {bottlenecks.slice().reverse().map((b) => {
        const stg = stageDefs.find((s) => s.id === b.stageId);
        return (
          <div className={`bn-log-item ${!b.resolvedAt ? "bn-log-open" : ""}`} key={b.id}>
            <div className="bn-log-head">
              <span className="bn-log-stage">Bước {b.stageId} — {stg?.label}</span>
              <span className={b.resolvedAt ? "bn-log-resolved" : "bn-log-open-tag"}>{b.resolvedAt ? `Đã xử lý ${b.resolvedAt}` : "Đang mở"}</span>
            </div>
            <div className="bn-log-reason">{b.reason}</div>
            <div className="dim bn-log-meta">Báo bởi {b.by} · {b.at}</div>
          </div>
        );
      })}
    </div>
  );
}

function SendBackForm({ onSubmit, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div className="reject-form">
      <textarea className="input" rows={2} placeholder="Lý do điểm nghẽn / vấn đề phát sinh cần xử lý lại ở bước trước..."
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="form-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button>
        <button className="btn btn-outline btn-sm" onClick={() => reason.trim() && onSubmit(reason.trim())}>
          <RotateCcw size={13} /> Xác nhận trả về bước trước
        </button>
      </div>
    </div>
  );
}

function StageGateStepper({ stageDefs, flow, currentRole, onToggleGate, onAdvance, onSendBack, renderFinalActions }) {
  const [showSendBack, setShowSendBack] = useState(false);
  const finalId = stageDefs[stageDefs.length - 1].id;

  return (
    <div className="stepper">
      {stageDefs.map((s) => {
        const stage = flow.stages[s.id];
        const isDone = stage.state === "done";
        const isCurrent = flow.currentStage === s.id && !isDone;
        const canAct = currentRole === s.who || currentRole === "BOD";
        const canAdvanceNow = isCurrent && canAdvanceGate(s, stage);
        const isFinal = s.id === finalId;

        return (
          <div className={`step ${isDone ? "step-done" : isCurrent ? "step-current" : "step-future"}`} key={s.id}>
            <div className="step-marker">
              {isDone ? <CircleCheck size={20} /> : <Circle size={20} />}
              {!isFinal && <div className="step-connector" />}
            </div>
            <div className="step-content">
              <div className="step-head">
                <span className="step-num">Bước {s.id}</span>
                <span className="step-who">{ROLE_LABELS[s.who]}</span>
              </div>
              <div className="step-title">{s.label}</div>

              {isDone && stage.completedAt && (
                <div className="step-meta">Hoàn thành {stage.completedAt} bởi {stage.completedBy}</div>
              )}

              {isCurrent && !isFinal && (
                <>
                  <GateChecklist stageDef={s} stageState={stage} canEdit={canAct} onToggle={(idx) => onToggleGate(s.id, idx)} />
                  {canAct ? (
                    <div className="decision-row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-primary btn-sm" disabled={!canAdvanceNow} onClick={onAdvance}>
                        <Check size={14} /> Qua bước tiếp theo
                      </button>
                      {s.id > 1 && !showSendBack && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowSendBack(true)}>
                          <AlertTriangle size={13} /> Báo điểm nghẽn — trả về bước trước
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="perm-note">Chỉ {ROLE_LABELS[s.who]} hoặc BOD được thực hiện bước này. (Vai trò hiện tại: {ROLE_LABELS[currentRole]})</div>
                  )}
                  {showSendBack && (
                    <SendBackForm onCancel={() => setShowSendBack(false)} onSubmit={(reason) => { onSendBack(reason); setShowSendBack(false); }} />
                  )}
                </>
              )}

              {isCurrent && isFinal && renderFinalActions && renderFinalActions({ canAct, stage, stageDef: s })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  XUẤT BÁO CÁO EXCEL (.xlsx) — theo tháng/quý/toàn bộ                     */
/* ---------------------------------------------------------------------- */

function ExportReportPanel({ employees, customers, opportunities, projects, tasks, warrantyRecords }) {
  const now = new Date();
  const [periodType, setPeriodType] = useState("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const doExport = async () => {
    const period = periodType === "all" ? { type: "all" } : periodType === "month" ? { type: "month", year, month } : { type: "quarter", year, quarter };
    setExporting(true); setError("");
    try {
      await exportMonthlyReport(period, { employees, customers, opportunities, projects, tasks, warrantyRecords });
    } catch (e) {
      setError("Không xuất được file Excel — vui lòng thử lại.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-title">Xuất báo cáo Excel</h3>
      <p className="pane-sub" style={{ marginBottom: 10 }}>
        Xuất toàn bộ dữ liệu (doanh thu, dự án, cơ hội, khách hàng, nhân viên, task, bảo hành) ra 1 file .xlsx nhiều sheet để làm báo cáo tháng/quý.
      </p>
      <div className="revenue-event-form">
        <select className="input input-sm" style={{ maxWidth: 130 }} value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
          <option value="month">Theo tháng</option>
          <option value="quarter">Theo quý</option>
          <option value="all">Toàn bộ (lũy kế)</option>
        </select>
        {periodType === "month" && (
          <select className="input input-sm" style={{ maxWidth: 100 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        )}
        {periodType === "quarter" && (
          <select className="input input-sm" style={{ maxWidth: 100 }} value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Quý {q}</option>)}
          </select>
        )}
        {periodType !== "all" && (
          <input type="number" className="input input-sm" style={{ maxWidth: 90 }} value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} />
        )}
        <button className="btn btn-primary btn-sm" onClick={doExport} disabled={exporting}>
          <Download size={13} /> {exporting ? "Đang xuất..." : "Xuất file Excel"}
        </button>
      </div>
      {error && <div className="figure-debt" style={{ fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  MASTER DASHBOARD                                                       */
/* ---------------------------------------------------------------------- */

function DashboardTab({ employees, customers, opportunities, projects, tasks, warrantyRecords, goToProject, goToOpportunity, goToEmployees }) {
  const openOpps = opportunities.filter((o) => o.status === "open");
  const wonOpps = opportunities.filter((o) => o.status === "won");
  const lostOpps = opportunities.filter((o) => o.status === "lost");
  const pipelineValue = openOpps.reduce((s, o) => s + o.value, 0);
  const winRate = (wonOpps.length + lostOpps.length) ? (wonOpps.length / (wonOpps.length + lostOpps.length)) * 100 : 0;

  const activeProjects = projects.filter((p) => p.status === "active");
  const contractValue = projects.reduce((s, p) => s + p.contractValue, 0);
  const cashCollected = projects.reduce((s, p) => s + projectCollected(p), 0);
  const recognizedRevenue = projects.filter((p) => p.currentStage >= PROJECT_ACCEPTANCE_STAGE_ID).reduce((s, p) => s + p.contractValue, 0);
  const ar = projects.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);
  const projectsAtRisk = projects.filter((p) => projectRiskLevel(p) === "red");
  const overdueTasks = tasks.filter(isTaskOverdue);

  const totalBudget = projects.reduce((s, p) => s + (p.costs || []).reduce((cs, c) => cs + c.budget, 0), 0);
  const totalActualCost = projects.reduce((s, p) => s + (p.costs || []).reduce((cs, c) => cs + c.actual, 0), 0);
  const grossProfit = contractValue - totalActualCost;

  const newLeads30d = openOpps.filter((o) => o.createdAt >= addMonths(todayISO(), -1)).length;
  const topOpps = openOpps.slice().sort((a, b) => b.value - a.value).slice(0, 4);
  const nearDecision = openOpps.filter((o) => o.currentStage >= OPP_STAGES.length - 1);

  const closedNoWarrantyAR = projects.filter((p) => p.status === "closed" && projectAR(p) > 0);
  const activeWarranty = warrantyRecords.filter((r) => r.status === "active");
  const pendingAcceptance = projects.filter((p) => p.currentStage === PROJECT_ACCEPTANCE_STAGE_ID && p.status === "active");

  const topEmployees = employeeSummary(employees, customers, opportunities, projects).sort((a, b) => b.collected - a.collected).slice(0, 5);

  const attentionRows = [];
  overdueTasks.forEach((t) => attentionRows.push({
    id: t.id, what: t.title, project: t.projectCode || "—", who: t.assignee || "—",
    deadline: t.dueDate, bottleneck: "Task quá hạn deadline", action: t.note || "Xử lý ngay và cập nhật trạng thái.",
  }));
  projects.forEach((p) => {
    const bn = (p.bottlenecks || []).find((b) => !b.resolvedAt);
    if (bn) {
      const stg = PROJECT_STAGES.find((s) => s.id === bn.stageId);
      attentionRows.push({
        id: bn.id, what: "Điểm nghẽn dự án", project: `${p.code} · ${p.name}`, who: bn.by,
        deadline: "—", bottleneck: `Bước ${bn.stageId} (${stg?.label}): ${bn.reason}`, action: "Xử lý lại bước trước rồi xác nhận qua bước.",
        onClick: () => goToProject(p.code),
      });
    }
  });
  opportunities.forEach((o) => {
    const bn = (o.bottlenecks || []).find((b) => !b.resolvedAt);
    if (bn) {
      const stg = OPP_STAGES.find((s) => s.id === bn.stageId);
      attentionRows.push({
        id: bn.id, what: "Điểm nghẽn cơ hội", project: o.title, who: bn.by,
        deadline: "—", bottleneck: `Bước ${bn.stageId} (${stg?.label}): ${bn.reason}`, action: "Xử lý lại bước trước rồi xác nhận qua bước.",
        onClick: () => goToOpportunity(o.id),
      });
    }
  });

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div>
          <h1>Master Dashboard</h1>
          <p className="pane-sub">Toàn cảnh doanh nghiệp trong 10–15 giây: Pipeline → Hợp đồng → Doanh thu → Dòng tiền → Rủi ro.</p>
        </div>
      </div>

      <ExportReportPanel employees={employees} customers={customers} opportunities={opportunities} projects={projects} tasks={tasks} warrantyRecords={warrantyRecords} />

      <div className="kpi-row">
        <KPICard icon={Target} tone="blue" label="PIPELINE" value={formatCompactVND(pipelineValue)} sub={`${openOpps.length} cơ hội đang theo đuổi`} />
        <KPICard icon={Building2} tone="blue" label="CONTRACT VALUE" value={formatCompactVND(contractValue)} sub={`${projects.length} dự án đã ký`} />
        <KPICard icon={TrendingUp} tone="green" label="REVENUE" value={formatCompactVND(recognizedRevenue)} sub="Đã qua Nghiệm thu (ghi nhận)" />
        <KPICard icon={Wallet} tone="green" label="CASH COLLECTED" value={formatCompactVND(cashCollected)} sub="Tiền đã thu thực tế" />
        <KPICard icon={Clock} tone="amber" label="A/R (CÔNG NỢ)" value={formatCompactVND(ar)} sub="Còn phải thu" />
        <KPICard icon={FolderKanban} tone="blue" label="ACTIVE PROJECTS" value={activeProjects.length} sub={`${projects.length - activeProjects.length} đã đóng`} />
        <KPICard icon={AlertTriangle} tone="red" label="PROJECT AT RISK" value={projectsAtRisk.length} sub="Đang có điểm nghẽn mở" />
        <KPICard icon={Flag} tone="red" label="OVERDUE TASKS" value={overdueTasks.length} sub="Task quá hạn deadline" />
      </div>

      <div className="zone-grid">
        <div className="panel zone-panel">
          <h3 className="panel-title">BUSINESS</h3>
          <div className="zone-line"><span>Lead mới (30 ngày)</span><strong>{newLeads30d}</strong></div>
          <div className="zone-line"><span>Pipeline đang mở</span><strong>{formatCompactVND(pipelineValue)}</strong></div>
          <div className="zone-line"><span>Win rate</span><strong>{winRate.toFixed(0)}%</strong></div>
          <div className="zone-sub">Cơ hội giá trị cao nhất</div>
          <ul className="zone-list">
            {topOpps.map((o) => (
              <li key={o.id} onClick={() => goToOpportunity(o.id)}>
                <span>{o.title}</span><span className="dim">{formatCompactVND(o.value)}</span>
              </li>
            ))}
            {topOpps.length === 0 && <li className="dim">Không có cơ hội nào đang mở.</li>}
          </ul>
          <div className="zone-sub">Sắp chốt (Đàm phán / WON-LOST) — {nearDecision.length}</div>
        </div>

        <div className="panel zone-panel">
          <h3 className="panel-title">PROJECT</h3>
          {activeProjects.slice(0, 6).map((p) => {
            const pct = projectStagePct(p);
            const stg = PROJECT_STAGES.find((s) => s.id === p.currentStage);
            return (
              <div className="zone-project-row" key={p.id} onClick={() => goToProject(p.code)}>
                <div className="zone-project-top"><span>{p.code} · {p.name}</span><RiskBadge level={projectRiskLevel(p)} /></div>
                <ProgressBar pct={pct} tone={pct >= 80 ? "green" : pct >= 40 ? "amber" : "red"} />
                <div className="dim zone-project-sub">{pct}% · Mốc kế tiếp: {stg?.label}</div>
              </div>
            );
          })}
          {activeProjects.length === 0 && <div className="empty-note">Không có dự án đang triển khai.</div>}
        </div>

        <div className="panel zone-panel">
          <h3 className="panel-title">FINANCE</h3>
          <div className="zone-line"><span>Giá trị hợp đồng</span><strong>{formatCompactVND(contractValue)}</strong></div>
          <div className="zone-line"><span>Ngân sách chi phí</span><strong>{formatCompactVND(totalBudget)}</strong></div>
          <div className="zone-line"><span>Chi phí thực tế</span><strong>{formatCompactVND(totalActualCost)}</strong></div>
          <div className="zone-line"><span>Gross profit dự kiến</span><strong className={grossProfit >= 0 ? "figure-pos" : "figure-debt"}>{formatCompactVND(grossProfit)}</strong></div>
          <div className="zone-line"><span>Phải thu (A/R)</span><strong className="figure-debt">{formatCompactVND(ar)}</strong></div>
        </div>

        <div className="panel zone-panel">
          <h3 className="panel-title">ALERT CENTER</h3>
          <ul className="zone-list zone-list-alert">
            <li><AlertTriangle size={13} /> {projectsAtRisk.length} dự án có điểm nghẽn</li>
            <li><Clock size={13} /> {overdueTasks.length} task quá hạn</li>
            <li><CircleCheck size={13} /> {pendingAcceptance.length} dự án đang chờ Nghiệm thu</li>
            <li><DollarSign size={13} /> {closedNoWarrantyAR.length} dự án đã đóng còn công nợ</li>
            <li><ShieldCheck size={13} /> {activeWarranty.length} hồ sơ bảo hành chưa đóng</li>
          </ul>
        </div>
      </div>

      <div className="panel">
        <div className="pd-payment-head">
          <h3 className="panel-title" style={{ marginBottom: 0 }}>Doanh thu theo Nhân viên phụ trách</h3>
          <button className="btn btn-ghost btn-sm" onClick={goToEmployees}>Xem tất cả <ChevronRight size={13} /></button>
        </div>
        {topEmployees.length === 0 && <div className="empty-note">Chưa có nhân viên nào.</div>}
        {topEmployees.length > 0 && (
          <div className="forecast-table-wrap">
            <table className="forecast-table">
              <thead><tr><th>Nhân viên</th><th>KH phụ trách</th><th>Công trình</th><th>Doanh thu đã thu</th><th>Công nợ (A/R)</th></tr></thead>
              <tbody>
                {topEmployees.map((s) => (
                  <tr key={s.employee.id} className="attention-row-clickable" onClick={goToEmployees}>
                    <td>{s.employee.name} <span className="dim">({s.employee.role})</span></td>
                    <td>{s.customerCount}</td>
                    <td>{s.projectCount}</td>
                    <td className="figure-pos">{formatCompactVND(s.collected)}</td>
                    <td className={s.ar > 0 ? "figure-debt" : ""}>{formatCompactVND(s.ar)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">TODAY NEED ATTENTION</h3>
        {attentionRows.length === 0 && <div className="empty-note">Không có việc nào cần chú ý ngay hôm nay. ✓</div>}
        {attentionRows.length > 0 && (
          <div className="forecast-table-wrap">
            <table className="forecast-table attention-table">
              <thead><tr><th>Việc gì</th><th>Dự án nào</th><th>Ai chịu trách nhiệm</th><th>Deadline</th><th>Đang nghẽn ở đâu</th><th>Hành động tiếp theo</th></tr></thead>
              <tbody>
                {attentionRows.map((r) => (
                  <tr key={r.id} className={r.onClick ? "attention-row-clickable" : ""} onClick={r.onClick}>
                    <td>{r.what}</td><td>{r.project}</td><td>{r.who}</td><td>{r.deadline}</td><td>{r.bottleneck}</td><td>{r.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  OPPORTUNITIES TAB — LEAD → ... → WON / LOST                            */
/* ---------------------------------------------------------------------- */

function NewOpportunityForm({ customers, onCancel, onCreate }) {
  const [title, setTitle] = useState("");
  const [customerChoice, setCustomerChoice] = useState("__new__");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    const isNew = customerChoice === "__new__";
    const cust = !isNew ? customers.find((c) => c.id === customerChoice) : null;
    onCreate({
      title: title.trim(),
      customerId: isNew ? null : customerChoice,
      customerName: isNew ? (newCustomerName.trim() || "Khách hàng mới") : cust.company,
      value: Number(value) || 0, note,
    });
  };

  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Tên cơ hội</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: 5 phòng khám mới" /></div>
        <div className="form-row"><label>Giá trị ước tính (₫)</label><NumberInput className="input" value={value} onChange={setValue} /></div>
        <div className="form-row"><label>Khách hàng</label>
          <select className="input" value={customerChoice} onChange={(e) => setCustomerChoice(e.target.value)}>
            <option value="__new__">-- Khách hàng mới --</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </div>
        {customerChoice === "__new__" && (
          <div className="form-row"><label>Tên khách hàng mới</label><input className="input" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} /></div>
        )}
      </div>
      <div className="form-row"><label>Ghi chú</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="form-actions"><button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button><button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Thêm cơ hội</button></div>
    </div>
  );
}

function OpportunityDetail({ opportunity, currentRole, onToggleGate, onAdvance, onSendBack, onWon, onLost, goToProject }) {
  const [showLostForm, setShowLostForm] = useState(false);
  const [lostReason, setLostReason] = useState("");

  return (
    <div className="project-detail">
      <div className="pd-header">
        <div>
          <div className="pd-client"><Building2 size={13} /> {opportunity.customerName}</div>
          <h2>{opportunity.title}</h2>
        </div>
        <StatusPill status={opportunity.status} map={{ open: "Đang theo đuổi", won: "WON", lost: "LOST" }} />
      </div>

      <div className="pd-payment panel-sub">
        <div className="pd-payment-figures">
          <div><span className="dim">Giá trị ước tính</span><strong>{formatVND(opportunity.value)}</strong></div>
          <div><span className="dim">Ngày tạo</span><strong>{opportunity.createdAt}</strong></div>
        </div>
        {opportunity.note && <div className="pd-scope" style={{ marginTop: 10 }}><p>{opportunity.note}</p></div>}
      </div>

      {opportunity.status === "won" && opportunity.wonProjectCode && (
        <div className="kickoff-box" style={{ marginBottom: 16 }}>
          <ShieldCheck size={14} /><span>Đã WON — dự án <strong>{opportunity.wonProjectCode}</strong> đã được tạo tự động.</span>
          <button className="btn btn-outline btn-sm" onClick={() => goToProject(opportunity.wonProjectCode)}>Xem dự án <ChevronRight size={13} /></button>
        </div>
      )}
      {opportunity.status === "lost" && (
        <div className="cskh-meta" style={{ marginBottom: 16 }}><X size={14} className="figure-debt" /><span className="figure-debt">LOST: {opportunity.lostReason}</span></div>
      )}

      <BottleneckLog bottlenecks={opportunity.bottlenecks} stageDefs={OPP_STAGES} />

      <div className="pd-stages">
        <h4>Sales Stage-Gate</h4>
        <StageGateStepper stageDefs={OPP_STAGES} flow={opportunity} currentRole={currentRole}
          onToggleGate={onToggleGate} onAdvance={onAdvance} onSendBack={onSendBack}
          renderFinalActions={({ canAct }) => canAct ? (
            <div className="decision-box">
              <div className="decision-label">Quyết định cuối cùng của khách hàng:</div>
              <div className="decision-row">
                <button className="btn btn-primary btn-sm" onClick={onWon}><Check size={14} /> WON — Tạo dự án</button>
              </div>
              {!showLostForm ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowLostForm(true)}><X size={14} /> LOST — Ghi nhận lý do</button>
              ) : (
                <div className="reject-form">
                  <textarea className="input" rows={2} placeholder="Lý do LOST..." value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
                  <div className="form-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowLostForm(false)}>Hủy</button>
                    <button className="btn btn-outline btn-sm" onClick={() => { onLost(lostReason || "Không nêu lý do cụ thể."); setShowLostForm(false); }}>Xác nhận LOST</button>
                  </div>
                </div>
              )}
            </div>
          ) : <div className="perm-note">Chỉ BOD được ghi nhận kết quả WON/LOST.</div>} />
      </div>
    </div>
  );
}

function OpportunitiesTab({ opportunities, customers, currentRole, selectedId, setSelectedId, addOpportunity, toggleGate, advanceOpportunity, sendBackOpportunity, markWon, markLost, goToProject }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("open");
  const filtered = opportunities.filter((o) => filter === "all" ? true : o.status === filter);
  const selected = opportunities.find((o) => o.id === selectedId) || filtered[0];
  const totalValue = filtered.reduce((s, o) => s + o.value, 0);

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Cơ hội bán hàng</h1><p className="pane-sub">Sales Stage-Gate: LEAD → Tiếp cận → Xác định nhu cầu → Khảo sát → Concept → Báo giá → Đàm phán → WON/LOST.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm cơ hội</button>
      </div>

      {showForm && <NewOpportunityForm customers={customers} onCancel={() => setShowForm(false)} onCreate={(data) => { addOpportunity(data); setShowForm(false); }} />}

      <div className="split">
        <div className="split-left">
          <div className="filter-tabs">
            {[["open", "Đang theo đuổi"], ["won", "WON"], ["lost", "LOST"], ["all", "Tất cả"]].map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? "chip-active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{filtered.length} cơ hội · {formatCompactVND(totalValue)}</div>
          <div className="project-list">
            {filtered.map((o) => {
              const stg = OPP_STAGES.find((s) => s.id === o.currentStage);
              const flagged = hasOpenBottleneck(o);
              return (
                <div key={o.id} className={`project-card ${selected?.id === o.id ? "project-card-active" : ""}`} onClick={() => setSelectedId(o.id)}>
                  <div className="project-card-top">
                    <span className="project-card-name">{o.title}</span>
                    {flagged && <AlertTriangle size={14} className="flag-icon" />}
                  </div>
                  <div className="project-card-client">{o.customerName}</div>
                  <div className="project-card-stage">Bước {o.currentStage}/{OPP_STAGES.length} · {stg?.label} · {formatCompactVND(o.value)}</div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="empty-note">Không có cơ hội nào.</div>}
          </div>
        </div>
        <div className="split-right">
          {selected ? (
            <OpportunityDetail opportunity={selected} currentRole={currentRole}
              onToggleGate={(stageId, idx) => toggleGate(selected.id, stageId, idx)}
              onAdvance={() => advanceOpportunity(selected.id)}
              onSendBack={(reason) => sendBackOpportunity(selected.id, reason)}
              onWon={() => markWon(selected.id)}
              onLost={(reason) => markLost(selected.id, reason)}
              goToProject={goToProject} />
          ) : <div className="empty-note">Chọn một cơ hội để xem chi tiết.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PROJECTS TAB — Delivery Stage-Gate                                     */
/* ---------------------------------------------------------------------- */

function EditProjectInfoForm({ project, customers, onCancel, onSave }) {
  const [name, setName] = useState(project.name);
  const [customerChoice, setCustomerChoice] = useState(project.customerId || "__custom__");
  const [customCustomerName, setCustomCustomerName] = useState(project.customerName);
  const [scope, setScope] = useState(project.scope);
  const [contractValue, setContractValue] = useState(project.contractValue);

  const submit = () => {
    const isCustom = customerChoice === "__custom__";
    const cust = !isCustom ? customers.find((c) => c.id === customerChoice) : null;
    onSave({
      name: name.trim() || project.name,
      customerId: isCustom ? null : customerChoice,
      customerName: isCustom ? (customCustomerName.trim() || project.customerName) : cust.company,
      scope: scope.trim(), contractValue: Number(contractValue) || 0,
    });
  };

  return (
    <div className="inline-form" style={{ marginBottom: 16 }}>
      <div className="form-row"><label>Tên dự án</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-row"><label>Khách hàng</label>
        <select className="input" value={customerChoice} onChange={(e) => setCustomerChoice(e.target.value)}>
          <option value="__custom__">-- Khách hàng chưa có trong danh mục --</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
        {customerChoice === "__custom__" && (
          <input className="input" style={{ marginTop: 6 }} value={customCustomerName} onChange={(e) => setCustomCustomerName(e.target.value)} placeholder="Tên khách hàng" />
        )}
      </div>
      <div className="form-row"><label>Phạm vi công việc</label><textarea className="input" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} /></div>
      <div className="form-row"><label>Giá trị hợp đồng (₫)</label><NumberInput className="input" value={contractValue} onChange={setContractValue} /></div>
      <div className="form-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button>
        <button className="btn btn-primary btn-sm" onClick={submit}><Save size={14} /> Lưu thông tin</button>
      </div>
    </div>
  );
}

function CostPanel({ project, onAddCost }) {
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [actual, setActual] = useState("");
  const costs = project.costs || [];
  const totalBudget = costs.reduce((s, c) => s + c.budget, 0);
  const totalActual = costs.reduce((s, c) => s + c.actual, 0);

  return (
    <div className="panel-sub panel" style={{ marginTop: 12 }}>
      <div className="pd-payment-head"><h4>Chi phí (ngân sách vs. thực tế)</h4>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowForm((v) => !v)}><Plus size={13} /> Thêm mục chi phí</button>
      </div>
      {costs.length === 0 && <div className="empty-note">Chưa có mục chi phí nào.</div>}
      {costs.length > 0 && (
        <div className="forecast-table-wrap">
          <table className="forecast-table">
            <thead><tr><th>Hạng mục</th><th>Ngân sách</th><th>Thực tế</th><th>Chênh lệch</th></tr></thead>
            <tbody>
              {costs.map((c) => {
                const diff = c.budget - c.actual;
                return <tr key={c.id}><td>{c.category}{c.note && <div className="dim" style={{ fontSize: 11 }}>{c.note}</div>}</td><td>{formatCompactVND(c.budget)}</td><td>{formatCompactVND(c.actual)}</td><td className={diff >= 0 ? "figure-pos" : "figure-debt"}>{formatCompactVND(diff)}</td></tr>;
              })}
              <tr><td><strong>Tổng</strong></td><td><strong>{formatCompactVND(totalBudget)}</strong></td><td><strong>{formatCompactVND(totalActual)}</strong></td><td className={totalBudget - totalActual >= 0 ? "figure-pos" : "figure-debt"}><strong>{formatCompactVND(totalBudget - totalActual)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <div className="revenue-event-form">
          <input className="input input-sm" placeholder="Hạng mục (VD: Vật tư chính)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <NumberInput className="input input-sm" value={budget} onChange={setBudget} placeholder="Ngân sách (₫)" />
          <NumberInput className="input input-sm" value={actual} onChange={setActual} placeholder="Thực tế (₫)" />
          <button className="btn btn-outline btn-sm" onClick={() => { if (category.trim()) { onAddCost(category.trim(), Number(budget) || 0, Number(actual) || 0); setCategory(""); setBudget(""); setActual(""); setShowForm(false); } }}>
            <Plus size={13} /> Lưu
          </button>
        </div>
      )}
    </div>
  );
}

function RevenueLedger({ project, onAddEvent }) {
  const [type, setType] = useState("payment");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const events = project.revenueEvents || [];
  const collected = projectCollected(project);
  const ar = projectAR(project);

  const submit = () => {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    onAddEvent(type, date, n, note.trim() || (type === "payment" ? "Ghi nhận thu tiền" : "Xuất hoá đơn"));
    setAmount(""); setNote("");
  };

  return (
    <div className="panel-sub panel" style={{ marginTop: 12 }}>
      <h4 style={{ marginBottom: 10 }}>Sổ theo dõi doanh thu &amp; công nợ</h4>
      <div className="pd-payment-figures" style={{ marginBottom: 10 }}>
        <div><span className="dim">Đã thu (Cash)</span><strong className="figure-pos">{formatVND(collected)}</strong></div>
        <div><span className="dim">Giá trị hợp đồng</span><strong>{formatVND(project.contractValue)}</strong></div>
        <div><span className="dim">Còn phải thu (A/R)</span><strong className={ar > 0 ? "figure-debt" : "figure-pos"}>{formatVND(ar)}</strong></div>
      </div>
      {events.length === 0 && <div className="empty-note">Chưa ghi nhận sự kiện doanh thu nào.</div>}
      <div className="attach-list">
        {events.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((ev) => (
          <div className="revenue-event-item" key={ev.id}>
            <Calendar size={12} /> <span className="dim">{ev.date}</span>
            <span className={`event-type-tag event-type-${ev.type}`}>{ev.type === "payment" ? "Thu tiền" : "Hoá đơn"}</span>
            <strong>{formatVND(ev.amount)}</strong><span className="dim">{ev.note}</span>
          </div>
        ))}
      </div>
      <div className="revenue-event-form">
        <select className="input input-sm" style={{ maxWidth: 120 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="payment">Thu tiền</option><option value="invoice">Xuất hoá đơn</option>
        </select>
        <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        <NumberInput className="input input-sm" value={amount} onChange={setAmount} placeholder="Số tiền (₫)" />
        <input className="input input-sm" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-outline btn-sm" onClick={submit}><Plus size={13} /> Ghi nhận</button>
      </div>
    </div>
  );
}

function NewProjectForm({ onCancel, onCreate, customers }) {
  const [name, setName] = useState("");
  const [customerChoice, setCustomerChoice] = useState(customers[0]?.id || "__custom__");
  const [customName, setCustomName] = useState("");
  const [scope, setScope] = useState("");
  const [contractValue, setContractValue] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    const isCustom = customerChoice === "__custom__";
    const cust = !isCustom ? customers.find((c) => c.id === customerChoice) : null;
    onCreate({
      name: name.trim(),
      customerId: isCustom ? null : customerChoice,
      customerName: isCustom ? (customName.trim() || "Khách hàng mới") : cust.company,
      scope: scope.trim(), contractValue: Number(contractValue) || 0,
    });
  };

  return (
    <div className="inline-form">
      <div className="form-row"><label>Tên dự án</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Showroom Nội thất..." /></div>
      <div className="form-row"><label>Khách hàng</label>
        <select className="input" value={customerChoice} onChange={(e) => setCustomerChoice(e.target.value)}>
          <option value="__custom__">-- Khách hàng chưa có trong danh mục --</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
        {customerChoice === "__custom__" && <input className="input" style={{ marginTop: 6 }} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Tên khách hàng" />}
      </div>
      <div className="form-row"><label>Phạm vi công việc</label><textarea className="input" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} /></div>
      <div className="form-row"><label>Giá trị hợp đồng (₫)</label><NumberInput className="input" value={contractValue} onChange={setContractValue} /></div>
      <div className="form-actions"><button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button><button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Tạo dự án</button></div>
    </div>
  );
}

function ProjectDetail({ project, customers, currentRole, updateProject, toggleGate, advanceProject, sendBackProject, addRevenueEvent, addCost }) {
  const [editingInfo, setEditingInfo] = useState(false);
  useEffect(() => setEditingInfo(false), [project.id]);

  const pct = projectStagePct(project);

  if (editingInfo) {
    return (
      <div className="project-detail">
        <div className="pd-header"><h2>Sửa thông tin dự án</h2></div>
        <EditProjectInfoForm project={project} customers={customers} onCancel={() => setEditingInfo(false)}
          onSave={(patch) => { updateProject(project.id, patch); setEditingInfo(false); }} />
      </div>
    );
  }

  return (
    <div className="project-detail">
      <div className="pd-header">
        <div>
          <div className="pd-client"><Building2 size={13} /> {project.customerName} · <span className="project-code-tag">{project.code}</span></div>
          <h2>{project.name}</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditingInfo(true)}><PenLine size={13} /> Sửa thông tin</button>
          <RiskBadge level={projectRiskLevel(project)} />
          <StatusPill status={project.status} map={{ active: "Đang triển khai", closed: "Đã đóng (CLOSED)", on_hold: "Tạm dừng" }} />
        </div>
      </div>

      <div className="pd-scope"><h4>Phạm vi công việc</h4><p>{project.scope}</p></div>

      <div className="pd-payment panel-sub">
        <h4 style={{ marginBottom: 10 }}>Tiến độ triển khai</h4>
        <ProgressBar pct={pct} tone={pct >= 80 ? "green" : pct >= 40 ? "amber" : "red"} />
        <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>{pct}% · Bước {project.currentStage}/{PROJECT_FINAL_STAGE_ID}</div>
      </div>

      <CostPanel project={project} onAddCost={(cat, b, a) => addCost(project.id, cat, b, a)} />
      <RevenueLedger project={project} onAddEvent={(type, date, amount, note) => addRevenueEvent(project.id, type, date, amount, note)} />
      <BottleneckLog bottlenecks={project.bottlenecks} stageDefs={PROJECT_STAGES} />

      {project.currentStage >= PROJECT_WARRANTY_STAGE_ID && (
        <div className="kickoff-box" style={{ marginBottom: 16 }}>
          <ShieldCheck size={14} /><span>Dự án đã vào giai đoạn Warranty — hồ sơ theo dõi tự động có trong tab CRM CSKH · Bảo hành.</span>
        </div>
      )}

      <div className="pd-stages">
        <h4>Delivery Stage-Gate</h4>
        <StageGateStepper stageDefs={PROJECT_STAGES} flow={project} currentRole={currentRole}
          onToggleGate={(stageId, idx) => toggleGate(project.id, stageId, idx)}
          onAdvance={() => advanceProject(project.id)}
          onSendBack={(reason) => sendBackProject(project.id, reason)}
          renderFinalActions={({ canAct, stage }) => canAct ? (
            <button className="btn btn-primary btn-sm" onClick={() => advanceProject(project.id)}><Check size={14} /> Đóng dự án (CLOSED)</button>
          ) : <div className="perm-note">Chỉ BOD được đóng dự án ở bước cuối.</div>} />
      </div>
    </div>
  );
}

function ProjectsTab({ projects, customers, currentRole, selectedCode, setSelectedCode, createProject, updateProject, toggleGate, advanceProject, sendBackProject, addRevenueEvent, addCost }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("active");
  const filtered = projects.filter((p) => filter === "all" ? true : p.status === filter);
  const selected = projects.find((p) => p.code === selectedCode) || filtered[0];

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Dự án triển khai</h1><p className="pane-sub">Delivery Stage-Gate: Kick-off → Thiết kế → Duyệt bản vẽ → BOQ → Procurement → Manufacturing → Construction → QC → Nghiệm thu → Bàn giao → Quyết toán → Thu tiền → Warranty → CLOSED.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Tạo dự án mới</button>
      </div>

      {showForm && <NewProjectForm customers={customers} onCancel={() => setShowForm(false)} onCreate={(data) => { createProject(data); setShowForm(false); }} />}

      <div className="split">
        <div className="split-left">
          <div className="filter-tabs">
            {[["active", "Đang triển khai"], ["closed", "Đã đóng"], ["all", "Tất cả"]].map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? "chip-active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="project-list">
            {filtered.map((p) => {
              const pct = projectStagePct(p);
              const flagged = hasOpenBottleneck(p);
              const stg = PROJECT_STAGES.find((s) => s.id === p.currentStage);
              return (
                <div key={p.id} className={`project-card ${selected?.id === p.id ? "project-card-active" : ""}`} onClick={() => setSelectedCode(p.code)}>
                  <div className="project-card-top">
                    <span className="project-card-name">{p.code} · {p.name}</span>
                    {flagged && <AlertTriangle size={14} className="flag-icon" />}
                  </div>
                  <div className="project-card-client">{p.customerName}</div>
                  <div className="project-card-stage">Bước {p.currentStage}/{PROJECT_FINAL_STAGE_ID} · {stg?.label}</div>
                  <ProgressBar pct={pct} tone={pct >= 80 ? "green" : pct >= 40 ? "amber" : "red"} />
                </div>
              );
            })}
            {filtered.length === 0 && <div className="empty-note">Không có dự án nào.</div>}
          </div>
        </div>
        <div className="split-right">
          {selected ? (
            <ProjectDetail project={selected} customers={customers} currentRole={currentRole} updateProject={updateProject}
              toggleGate={toggleGate} advanceProject={advanceProject} sendBackProject={sendBackProject}
              addRevenueEvent={addRevenueEvent} addCost={addCost} />
          ) : <div className="empty-note">Chọn một dự án để xem chi tiết.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  TASKS TAB                                                              */
/* ---------------------------------------------------------------------- */

function NewTaskForm({ projects, onCancel, onCreate }) {
  const [title, setTitle] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const submit = () => { if (!title.trim()) return; onCreate({ title: title.trim(), projectCode: projectCode || null, assignee: assignee.trim(), dueDate, note: note.trim() }); };
  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Việc cần làm</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="form-row"><label>Dự án liên quan</label>
          <select className="input" value={projectCode} onChange={(e) => setProjectCode(e.target.value)}>
            <option value="">-- Không gắn dự án --</option>
            {projects.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
          </select>
        </div>
        <div className="form-row"><label>Người chịu trách nhiệm</label><input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} /></div>
        <div className="form-row"><label>Deadline</label><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <div className="form-row"><label>Ghi chú</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="form-actions"><button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button><button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Thêm task</button></div>
    </div>
  );
}

function TasksTab({ tasks, projects, addTask, toggleTaskDone, removeTask, goToProject }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("open");
  const overdue = tasks.filter(isTaskOverdue);
  const filtered = tasks.filter((t) => filter === "all" ? true : filter === "overdue" ? isTaskOverdue(t) : t.status === filter);

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Nhiệm vụ &amp; Deadline</h1><p className="pane-sub">Danh sách task toàn hệ thống, gắn theo mã dự án.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm task</button>
      </div>

      {showForm && <NewTaskForm projects={projects} onCancel={() => setShowForm(false)} onCreate={(data) => { addTask(data); setShowForm(false); }} />}

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <KPICard icon={ListChecks} tone="blue" label="Tổng task" value={tasks.length} />
        <KPICard icon={Flag} tone="red" label="Quá hạn" value={overdue.length} />
        <KPICard icon={CircleCheck} tone="green" label="Đã hoàn thành" value={tasks.filter((t) => t.status === "done").length} />
      </div>

      <div className="filter-tabs">
        {[["open", "Đang mở"], ["overdue", "Quá hạn"], ["done", "Đã xong"], ["all", "Tất cả"]].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? "chip-active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <div className="panel">
        {filtered.length === 0 && <div className="empty-note">Không có task nào.</div>}
        {filtered.length > 0 && (
          <div className="forecast-table-wrap">
            <table className="forecast-table">
              <thead><tr><th></th><th>Việc cần làm</th><th>Dự án</th><th>Người chịu trách nhiệm</th><th>Deadline</th><th></th></tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className={isTaskOverdue(t) ? "task-row-overdue" : ""}>
                    <td><button className="icon-btn" onClick={() => toggleTaskDone(t.id)}>{t.status === "done" ? <CircleCheck size={16} className="figure-pos" /> : <Circle size={16} />}</button></td>
                    <td>{t.title}{t.note && <div className="dim" style={{ fontSize: 11 }}>{t.note}</div>}</td>
                    <td>{t.projectCode ? <button className="btn btn-ghost btn-sm" onClick={() => goToProject(t.projectCode)}>{t.projectCode}</button> : "—"}</td>
                    <td>{t.assignee || "—"}</td>
                    <td className={isTaskOverdue(t) ? "figure-debt" : ""}>{t.dueDate}</td>
                    <td><button className="icon-btn" onClick={() => removeTask(t.id)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  WARRANTY / CRM CSKH TAB                                                 */
/* ---------------------------------------------------------------------- */

function WarrantyNoteForm({ onAdd }) {
  const [text, setText] = useState("");
  const submit = () => { if (text.trim()) { onAdd(text.trim()); setText(""); } };
  return (
    <div className="cskh-note-form">
      <input className="input input-sm" placeholder="Ghi chú chăm sóc / phản hồi bảo hành..." value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-outline btn-sm" onClick={submit}><Plus size={13} /> Ghi chú</button>
    </div>
  );
}

function WarrantyTab({ warrantyRecords, addWarrantyNote, closeWarrantyRecord, goToProject }) {
  const [filter, setFilter] = useState("all");
  const filtered = warrantyRecords.filter((r) => (filter === "all" ? true : r.status === filter));
  const activeCount = warrantyRecords.filter((r) => r.status === "active").length;

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div>
          <h1>CRM CSKH · Bảo hành</h1>
          <p className="pane-sub">Dự án tự động chuyển vào đây ngay khi vào bước Warranty, để chăm sóc khách hàng trong thời gian bảo hành.</p>
        </div>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KPICard icon={ShieldCheck} tone="blue" label="Đang trong bảo hành" value={activeCount} />
        <KPICard icon={CircleCheck} tone="green" label="Đã hoàn tất bảo hành" value={warrantyRecords.length - activeCount} />
      </div>

      <div className="filter-tabs">
        {[["all", "Tất cả"], ["active", "Đang bảo hành"], ["completed", "Đã hoàn tất"]].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? "chip-active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {filtered.length === 0 && <div className="empty-note">Chưa có dự án nào trong CRM CSKH.</div>}

      {filtered.map((r) => {
        const warrantyEnd = addMonths(r.transferredAt, r.warrantyMonths);
        return (
          <div className="panel" key={r.id}>
            <div className="cskh-head">
              <div>
                <div className="pd-client"><Building2 size={13} /> {r.customerName} · <span className="project-code-tag">{r.projectCode}</span></div>
                <h3 style={{ margin: "2px 0" }}>{r.projectName}</h3>
              </div>
              <span className={`status-pill status-${r.status === "active" ? "active" : "completed"}`}>
                {r.status === "active" ? "Đang bảo hành" : "Đã hoàn tất"}
              </span>
            </div>
            <div className="cskh-meta">
              <span><Calendar size={13} /> Chuyển giao: {r.transferredAt}</span>
              <span><ShieldCheck size={13} /> Hạn bảo hành: {r.warrantyMonths} tháng (đến {warrantyEnd})</span>
              <button className="btn btn-ghost btn-sm" onClick={() => goToProject(r.projectCode)}>Xem dự án <ChevronRight size={13} /></button>
              {r.status === "active" && <button className="btn btn-outline btn-sm" onClick={() => closeWarrantyRecord(r.id)}>Đóng hồ sơ bảo hành</button>}
            </div>
            <div className="cskh-notes">
              <div className="attach-head-label" style={{ marginBottom: 6 }}><PhoneCall size={12} /> Ghi chú chăm sóc</div>
              {r.notes.length === 0 && <div className="attach-empty">Chưa có ghi chú nào.</div>}
              {r.notes.map((n) => <div className="cskh-note-item" key={n.id}><span className="dim">{n.date}</span> — {n.text}</div>)}
              <WarrantyNoteForm onAdd={(text) => addWarrantyNote(r.id, text)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  CUSTOMERS TAB                                                           */
/* ---------------------------------------------------------------------- */

function OwnerPicker({ employees, value, onChange, onCreateEmployee }) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("KD");
  const activeEmployees = employees.filter((e) => e.active);

  return (
    <div>
      <select className="input" value={value} onChange={(e) => {
        if (e.target.value === "__new__") { setShowNew(true); return; }
        onChange(e.target.value);
      }}>
        <option value="">-- Chưa gán nhân viên phụ trách --</option>
        {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
        <option value="__new__">-- Thêm nhân viên mới --</option>
      </select>
      {showNew && (
        <div className="revenue-event-form" style={{ marginTop: 6 }}>
          <input className="input input-sm" placeholder="Tên nhân viên" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select className="input input-sm" style={{ maxWidth: 110 }} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={() => {
            if (!newName.trim()) return;
            const emp = onCreateEmployee({ name: newName.trim(), role: newRole });
            onChange(emp.id);
            setShowNew(false); setNewName("");
          }}><Plus size={13} /> Tạo &amp; gán</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNew(false)}>Hủy</button>
        </div>
      )}
    </div>
  );
}

function NewCustomerForm({ employees, onCancel, onCreate, onCreateEmployee }) {
  const [f, setF] = useState({ company: "", industry: "", accountOwnerId: "", tier: "normal", overview: "", advantage: "" });
  const [contacts, setContacts] = useState([{ id: uid("ct"), name: "", position: "", phone: "", isPrimary: true }]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const updateContact = (id, field, val) => setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [field]: val } : c));
  const setPrimary = (id) => setContacts((prev) => prev.map((c) => ({ ...c, isPrimary: c.id === id })));
  const addContact = () => setContacts((prev) => [...prev, { id: uid("ct"), name: "", position: "", phone: "", isPrimary: false }]);
  const removeContact = (id) => setContacts((prev) => prev.length > 1 ? prev.filter((c) => c.id !== id) : prev);

  const submit = () => {
    if (!f.company.trim()) return;
    const owner = employees.find((e) => e.id === f.accountOwnerId);
    onCreate({
      company: f.company, industry: f.industry, tier: f.tier, overview: f.overview, advantage: f.advantage,
      accountOwnerId: owner ? owner.id : null, accountOwnerName: owner ? owner.name : "",
      contacts,
    });
  };

  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Doanh nghiệp</label><input className="input" value={f.company} onChange={set("company")} /></div>
        <div className="form-row"><label>Ngành hàng</label><input className="input" value={f.industry} onChange={set("industry")} /></div>
        <div className="form-row"><label>Nhân viên phụ trách</label>
          <OwnerPicker employees={employees} value={f.accountOwnerId} onChange={(id) => setF({ ...f, accountOwnerId: id })} onCreateEmployee={onCreateEmployee} />
        </div>
        <div className="form-row"><label>Nhóm tiềm năng</label>
          <select className="input" value={f.tier} onChange={set("tier")}><option value="high">Cao</option><option value="normal">Bình thường</option></select>
        </div>
      </div>
      <div className="form-row">
        <label>Người liên hệ</label>
        <div className="contact-rows">
          {contacts.map((c) => (
            <div className="contact-row" key={c.id}>
              <input className="input input-sm" placeholder="Họ tên" value={c.name} onChange={(e) => updateContact(c.id, "name", e.target.value)} />
              <input className="input input-sm" placeholder="Chức vụ" value={c.position} onChange={(e) => updateContact(c.id, "position", e.target.value)} />
              <input className="input input-sm" placeholder="Điện thoại" value={c.phone} onChange={(e) => updateContact(c.id, "phone", e.target.value)} />
              <button type="button" className={`chip chip-tiny ${c.isPrimary ? "chip-active" : ""}`} onClick={() => setPrimary(c.id)}>Chính</button>
              <button type="button" className="icon-btn" onClick={() => removeContact(c.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addContact}><UserPlus size={13} /> Thêm người liên hệ</button>
      </div>
      <div className="form-row"><label>Tổng quan doanh nghiệp &amp; tiềm năng phát triển</label><textarea className="input" rows={2} value={f.overview} onChange={set("overview")} /></div>
      <div className="form-row"><label>Đánh giá lợi thế hợp tác</label><textarea className="input" rows={2} value={f.advantage} onChange={set("advantage")} /></div>
      <div className="form-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button>
        <button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Thêm khách hàng</button>
      </div>
    </div>
  );
}

function CustomerCard({ c, onOpen, onToggleTier }) {
  const primary = c.contacts.find((x) => x.isPrimary) || c.contacts[0];
  return (
    <div className="client-card" onClick={() => onOpen(c.id)}>
      <div className="client-card-top">
        <div className="client-avatar"><Building2 size={18} /></div>
        <div><div className="client-company">{c.company}</div><div className="client-industry">{c.industry}</div></div>
      </div>
      <div className="client-contact"><User size={13} /> {primary?.name} <span className="dim">· {primary?.position}</span></div>
      {c.contacts.length > 1 && <div className="client-contact dim">+{c.contacts.length - 1} người liên hệ khác</div>}
      <div className="client-contact"><ShieldCheck size={13} /> Phụ trách: {c.accountOwnerName || "Chưa gán"}</div>
      <div className="client-block"><div className="client-block-label">Tổng quan &amp; tiềm năng</div><p>{c.overview}</p></div>
      <div className="client-block"><div className="client-block-label">Lợi thế hợp tác</div><p>{c.advantage}</p></div>
      <div className="client-card-foot">
        <TierBadge tier={c.tier} />
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onToggleTier(c.id); }}>Chuyển sang {c.tier === "high" ? "Bình thường" : "Cao"}</button>
      </div>
    </div>
  );
}

function OwnerReassignBox({ customer, employees, onReassign }) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(customer.accountOwnerId || "");
  const currentOwner = employees.find((e) => e.id === customer.accountOwnerId);

  if (!editing) {
    return (
      <div className="pane-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Phụ trách: {customer.accountOwnerName ? `${customer.accountOwnerName}${currentOwner ? ` (${currentOwner.role})` : ""}` : "Chưa gán"}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { setChoice(customer.accountOwnerId || ""); setEditing(true); }}><PenLine size={12} /> Đổi nhân viên</button>
      </div>
    );
  }
  return (
    <div className="revenue-event-form" style={{ marginTop: 4 }}>
      <select className="input input-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">-- Chưa gán nhân viên phụ trách --</option>
        {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
      </select>
      <button className="btn btn-primary btn-sm" onClick={() => { onReassign(choice || null); setEditing(false); }}><Save size={13} /> Lưu</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Hủy</button>
    </div>
  );
}

function CustomerDetail({ customer, employees, opportunities, projects, onBack, goToProject, goToOpportunity, reassignOwner }) {
  const relatedOpps = opportunities.filter((o) => o.customerId === customer.id);
  const relatedProjects = projects.filter((p) => p.customerId === customer.id);
  const activeP = relatedProjects.filter((p) => p.status === "active");
  const closedP = relatedProjects.filter((p) => p.status === "closed");
  const totalRevenue = relatedProjects.reduce((s, p) => s + projectCollected(p), 0);
  const totalAR = relatedProjects.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);

  return (
    <div className="tab-pane">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12 }}><ChevronLeft size={14} /> Quay lại danh sách khách hàng</button>
      <div className="pane-header">
        <div>
          <div className="pd-client"><Building2 size={13} /> {customer.industry}</div>
          <h1>{customer.company}</h1>
          <OwnerReassignBox customer={customer} employees={employees} onReassign={(empId) => reassignOwner(customer.id, empId)} />
        </div>
        <TierBadge tier={customer.tier} />
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <KPICard icon={FolderKanban} tone="blue" label="Tổng công trình" value={relatedProjects.length} sub={`${activeP.length} đang triển khai · ${closedP.length} đã đóng`} />
        <KPICard icon={DollarSign} tone="green" label="Tổng doanh thu đã thu" value={formatCompactVND(totalRevenue)} />
        <KPICard icon={AlertTriangle} tone="amber" label="Công nợ còn lại" value={formatCompactVND(totalAR)} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 className="panel-title">Người liên hệ</h3>
          <div className="contact-list">
            {customer.contacts.map((c) => (
              <div className="contact-item" key={c.id}>
                <User size={14} />
                <div><div className="contact-name">{c.name} {c.isPrimary && <span className="contact-primary-tag">Liên hệ chính</span>}</div>
                  <div className="dim">{c.position}{c.phone ? ` · ${c.phone}` : ""}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3 className="panel-title">Chân dung khách hàng</h3>
          <div className="client-block"><div className="client-block-label">Tổng quan &amp; tiềm năng</div><p>{customer.overview}</p></div>
          <div className="client-block"><div className="client-block-label">Lợi thế hợp tác</div><p>{customer.advantage}</p></div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Cơ hội bán hàng ({relatedOpps.length})</h3>
        {relatedOpps.length === 0 && <div className="empty-note">Chưa có cơ hội nào.</div>}
        {relatedOpps.map((o) => (
          <div className="cd-project-item" key={o.id} onClick={() => goToOpportunity(o.id)}>
            <span>{o.title}</span><span className="dim">{OPP_STAGES.find((s) => s.id === o.currentStage)?.label} · {formatCompactVND(o.value)}</span><ChevronRight size={15} />
          </div>
        ))}
      </div>
      <div className="panel">
        <h3 className="panel-title">Công trình ({relatedProjects.length})</h3>
        {relatedProjects.length === 0 && <div className="empty-note">Chưa có công trình nào.</div>}
        {relatedProjects.map((p) => (
          <div className="cd-project-item" key={p.id} onClick={() => goToProject(p.code)}>
            <span>{p.code} · {p.name}</span><span className="dim">{formatCompactVND(projectCollected(p))} / {formatCompactVND(p.contractValue)}</span><ChevronRight size={15} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomersTab({ customers, employees, opportunities, projects, addCustomer, addEmployee, reassignOwner, toggleCustomerTier, goToProject, goToOpportunity }) {
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [openCustomerId, setOpenCustomerId] = useState(null);

  const filtered = customers.filter((c) => c.company.toLowerCase().includes(query.toLowerCase()) || c.contacts.some((ct) => ct.name.toLowerCase().includes(query.toLowerCase())));
  const high = filtered.filter((c) => c.tier === "high");
  const normal = filtered.filter((c) => c.tier === "normal");

  const openCustomer = customers.find((c) => c.id === openCustomerId);
  if (openCustomer) {
    return <CustomerDetail customer={openCustomer} employees={employees} opportunities={opportunities} projects={projects}
      onBack={() => setOpenCustomerId(null)} goToProject={goToProject} goToOpportunity={goToOpportunity} reassignOwner={reassignOwner} />;
  }

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Khách hàng</h1><p className="pane-sub">Chân dung doanh nghiệp — mọi cơ hội &amp; công trình liên kết qua Mã khách hàng (customerId).</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm khách hàng</button>
      </div>
      <div className="search-row"><Search size={15} /><input className="input input-plain" placeholder="Tìm theo tên doanh nghiệp hoặc người liên hệ..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      {showForm && <NewCustomerForm employees={employees} onCreateEmployee={addEmployee} onCancel={() => setShowForm(false)} onCreate={(c) => { addCustomer(c); setShowForm(false); }} />}
      <div className="client-columns">
        <div className="client-col">
          <div className="client-col-head col-head-high">Tiềm năng Cao ({high.length})</div>
          <div className="client-col-body">
            {high.map((c) => <CustomerCard key={c.id} c={c} onOpen={setOpenCustomerId} onToggleTier={toggleCustomerTier} />)}
            {high.length === 0 && <div className="empty-note">Không có khách hàng nào.</div>}
          </div>
        </div>
        <div className="client-col">
          <div className="client-col-head col-head-normal">Tiềm năng Bình thường ({normal.length})</div>
          <div className="client-col-body">
            {normal.map((c) => <CustomerCard key={c.id} c={c} onOpen={setOpenCustomerId} onToggleTier={toggleCustomerTier} />)}
            {normal.length === 0 && <div className="empty-note">Không có khách hàng nào.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  NHÂN VIÊN — quản lý roster + doanh thu/công nợ theo Nhân viên phụ trách */
/* ---------------------------------------------------------------------- */

function NewEmployeeForm({ onCancel, onCreate }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("KD");
  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Họ tên</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Nguyễn Văn A" /></div>
        <div className="form-row"><label>Vai trò</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button>
        <button className="btn btn-primary btn-sm" onClick={() => name.trim() && onCreate({ name: name.trim(), role })}><Plus size={14} /> Thêm nhân viên</button>
      </div>
    </div>
  );
}

function EmployeeRow({ employee, summary, updateEmployee, toggleEmployeeActive }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role);

  return (
    <div className="panel employee-row">
      <div className="employee-row-top">
        {!editing ? (
          <div className="employee-name-block">
            <span className="employee-name">{employee.name}</span>
            <span className="chip chip-tiny">{ROLE_LABELS[employee.role]}</span>
            {!employee.active && <span className="chip chip-tiny">Đã ngừng hoạt động</span>}
          </div>
        ) : (
          <div className="revenue-event-form" style={{ margin: 0 }}>
            <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="input input-sm" style={{ maxWidth: 110 }} value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {!editing ? (
            <button className="btn btn-ghost btn-sm" onClick={() => { setName(employee.name); setRole(employee.role); setEditing(true); }}><PenLine size={12} /> Sửa</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => { if (name.trim()) { updateEmployee(employee.id, { name: name.trim(), role }); setEditing(false); } }}><Save size={12} /> Lưu</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => toggleEmployeeActive(employee.id)}>{employee.active ? "Ngừng hoạt động" : "Kích hoạt lại"}</button>
        </div>
      </div>
      <div className="pd-payment-figures" style={{ marginTop: 10 }}>
        <div><span className="dim">Khách hàng phụ trách</span><strong>{summary.customerCount}</strong></div>
        <div><span className="dim">Công trình</span><strong>{summary.projectCount}</strong></div>
        <div><span className="dim">Pipeline đang mở</span><strong>{formatCompactVND(summary.pipelineValue)}</strong></div>
        <div><span className="dim">Giá trị hợp đồng</span><strong>{formatCompactVND(summary.contractValue)}</strong></div>
        <div><span className="dim">Doanh thu đã thu</span><strong className="figure-pos">{formatCompactVND(summary.collected)}</strong></div>
        <div><span className="dim">Công nợ (A/R)</span><strong className={summary.ar > 0 ? "figure-debt" : "figure-pos"}>{formatCompactVND(summary.ar)}</strong></div>
      </div>
    </div>
  );
}

function EmployeesTab({ employees, customers, opportunities, projects, addEmployee, updateEmployee, toggleEmployeeActive }) {
  const [showForm, setShowForm] = useState(false);
  const summaries = employeeSummary(employees, customers, opportunities, projects);
  const totalCollected = summaries.reduce((s, x) => s + x.collected, 0);
  const sorted = summaries.slice().sort((a, b) => b.collected - a.collected);

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Nhân viên</h1><p className="pane-sub">Danh sách nhân viên phụ trách khách hàng, và doanh thu/công nợ quy về theo từng người.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm nhân viên</button>
      </div>

      {showForm && <NewEmployeeForm onCancel={() => setShowForm(false)} onCreate={(data) => { addEmployee(data); setShowForm(false); }} />}

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KPICard icon={Users} tone="blue" label="Tổng số nhân viên" value={employees.length} sub={`${employees.filter((e) => e.active).length} đang hoạt động`} />
        <KPICard icon={DollarSign} tone="green" label="Tổng doanh thu quy về nhân viên" value={formatCompactVND(totalCollected)} />
      </div>

      {sorted.map((s) => (
        <EmployeeRow key={s.employee.id} employee={s.employee} summary={s} updateEmployee={updateEmployee} toggleEmployeeActive={toggleEmployeeActive} />
      ))}
      {sorted.length === 0 && <div className="empty-note">Chưa có nhân viên nào.</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  QUY TRÌNH SOP — 2 funnel (Sales & Delivery) + danh mục KH               */
/* ---------------------------------------------------------------------- */

function FunnelBlock({ title, note, steps, counts, bottleneckPct, onRowClick }) {
  const maxCount = Math.max(1, ...counts);
  const withConv = steps.map((s, idx) => {
    const prevCount = idx === 0 ? null : counts[idx - 1];
    const conv = prevCount !== null && prevCount > 0 ? (counts[idx] / prevCount) * 100 : null;
    return { ...s, count: counts[idx], conv };
  });
  const bottlenecks = withConv.filter((s) => s.conv !== null && s.conv < bottleneckPct);

  return (
    <div className="panel">
      <h3 className="panel-title">{title}</h3>
      <p className="pane-sub" style={{ marginBottom: 12 }}>{note} Chặng dưới {bottleneckPct}% chuyển đổi so với chặng trước bị đánh dấu là điểm nghẽn.</p>
      <div className="sop-funnel">
        {withConv.map((s) => (
          <div className={`sop-funnel-row ${s.conv !== null && s.conv < bottleneckPct ? "sop-funnel-row-bottleneck" : ""}`} key={s.id} onClick={() => onRowClick && onRowClick(s)} style={onRowClick ? { cursor: "pointer" } : undefined}>
            <div className="sop-funnel-label">Bước {s.id} · {s.label}</div>
            <div className="funnel-track sop-funnel-track"><div className="funnel-fill" style={{ width: `${(s.count / maxCount) * 100}%` }} /></div>
            <div className="sop-funnel-count"><span>{s.count}</span></div>
            <div className="sop-funnel-conv">{s.conv !== null ? <span className={s.conv < bottleneckPct ? "sop-bottleneck-tag" : "dim"}>{s.conv.toFixed(0)}%</span> : <span className="dim">—</span>}</div>
          </div>
        ))}
      </div>
      {bottlenecks.length > 0 && (
        <div className="sop-bottleneck-summary"><AlertTriangle size={14} /><span>Điểm nghẽn cần chú ý: {bottlenecks.map((b) => b.label).join(", ")}.</span></div>
      )}
    </div>
  );
}

function SopCustomerRow({ customer, projects, goToProject }) {
  const [open, setOpen] = useState(false);
  const [openProjectId, setOpenProjectId] = useState(null);
  const related = projects.filter((p) => p.customerId === customer.id);
  const totalRevenue = related.reduce((s, p) => s + projectCollected(p), 0);
  const totalDebt = related.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);

  return (
    <div className="panel industry-panel">
      <button className="industry-row-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="industry-name">{customer.company}</span>
        <span className="dim">{related.length} công trình</span>
        <span className="industry-figures">Doanh thu {formatCompactVND(totalRevenue)} · Công nợ {formatCompactVND(totalDebt)}</span>
      </button>
      {open && (
        <div className="industry-body">
          {related.length === 0 && <div className="empty-note">Chưa có công trình nào.</div>}
          {related.map((p) => {
            const debt = projectAR(p);
            const isOpenP = openProjectId === p.id;
            return (
              <div key={p.id} className="sop-project-block">
                <div className="cd-project-item" onClick={() => setOpenProjectId(isOpenP ? null : p.id)}>
                  {isOpenP ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span>{p.code} · {p.name}</span>
                  <span className="dim">{formatCompactVND(projectCollected(p))} / {formatCompactVND(p.contractValue)}</span>
                  <span className={debt > 0 ? "figure-debt" : "figure-pos"}>{debt > 0 ? `Còn nợ ${formatCompactVND(debt)}` : "Đã thu đủ"}</span>
                </div>
                {isOpenP && (
                  <div className="sop-project-detail">
                    <div className="sop-project-detail-head">
                      <span className={`status-pill status-${p.status}`}>{p.status === "active" ? "Đang triển khai" : "Đã đóng"}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => goToProject(p.code)}>Xem trong Dự án <ChevronRight size={13} /></button>
                    </div>
                    <div className="attach-head-label" style={{ margin: "8px 0 4px" }}>Thời điểm phát sinh doanh thu</div>
                    {(p.revenueEvents || []).length === 0 && <div className="empty-note" style={{ padding: "4px 0" }}>Chưa có ghi nhận doanh thu.</div>}
                    <div className="attach-list">
                      {(p.revenueEvents || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((ev) => (
                        <div className="revenue-event-item" key={ev.id}>
                          <Calendar size={12} /> <span className="dim">{ev.date}</span>
                          <span className={`event-type-tag event-type-${ev.type}`}>{ev.type === "payment" ? "Thu tiền" : "Hoá đơn"}</span>
                          <strong>{formatVND(ev.amount)}</strong><span className="dim">{ev.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SopTab({ opportunities, projects, customers, goToProject, goToOpportunity }) {
  const salesCounts = OPP_STAGES.map((s) => opportunities.filter((o) => o.currentStage >= s.id).length);
  const deliveryCounts = PROJECT_STAGES.map((s) => projects.filter((p) => p.currentStage >= s.id).length);
  const totalRevenue = projects.reduce((s, p) => s + projectCollected(p), 0);
  const totalDebt = projects.reduce((s, p) => s + Math.max(0, projectAR(p)), 0);

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div>
          <h1>Quy trình SOP</h1>
          <p className="pane-sub">Đánh giá tiềm năng &amp; điểm nghẽn theo từng chặng của 2 funnel (Sales &amp; Delivery), cùng danh mục khách hàng và công nợ theo công trình.</p>
        </div>
      </div>

      <FunnelBlock title="Sales Funnel — LEAD → WON/LOST" note="Số dự án/cơ hội đang ở hoặc đã vượt qua từng bước."
        steps={OPP_STAGES} counts={salesCounts} bottleneckPct={50} onRowClick={() => {}} />

      <FunnelBlock title="Delivery Funnel — Kick-off → CLOSED" note="Số công trình đang ở hoặc đã vượt qua từng bước triển khai."
        steps={PROJECT_STAGES} counts={deliveryCounts} bottleneckPct={50} onRowClick={() => {}} />

      <div className="panel">
        <h3 className="panel-title">Danh mục khách hàng</h3>
        <p className="pane-sub" style={{ marginBottom: 10 }}>Tổng công trình triển khai và doanh thu từng công trình — bấm vào một khách hàng, rồi vào từng công trình để xem chi tiết.</p>
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 14 }}>
          <KPICard icon={DollarSign} tone="green" label="Tổng doanh thu đã thu" value={formatCompactVND(totalRevenue)} />
          <KPICard icon={AlertTriangle} tone="amber" label="Tổng công nợ còn lại" value={formatCompactVND(totalDebt)} />
        </div>
      </div>

      {customers.map((c) => <SopCustomerRow key={c.id} customer={c} projects={projects} goToProject={goToProject} />)}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  SALES FORECAST TAB — grouped by industry → client (giữ nguyên)          */
/* ---------------------------------------------------------------------- */

function ClientForecastTable({ clientName, clientRows, updateCell, removeRow }) {
  const cRevenue = clientRows.reduce((s, r) => s + r.revenue, 0);
  const cCost = clientRows.reduce((s, r) => s + r.cost, 0);
  return (
    <div className="client-forecast-block">
      <div className="forecast-client-head">
        <span className="client-forecast-name">{clientName}</span>
        <span className="forecast-client-total">BLN: {formatCompactVND(cRevenue - cCost)}</span>
      </div>
      <div className="forecast-table-wrap">
        <table className="forecast-table">
          <thead><tr><th>Tháng</th><th>Doanh thu (₫)</th><th>Chi phí (₫)</th><th>BLN (₫)</th><th>Biên LN</th><th></th></tr></thead>
          <tbody>
            {clientRows.sort((a, b) => a.month - b.month).map((r) => {
              const profit = r.revenue - r.cost;
              const margin = r.revenue ? (profit / r.revenue) * 100 : 0;
              return (
                <tr key={r.id}>
                  <td>{MONTHS[r.month - 1]}</td>
                  <td><NumberInput className="input input-sm cell-input" value={r.revenue} onChange={(v) => updateCell(r.id, "revenue", v)} /></td>
                  <td><NumberInput className="input input-sm cell-input" value={r.cost} onChange={(v) => updateCell(r.id, "cost", v)} /></td>
                  <td className={profit >= 0 ? "figure-pos" : "figure-debt"}>{formatCompactVND(profit)}</td>
                  <td className="dim">{margin.toFixed(0)}%</td>
                  <td><button className="icon-btn" onClick={() => removeRow(r.id)}><Trash2 size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewForecastRowForm({ industries, clientsByIndustry, onCancel, onCreate }) {
  const [industry, setIndustry] = useState("");
  const [client, setClient] = useState("");
  const [month, setMonth] = useState(1);
  const [revenue, setRevenue] = useState("");
  const [cost, setCost] = useState("");
  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Ngành hàng (có sẵn hoặc mới)</label>
          <input className="input" list="industry-list" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          <datalist id="industry-list">{industries.map((i) => <option key={i} value={i} />)}</datalist>
        </div>
        <div className="form-row"><label>Khách hàng / Ngành hàng dự kiến (có sẵn hoặc mới)</label>
          <input className="input" list="client-list" value={client} onChange={(e) => setClient(e.target.value)} />
          <datalist id="client-list">{(clientsByIndustry[industry] || []).map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="form-row"><label>Tháng</label>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        </div>
        <div className="form-row"><label>Doanh thu dự kiến (₫)</label><NumberInput className="input" value={revenue} onChange={setRevenue} /></div>
        <div className="form-row"><label>Chi phí dự kiến (₫)</label><NumberInput className="input" value={cost} onChange={setCost} /></div>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button>
        <button className="btn btn-primary btn-sm" onClick={() => industry.trim() && client.trim() && onCreate({ industry: industry.trim(), client: client.trim(), month, revenue: Number(revenue) || 0, cost: Number(cost) || 0 })}>
          <Plus size={14} /> Thêm
        </button>
      </div>
    </div>
  );
}

function ForecastTab({ forecast, setForecast }) {
  const years = Array.from(new Set(forecast.map((r) => r.year))).sort();
  const [year, setYear] = useState(years[0] || 2026);
  const [showForm, setShowForm] = useState(false);
  const [expandedIndustry, setExpandedIndustry] = useState(null);

  const rows = forecast.filter((r) => r.year === year);
  const industries = Array.from(new Set(rows.map((r) => r.industry)));
  const clientsByIndustry = {};
  industries.forEach((ind) => { clientsByIndustry[ind] = Array.from(new Set(rows.filter((r) => r.industry === ind).map((r) => r.client))); });

  const monthlyTotals = MONTHS.map((_, idx) => {
    const m = idx + 1;
    const revenue = rows.filter((r) => r.month === m).reduce((s, r) => s + r.revenue, 0);
    const cost = rows.filter((r) => r.month === m).reduce((s, r) => s + r.cost, 0);
    return { revenue, cost, profit: revenue - cost };
  });
  const maxRevenue = Math.max(1, ...monthlyTotals.map((m) => m.revenue));

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalProfit = totalRevenue - totalCost;

  const updateCell = (id, field, val) => setForecast((prev) => prev.map((r) => r.id === id ? { ...r, [field]: Number(val) || 0 } : r));
  const removeRow = (id) => setForecast((prev) => prev.filter((r) => r.id !== id));

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Sales Forecast</h1><p className="pane-sub">Doanh thu và BLN được cộng dồn tự động: Khách hàng → Ngành hàng → Toàn doanh nghiệp.</p></div>
        <div className="pane-actions">
          <select className="input input-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm dòng</button>
        </div>
      </div>

      {showForm && (
        <NewForecastRowForm industries={industries} clientsByIndustry={clientsByIndustry} onCancel={() => setShowForm(false)}
          onCreate={(row) => { setForecast((prev) => [...prev, { id: uid("f"), ...row, year }]); setShowForm(false); }} />
      )}

      <div className="kpi-row">
        <KPICard icon={TrendingUp} tone="blue" label={`Doanh thu toàn doanh nghiệp ${year}`} value={formatCompactVND(totalRevenue)} />
        <KPICard icon={DollarSign} tone="amber" label="Chi phí dự kiến" value={formatCompactVND(totalCost)} />
        <KPICard icon={Award} tone="green" label="BLN dự kiến" value={formatCompactVND(totalProfit)} sub={totalRevenue ? `Biên LN ${(totalProfit / totalRevenue * 100).toFixed(1)}%` : ""} />
      </div>

      <div className="panel">
        <h3 className="panel-title">Biểu đồ doanh thu theo tháng — {year}</h3>
        <div className="bars">
          {monthlyTotals.map((m, idx) => (
            <div className="bar-col" key={idx}>
              <div className="bar-stack" style={{ height: 120 }}><div className="bar-rev" style={{ height: `${(m.revenue / maxRevenue) * 100}%` }} title={formatVND(m.revenue)} /></div>
              <div className="bar-label">{MONTHS[idx]}</div>
            </div>
          ))}
        </div>
      </div>

      {industries.map((ind) => {
        const indRows = rows.filter((r) => r.industry === ind);
        const indRevenue = indRows.reduce((s, r) => s + r.revenue, 0);
        const indCost = indRows.reduce((s, r) => s + r.cost, 0);
        const isOpen = expandedIndustry === ind;
        const clientNames = clientsByIndustry[ind];
        return (
          <div className="panel industry-panel" key={ind}>
            <button className="industry-row-head" onClick={() => setExpandedIndustry(isOpen ? null : ind)}>
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="industry-name">{ind}</span>
              <span className="dim">{clientNames.length} khách hàng</span>
              <span className="industry-figures">Doanh thu {formatCompactVND(indRevenue)} · BLN {formatCompactVND(indRevenue - indCost)}</span>
            </button>
            {isOpen && (
              <div className="industry-body">
                {clientNames.map((cn) => (
                  <ClientForecastTable key={cn} clientName={cn} clientRows={indRows.filter((r) => r.client === cn)} updateCell={updateCell} removeRow={removeRow} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  APP SHELL                                                              */
/* ---------------------------------------------------------------------- */

const NAV = [
  { key: "dashboard", label: "Master Dashboard", icon: LayoutDashboard },
  { key: "opportunities", label: "Cơ hội bán hàng", icon: Target },
  { key: "projects", label: "Dự án", icon: FolderKanban },
  { key: "customers", label: "Khách hàng", icon: Users },
  { key: "employees", label: "Nhân viên", icon: UserPlus },
  { key: "tasks", label: "Nhiệm vụ & Deadline", icon: ListChecks },
  { key: "warranty", label: "CRM CSKH · Bảo hành", icon: PhoneCall },
  { key: "sop", label: "Quy trình SOP", icon: GitBranch },
  { key: "forecast", label: "Sales Forecast", icon: TrendingUp },
];

const STORAGE_KEY = "xdnt-dashboard-state-v4";

export default function App() {
  const initialCustomers = seedCustomers();
  const initialProjects = seedProjects(initialCustomers);

  const [tab, setTab] = useState("dashboard");
  const [employees, setEmployees] = useState(seedEmployees);
  const [customers, setCustomers] = useState(initialCustomers);
  const [opportunities, setOpportunities] = useState(() => seedOpportunities(initialCustomers));
  const [projects, setProjects] = useState(initialProjects);
  const [warrantyRecords, setWarrantyRecords] = useState(() => seedWarrantyRecords(initialProjects));
  const [tasks, setTasks] = useState(seedTasks);
  const [forecast, setForecast] = useState(seedForecast);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(null);
  const [selectedProjectCode, setSelectedProjectCode] = useState(initialProjects[0]?.code || null);
  const [currentRole, setCurrentRole] = useState("BOD");
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  /* ---- persistence (localStorage qua storage.js — xem README để đổi backend) ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const data = JSON.parse(res.value);
          if (data.employees) setEmployees(data.employees);
          if (data.customers) setCustomers(data.customers);
          if (data.opportunities) setOpportunities(data.opportunities);
          if (data.projects) setProjects(data.projects);
          if (data.warrantyRecords) setWarrantyRecords(data.warrantyRecords);
          if (data.tasks) setTasks(data.tasks);
          if (data.forecast) setForecast(data.forecast);
        }
      } catch (e) { /* chưa có dữ liệu lưu trước đó */ } finally { setLoaded(true); }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await storage.set(STORAGE_KEY, JSON.stringify({ employees, customers, opportunities, projects, warrantyRecords, tasks, forecast })); }
      catch (e) { /* ignore */ }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [employees, customers, opportunities, projects, warrantyRecords, tasks, forecast, loaded]);

  /* ---- helper: advance 1 bước + tự resolve điểm nghẽn nếu vừa xử lý xong bước bị trả về ---- */
  const advanceFlow = (flow, stageDefs, role) => {
    const stageIdBefore = flow.currentStage;
    const now = todayISO();
    let updated = advanceGateStage(flow, stageDefs, role, now);
    const openBn = (updated.bottlenecks || []).find((b) => !b.resolvedAt);
    if (openBn && stageIdBefore === openBn.stageId - 1) updated = resolveLastBottleneck(updated, now);
    return updated;
  };

  /* ---- opportunity actions ---- */
  const addOpportunity = useCallback((data) => setOpportunities((prev) => [...prev, makeOpportunity(data)]), []);
  const toggleOppGate = useCallback((id, stageId, idx) => setOpportunities((prev) => prev.map((o) => o.id === id ? toggleGateCheck(o, stageId, idx) : o)), []);
  const advanceOpportunity = useCallback((id) => setOpportunities((prev) => prev.map((o) => o.id === id ? advanceFlow(o, OPP_STAGES, currentRole) : o)), [currentRole]);
  const sendBackOpportunity = useCallback((id, reason) => setOpportunities((prev) => prev.map((o) => o.id === id ? sendBackGate(o, reason, currentRole, todayISO()) : o)), [currentRole]);

  const markWon = useCallback((id) => {
    const now = todayISO();
    setProjects((prevProjects) => {
      const opp = opportunities.find((o) => o.id === id);
      if (!opp) return prevProjects;
      const code = nextProjectCode(prevProjects);
      const project = makeProject(code, { name: opp.title, customerId: opp.customerId, customerName: opp.customerName, scope: opp.note, contractValue: opp.value, createdAt: now });
      setOpportunities((prevOpp) => prevOpp.map((o) => o.id === id ? {
        ...o, status: "won", wonProjectCode: code,
        stages: { ...o.stages, [OPP_DECISION_STAGE_ID]: { ...o.stages[OPP_DECISION_STAGE_ID], state: "done", completedAt: now, completedBy: currentRole } },
      } : o));
      setSelectedProjectCode(code);
      setTab("projects");
      return [...prevProjects, project];
    });
  }, [opportunities, currentRole]);

  const markLost = useCallback((id, reason) => {
    const now = todayISO();
    setOpportunities((prev) => prev.map((o) => o.id === id ? {
      ...o, status: "lost", lostReason: reason,
      stages: { ...o.stages, [OPP_DECISION_STAGE_ID]: { ...o.stages[OPP_DECISION_STAGE_ID], state: "done", completedAt: now, completedBy: currentRole } },
    } : o));
  }, [currentRole]);

  /* ---- project actions ---- */
  const updateProject = useCallback((id, patch) => setProjects((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p)), []);
  const toggleProjectGate = useCallback((id, stageId, idx) => setProjects((prev) => prev.map((p) => p.id === id ? toggleGateCheck(p, stageId, idx) : p)), []);

  const advanceProject = useCallback((id) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      let updated = advanceFlow(p, PROJECT_STAGES, currentRole);
      if (updated.currentStage === PROJECT_FINAL_STAGE_ID && updated.stages[PROJECT_FINAL_STAGE_ID].state === "done") {
        updated = { ...updated, status: "closed" };
      }
      return updated;
    }));
  }, [currentRole]);

  const sendBackProject = useCallback((id, reason) => setProjects((prev) => prev.map((p) => p.id === id ? sendBackGate(p, reason, currentRole, todayISO()) : p)), [currentRole]);

  const createProject = useCallback((data) => {
    setProjects((prev) => {
      const code = nextProjectCode(prev);
      const project = makeProject(code, data);
      setSelectedProjectCode(code);
      return [...prev, project];
    });
  }, []);

  const addRevenueEvent = useCallback((id, type, date, amount, note) => {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, revenueEvents: [...(p.revenueEvents || []), makeRevenueEvent(type, date, amount, note)] } : p));
  }, []);

  const addCost = useCallback((id, category, budget, actual) => {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, costs: [...(p.costs || []), makeCost(category, budget, actual)] } : p));
  }, []);

  /* ---- warranty auto-tạo khi dự án vào bước Warranty ---- */
  useEffect(() => {
    if (!loaded) return;
    const missing = projects.filter((p) => p.currentStage >= PROJECT_WARRANTY_STAGE_ID && !warrantyRecords.some((r) => r.projectCode === p.code));
    if (missing.length) {
      setWarrantyRecords((prev) => [...prev, ...missing.map((p) => ({ ...makeWarrantyRecord(p), transferredAt: p.stages[PROJECT_ACCEPTANCE_STAGE_ID]?.completedAt || todayISO() }))]);
    }
  }, [projects, warrantyRecords, loaded]);

  /* ---- warranty actions ---- */
  const addWarrantyNote = useCallback((recordId, text) => setWarrantyRecords((prev) => prev.map((r) => r.id === recordId ? { ...r, notes: [...r.notes, { id: uid("nt"), date: todayISO(), text }] } : r)), []);
  const closeWarrantyRecord = useCallback((recordId) => setWarrantyRecords((prev) => prev.map((r) => r.id === recordId ? { ...r, status: "completed" } : r)), []);

  /* ---- task actions ---- */
  const addTask = useCallback((data) => setTasks((prev) => [...prev, makeTask(data)]), []);
  const toggleTaskDone = useCallback((id) => setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: t.status === "open" ? "done" : "open" } : t)), []);
  const removeTask = useCallback((id) => setTasks((prev) => prev.filter((t) => t.id !== id)), []);

  /* ---- customer actions ---- */
  const addCustomer = useCallback((c) => setCustomers((prev) => [...prev, { id: uid("c"), ...c }]), []);
  const toggleCustomerTier = useCallback((id) => setCustomers((prev) => prev.map((c) => c.id === id ? { ...c, tier: c.tier === "high" ? "normal" : "high" } : c)), []);
  const reassignOwner = useCallback((customerId, employeeId) => {
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== customerId) return c;
      if (!employeeId) return { ...c, accountOwnerId: null, accountOwnerName: "" };
      const emp = employees.find((e) => e.id === employeeId);
      return { ...c, accountOwnerId: employeeId, accountOwnerName: emp ? emp.name : c.accountOwnerName };
    }));
  }, [employees]);

  /* ---- employee (nhân viên phụ trách) actions ---- */
  const addEmployee = useCallback((data) => {
    const emp = makeEmployee(data);
    setEmployees((prev) => [...prev, emp]);
    return emp;
  }, []);
  const updateEmployee = useCallback((id, patch) => {
    setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
    if (patch.name) setCustomers((prev) => prev.map((c) => c.accountOwnerId === id ? { ...c, accountOwnerName: patch.name } : c));
  }, []);
  const toggleEmployeeActive = useCallback((id) => setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, active: !e.active } : e)), []);

  /* ---- navigation ---- */
  const goToProject = useCallback((code) => { setSelectedProjectCode(code); setTab("projects"); }, []);
  const goToOpportunity = useCallback((id) => { setSelectedOpportunityId(id); setTab("opportunities"); }, []);
  const goToEmployees = useCallback(() => setTab("employees"), []);

  return (
    <div className="xdnt-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">XD</div>
          <div className="brand-text"><div className="brand-title">XD · Nội Thất</div><div className="brand-sub">TDDB — Vận hành trung tâm</div></div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${tab === n.key ? "nav-item-active" : ""}`} onClick={() => setTab(n.key)}>
              <n.icon size={17} strokeWidth={2} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="foot-line" />
          <div className="role-switch">
            <div className="role-switch-label">Vai trò hiện tại</div>
            {ROLES.map((r) => (
              <button key={r} className={`role-btn ${currentRole === r ? "role-btn-active" : ""}`} onClick={() => setCurrentRole(r)}>{r}</button>
            ))}
          </div>
          <div className="foot-note">Vai trò quyết định bước nào bạn được phép hoàn thành; chỉ BOD được ghi nhận WON/LOST và đóng dự án ở bước cuối. Dữ liệu lưu tự động trên trình duyệt (localStorage).</div>
        </div>
      </aside>

      <main className="main">
        {tab === "dashboard" && (
          <DashboardTab employees={employees} customers={customers} opportunities={opportunities} projects={projects} tasks={tasks}
            warrantyRecords={warrantyRecords} goToProject={goToProject} goToOpportunity={goToOpportunity} goToEmployees={goToEmployees} />
        )}
        {tab === "opportunities" && (
          <OpportunitiesTab opportunities={opportunities} customers={customers} currentRole={currentRole}
            selectedId={selectedOpportunityId} setSelectedId={setSelectedOpportunityId} addOpportunity={addOpportunity}
            toggleGate={toggleOppGate} advanceOpportunity={advanceOpportunity} sendBackOpportunity={sendBackOpportunity}
            markWon={markWon} markLost={markLost} goToProject={goToProject} />
        )}
        {tab === "projects" && (
          <ProjectsTab projects={projects} customers={customers} currentRole={currentRole}
            selectedCode={selectedProjectCode} setSelectedCode={setSelectedProjectCode} createProject={createProject}
            updateProject={updateProject} toggleGate={toggleProjectGate} advanceProject={advanceProject}
            sendBackProject={sendBackProject} addRevenueEvent={addRevenueEvent} addCost={addCost} />
        )}
        {tab === "customers" && (
          <CustomersTab customers={customers} employees={employees} opportunities={opportunities} projects={projects}
            addCustomer={addCustomer} addEmployee={addEmployee} reassignOwner={reassignOwner}
            toggleCustomerTier={toggleCustomerTier} goToProject={goToProject} goToOpportunity={goToOpportunity} />
        )}
        {tab === "employees" && (
          <EmployeesTab employees={employees} customers={customers} opportunities={opportunities} projects={projects}
            addEmployee={addEmployee} updateEmployee={updateEmployee} toggleEmployeeActive={toggleEmployeeActive} />
        )}
        {tab === "tasks" && <TasksTab tasks={tasks} projects={projects} addTask={addTask} toggleTaskDone={toggleTaskDone} removeTask={removeTask} goToProject={goToProject} />}
        {tab === "warranty" && <WarrantyTab warrantyRecords={warrantyRecords} addWarrantyNote={addWarrantyNote} closeWarrantyRecord={closeWarrantyRecord} goToProject={goToProject} />}
        {tab === "sop" && <SopTab opportunities={opportunities} projects={projects} customers={customers} goToProject={goToProject} goToOpportunity={goToOpportunity} />}
        {tab === "forecast" && <ForecastTab forecast={forecast} setForecast={setForecast} />}
      </main>
    </div>
  );
}
