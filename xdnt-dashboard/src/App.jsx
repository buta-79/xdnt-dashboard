import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard, FolderKanban, Users, GitBranch, TrendingUp, Plus, X, Check,
  ChevronRight, ChevronDown, ChevronLeft, AlertTriangle, Trash2, Building2, User,
  Calendar, RotateCcw, PhoneCall, Award, Search, CircleCheck, Circle, Clock,
  DollarSign, Save, PenLine, Paperclip, Lock, Unlock, Download, FileText, Flag,
  UserPlus, Link2, ShieldCheck, ListChecks
} from "lucide-react";
import { storage } from "./lib/storage";
import {
  TODAY, STAGES, ROLES, ROLE_LABELS, PIPELINE_STAGES, MONTHS,
  DECISION_STAGE_ID, HANDOFF_STAGE_ID, FINAL_STAGE_ID, SOP_FUNNEL_STEPS, SOP_BOTTLENECK_CONVERSION,
  BOTTLENECK_THRESHOLD, MAX_ATTACHMENT_BYTES, uid, formatVND, formatCompactVND, addMonths,
  makeRound, getCurrentRound, getRevisionCount, stageRevisionNote,
  seedProjects, seedClients, seedPipeline, seedForecast, seedCrmCskh, seedSopManual,
} from "./data/seed";


/* ---------------------------------------------------------------------- */
/*  SMALL UI PRIMITIVES                                                     */
/* ---------------------------------------------------------------------- */

const formatNumberPlain = (n) => {
  if (n === null || n === undefined || isNaN(n) || n === "") return "";
  return Math.round(n).toLocaleString("vi-VN");
};

/** Text input that keeps thousand separators visible while typing, but reports a clean number to onChange. */
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

/* ---------------------------------------------------------------------- */
/*  DASHBOARD TAB                                                          */
/* ---------------------------------------------------------------------- */

function DashboardTab({ projects, goToProject }) {
  const active = projects.filter((p) => p.status === "active");
  const totalCollected = active.reduce((s, p) => s + p.paymentCollected, 0);
  const totalContract = active.reduce((s, p) => s + p.paymentTotal, 0);
  const totalDebt = active.reduce((s, p) => s + (p.paymentTotal - p.paymentCollected), 0);
  const collectRate = totalContract ? (totalCollected / totalContract) * 100 : 0;
  const totalRevisions = projects.reduce((s, p) => s + getRevisionCount(p), 0);

  const withRound = active.map((p) => ({ p, round: getCurrentRound(p) }));
  const bottlenecks = withRound
    .filter(({ round }) => round.daysInStage >= BOTTLENECK_THRESHOLD)
    .sort((a, b) => b.round.daysInStage - a.round.daysInStage);

  const stageCounts = STAGES.map((s) => ({
    ...s, count: withRound.filter(({ round }) => round.currentStage === s.id).length,
  }));
  const maxCount = Math.max(1, ...stageCounts.map((s) => s.count));

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div>
          <h1>Tổng quan điều hành</h1>
          <p className="pane-sub">Bức tranh toàn cảnh các dự án triển khai nội thất đang hoạt động.</p>
        </div>
      </div>

      <div className="kpi-row">
        <KPICard icon={FolderKanban} tone="blue" label="Dự án đang triển khai" value={active.length}
          sub={`${projects.length - active.length} dự án đã hoàn thành`} />
        <KPICard icon={TrendingUp} tone="green" label="Tiến độ thu tiền" value={collectRate.toFixed(0) + "%"}
          sub={`${formatCompactVND(totalCollected)} / ${formatCompactVND(totalContract)}`} />
        <KPICard icon={DollarSign} tone="amber" label="Tổng công nợ" value={formatCompactVND(totalDebt)}
          sub="Trên các dự án đang hoạt động" />
        <KPICard icon={AlertTriangle} tone="red" label="Điểm nghẽn" value={bottlenecks.length}
          sub={`${totalRevisions} lượt điều chỉnh phát sinh do KH chưa đồng ý`} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 className="panel-title">Phân bổ dự án theo bước triển khai</h3>
          <div className="funnel">
            {stageCounts.map((s) => (
              <div className="funnel-row" key={s.id}>
                <div className="funnel-label">
                  <span className="funnel-step">Bước {s.id}</span>
                  <span>{s.label}</span>
                </div>
                <div className="funnel-track">
                  <div className="funnel-fill" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                </div>
                <div className="funnel-count">{s.count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Điểm nghẽn cần xử lý</h3>
          {bottlenecks.length === 0 && <div className="empty-note">Không có điểm nghẽn nào — mọi dự án đang chạy đúng nhịp. ✓</div>}
          <ul className="bottleneck-list">
            {bottlenecks.map(({ p, round }) => {
              const stg = STAGES.find((s) => s.id === round.currentStage);
              return (
                <li key={p.id} className="bottleneck-item" onClick={() => goToProject(p.id)}>
                  <div className="bn-severity" data-high={round.daysInStage >= 5}><Clock size={14} /></div>
                  <div className="bn-body">
                    <div className="bn-name">{p.name} {round.number > 1 && <span className="round-inline-tag">Vòng {round.number}</span>}</div>
                    <div className="bn-meta">Đứng {round.daysInStage} ngày ở bước {round.currentStage} — {stg.label}</div>
                  </div>
                  <ChevronRight size={16} className="bn-chevron" />
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Tiến độ thu tiền theo dự án</h3>
        <div className="payment-list">
          {active.map((p) => {
            const rate = p.paymentTotal ? (p.paymentCollected / p.paymentTotal) * 100 : 0;
            return (
              <div className="payment-row" key={p.id} onClick={() => goToProject(p.id)}>
                <div className="payment-name">{p.name}</div>
                <ProgressBar pct={rate} tone={rate >= 80 ? "green" : rate >= 40 ? "amber" : "red"} />
                <div className="payment-figures"><span>{formatCompactVND(p.paymentCollected)}</span><span className="dim"> / {formatCompactVND(p.paymentTotal)}</span></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PROJECTS TAB — attachments, locking, round history                     */
/* ---------------------------------------------------------------------- */

function AttachmentBox({ stage, canUpload, canManage, isBOD, onUpload, onRemove, onToggleUnlock }) {
  return (
    <div className="attach-box">
      <div className="attach-head">
        <span className="attach-head-label"><Paperclip size={12} /> Tệp đính kèm</span>
        {stage.state === "done" && (
          <span className="lock-tag">
            {stage.unlockedForEdit ? <><Unlock size={11} /> Đang mở khóa</> : <><Lock size={11} /> Đã khóa</>}
          </span>
        )}
      </div>
      <div className="attach-list">
        {stage.attachments.length === 0 && <div className="attach-empty">Chưa có tệp nào.</div>}
        {stage.attachments.map((a) => (
          <div className="attach-item" key={a.id}>
            <FileText size={13} />
            <span className="attach-name">{a.name}</span>
            <span className="attach-meta">{(a.size / 1024).toFixed(0)} KB · {a.uploadedBy}</span>
            {a.dataUrl ? (
              <a className="icon-btn" href={a.dataUrl} download={a.name} title="Tải xuống"><Download size={12} /></a>
            ) : <span className="attach-sample dim">tệp mẫu</span>}
            {canManage && <button className="icon-btn" onClick={() => onRemove(a.id)} title="Xóa"><Trash2 size={12} /></button>}
          </div>
        ))}
      </div>
      {canUpload && (
        <label className="btn btn-outline btn-sm attach-upload">
          <Paperclip size={12} /> Đính kèm tệp (≤1.5MB)
          <input type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; if (f) onUpload(f); e.target.value = ""; }} />
        </label>
      )}
      {isBOD && stage.state === "done" && (
        <button className="btn btn-ghost btn-sm" onClick={onToggleUnlock}>
          {stage.unlockedForEdit ? <><Lock size={12} /> Khóa lại</> : <><Unlock size={12} /> Mở khóa để chỉnh sửa</>}
        </button>
      )}
    </div>
  );
}

function StageStepper({ project, round, isHistorical, currentRole, onAdvance, onApprove, onReject, onCompleteProject, onUpload, onRemove, onToggleUnlock }) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div className="stepper">
      {STAGES.map((s) => {
        const stage = round.stages[s.id];
        const isDone = stage.state === "done";
        const isRejected = stage.state === "rejected";
        const isCurrent = !isHistorical && round.currentStage === s.id && stage.state === "pending";
        const canAct = currentRole === s.who || currentRole === "BOD";
        const isBOD = currentRole === "BOD";
        const canUpload = !isHistorical && ((isCurrent) || (isDone && stage.unlockedForEdit));
        const revisionNote = !isHistorical && isCurrent ? stageRevisionNote(project, s.id) : null;

        return (
          <div className={`step ${isDone ? "step-done" : isRejected ? "step-rejected" : isCurrent ? "step-current" : "step-future"}`} key={s.id}>
            <div className="step-marker">
              {isDone ? <CircleCheck size={20} /> : isRejected ? <X size={20} /> : <Circle size={20} />}
              {s.id !== FINAL_STAGE_ID && <div className="step-connector" />}
            </div>
            <div className="step-content">
              <div className="step-head">
                <span className="step-num">Bước {s.id}</span>
                <span className="step-who">{ROLE_LABELS[s.who]}</span>
                {revisionNote && <span className="step-revision">{revisionNote}</span>}
              </div>
              <div className="step-title">{s.label}</div>
              <div className="step-desc">{s.desc}</div>

              {isDone && stage.completedAt && (
                <div className="step-meta">Hoàn thành {stage.completedAt} bởi {stage.completedBy}</div>
              )}
              {isRejected && (
                <div className="step-meta step-meta-rejected">KH chưa đồng ý ngày {stage.completedAt} — đã mở tiến trình điều chỉnh mới.</div>
              )}
              {s.id === HANDOFF_STAGE_ID && isDone && (
                <div className="step-meta step-meta-handoff"><ShieldCheck size={12} /> Đã chốt nghiệm thu — hồ sơ dự án đã được chuyển sang CRM CSKH để theo dõi bảo hành.</div>
              )}

              <AttachmentBox stage={stage} canUpload={canUpload} canManage={canUpload} isBOD={!isHistorical && isBOD}
                onUpload={(f) => onUpload(s.id, f)} onRemove={(id) => onRemove(s.id, id)} onToggleUnlock={() => onToggleUnlock(s.id)} />

              {isCurrent && s.id !== DECISION_STAGE_ID && project.status === "active" && !isHistorical && (
                canAct ? (
                  <button className="btn btn-primary btn-sm" onClick={() => onAdvance()}><Check size={14} /> Bấm hoàn thành</button>
                ) : (
                  <div className="perm-note">Chỉ {ROLE_LABELS[s.who]} hoặc BOD được thực hiện bước này. (Vai trò hiện tại: {ROLE_LABELS[currentRole]})</div>
                )
              )}

              {s.id === DECISION_STAGE_ID && isCurrent && project.status === "active" && !isHistorical && (
                canAct ? (
                  <div className="decision-box">
                    <div className="decision-label">Khách hàng phản hồi về báo giá:</div>
                    <div className="decision-row">
                      <button className="btn btn-primary btn-sm" onClick={() => onApprove()}><Check size={14} /> Đồng ý — Chuyển sang Ký hợp đồng</button>
                    </div>
                    {!showRejectForm ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowRejectForm(true)}><RotateCcw size={14} /> Chưa đồng ý — mở tiến trình điều chỉnh mới</button>
                    ) : (
                      <div className="reject-form">
                        <textarea className="input" rows={2} placeholder="Lý do KH yêu cầu điều chỉnh (VD: giảm giá, bổ sung hạng mục...)"
                          value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                        <div className="form-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => setShowRejectForm(false)}>Hủy</button>
                          <button className="btn btn-outline btn-sm" onClick={() => { onReject(rejectReason || "Không nêu lý do cụ thể."); setShowRejectForm(false); setRejectReason(""); }}>
                            Xác nhận mở tiến trình mới (Vòng {project.rounds.length + 1})
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : <div className="perm-note">Chỉ {ROLE_LABELS[s.who]} hoặc BOD được ghi nhận phản hồi KH ở bước này.</div>
              )}

              {s.id === FINAL_STAGE_ID && isDone && project.status === "active" && !isHistorical && (
                <div className="kickoff-box">
                  <ShieldCheck size={14} />
                  <span>Đã hoàn tất giai đoạn bảo hành.</span>
                  <button className="btn btn-outline btn-sm" onClick={onCompleteProject}>Đánh dấu hoàn tất dự án</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoundHistory({ project, currentRole }) {
  const [openId, setOpenId] = useState(null);
  if (project.rounds.length <= 1) return null;
  const pastRounds = project.rounds.slice(0, -1);
  return (
    <div className="round-history">
      <h4>Lịch sử tiến trình ({project.rounds.length} vòng)</h4>
      <p className="pane-sub" style={{ marginBottom: 10 }}>
        Mỗi lần khách hàng chưa đồng ý sẽ mở một tiến trình điều chỉnh mới, giữ nguyên lịch sử vòng trước để đối chiếu số lần thay đổi.
      </p>
      {pastRounds.map((r) => {
        const isOpen = openId === r.id;
        return (
          <div className="round-chip round-chip-archived" key={r.id}>
            <button className="round-chip-head" onClick={() => setOpenId(isOpen ? null : r.id)}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Vòng {r.number}</span>
              <span className={`round-outcome outcome-${r.outcome}`}>{r.outcome === "rejected" ? "KH chưa đồng ý" : "Đã duyệt"}</span>
              <span className="dim round-date">{r.createdAt}</span>
            </button>
            {r.reason && <div className="round-reason">Lý do: {r.reason}</div>}
            {isOpen && (
              <div className="round-body">
                <StageStepper project={project} round={r} isHistorical currentRole={currentRole}
                  onAdvance={() => {}} onApprove={() => {}} onReject={() => {}} onCompleteProject={() => {}}
                  onUpload={() => {}} onRemove={() => {}} onToggleUnlock={() => {}} />
              </div>
            )}
          </div>
        );
      })}
      <div className="round-chip round-chip-active">
        <div className="round-chip-head round-chip-head-static">
          <ChevronDown size={14} />
          <span>Vòng {project.rounds.length}</span>
          <span className="round-outcome outcome-current">Đang xử lý</span>
        </div>
      </div>
    </div>
  );
}

function RevenueEventForm({ onAdd }) {
  const [date, setDate] = useState(TODAY);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const submit = () => {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    onAdd(date, n, note.trim() || "Ghi nhận doanh thu");
    setAmount(""); setNote("");
  };
  return (
    <div className="revenue-event-form">
      <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
      <NumberInput className="input input-sm" value={amount} onChange={setAmount} placeholder="Số tiền (₫)" />
      <input className="input input-sm" placeholder="Ghi chú (VD: tạm ứng, thanh toán đợt 2...)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-outline btn-sm" onClick={submit}><Plus size={13} /> Ghi nhận</button>
    </div>
  );
}

function RevenueTimeline({ project, onAddEvent }) {
  const events = project.revenueEvents || [];
  return (
    <div className="panel-sub panel" style={{ marginTop: 12 }}>
      <h4 style={{ marginBottom: 10 }}>Lịch sử phát sinh doanh thu</h4>
      {events.length === 0 && <div className="empty-note">Chưa ghi nhận thời điểm phát sinh doanh thu nào.</div>}
      <div className="attach-list">
        {events.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((ev) => (
          <div className="revenue-event-item" key={ev.id}>
            <Calendar size={12} /> <span className="dim">{ev.date}</span>
            <strong>{formatVND(ev.amount)}</strong>
            <span className="dim">{ev.note}</span>
          </div>
        ))}
      </div>
      <RevenueEventForm onAdd={(date, amount, note) => onAddEvent(project.id, amount, date, note)} />
    </div>
  );
}

function ProjectDetail({ project, currentRole, updateProject, advanceStage, approveStage, rejectStage, completeProject, uploadAttachment, removeAttachment, toggleUnlockStage, addRevenueEvent }) {
  const [editingPayment, setEditingPayment] = useState(false);
  const [collected, setCollected] = useState(project.paymentCollected);
  useEffect(() => setCollected(project.paymentCollected), [project.id, project.paymentCollected]);

  const rate = project.paymentTotal ? (project.paymentCollected / project.paymentTotal) * 100 : 0;
  const debt = project.paymentTotal - project.paymentCollected;
  const round = getCurrentRound(project);

  const handleUpload = (stageId, file) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      alert("Tệp vượt quá 1.5MB cho bản demo này. Vui lòng chọn tệp nhỏ hơn.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => uploadAttachment(project.id, stageId, { name: file.name, size: file.size, dataUrl: reader.result, uploadedBy: currentRole, uploadedAt: TODAY });
    reader.readAsDataURL(file);
  };

  return (
    <div className="project-detail">
      <div className="pd-header">
        <div>
          <div className="pd-client"><Building2 size={13} /> {project.client}</div>
          <h2>{project.name}</h2>
        </div>
        <span className={`status-pill status-${project.status}`}>
          {project.status === "active" ? "Đang triển khai" : project.status === "completed" ? "Hoàn thành" : "Tạm dừng"}
        </span>
      </div>

      <div className="pd-scope"><h4>Phạm vi công việc</h4><p>{project.scope}</p></div>

      <div className="pd-payment panel-sub">
        <div className="pd-payment-head">
          <h4>Tiến độ thu tiền &amp; công nợ</h4>
          {!editingPayment ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditingPayment(true)}><PenLine size={13} /> Cập nhật</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => { updateProject(project.id, { paymentCollected: Number(collected) }); setEditingPayment(false); }}>
              <Save size={13} /> Lưu
            </button>
          )}
        </div>
        <ProgressBar pct={rate} tone={rate >= 80 ? "green" : rate >= 40 ? "amber" : "red"} />
        <div className="pd-payment-figures">
          <div><span className="dim">Đã thu</span>{editingPayment ? <NumberInput className="input input-sm" value={collected} onChange={setCollected} /> : <strong>{formatVND(project.paymentCollected)}</strong>}</div>
          <div><span className="dim">Tổng hợp đồng</span><strong>{formatVND(project.paymentTotal)}</strong></div>
          <div><span className="dim">Công nợ còn lại</span><strong className="figure-debt">{formatVND(debt)}</strong></div>
        </div>
      </div>

      <RevenueTimeline project={project} onAddEvent={addRevenueEvent} />

      <RoundHistory project={project} currentRole={currentRole} />

      <div className="pd-stages">
        <h4>Tiến độ triển khai {project.rounds.length > 1 && <span className="round-inline-tag">Vòng {project.rounds.length} (hiện tại)</span>}</h4>
        <StageStepper project={project} round={round} isHistorical={false} currentRole={currentRole}
          onAdvance={() => advanceStage(project.id)}
          onApprove={() => approveStage(project.id)}
          onReject={(reason) => rejectStage(project.id, reason)}
          onCompleteProject={() => completeProject(project.id)}
          onUpload={(stageId, file) => handleUpload(stageId, file)}
          onRemove={(stageId, attId) => removeAttachment(project.id, stageId, attId)}
          onToggleUnlock={(stageId) => toggleUnlockStage(project.id, stageId, currentRole)} />
      </div>
    </div>
  );
}

function NewProjectForm({ onCancel, onCreate, clients }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState(clients[0]?.company || "");
  const [scope, setScope] = useState("");
  const [total, setTotal] = useState("");
  const submit = () => { if (!name.trim()) return; onCreate({ name: name.trim(), client, scope: scope.trim(), paymentTotal: Number(total) || 0 }); };
  return (
    <div className="inline-form">
      <div className="form-row"><label>Tên dự án</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Showroom Nội thất..." /></div>
      <div className="form-row"><label>Khách hàng</label>
        <select className="input" value={client} onChange={(e) => setClient(e.target.value)}>
          {clients.map((c) => <option key={c.id} value={c.company}>{c.company}</option>)}
        </select>
      </div>
      <div className="form-row"><label>Phạm vi công việc</label><textarea className="input" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Mô tả ngắn gọn phạm vi thi công..." /></div>
      <div className="form-row"><label>Giá trị hợp đồng dự kiến (₫)</label><NumberInput className="input" value={total} onChange={setTotal} placeholder="0" /></div>
      <div className="form-actions"><button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button><button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Tạo dự án</button></div>
    </div>
  );
}

function ProjectsTab({ projects, clients, currentRole, selectedId, setSelectedId, updateProject, advanceStage, approveStage, rejectStage, completeProject, createProject, uploadAttachment, removeAttachment, toggleUnlockStage, addRevenueEvent }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const filtered = projects.filter((p) => filter === "all" ? true : p.status === filter);
  const selected = projects.find((p) => p.id === selectedId) || filtered[0];

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Dự án triển khai</h1><p className="pane-sub">Theo dõi tiến độ, thu tiền, tệp đính kèm và các vòng điều chỉnh của từng dự án.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm dự án</button>
      </div>

      {showForm && <NewProjectForm clients={clients} onCancel={() => setShowForm(false)} onCreate={(data) => { createProject(data); setShowForm(false); }} />}

      <div className="split">
        <div className="split-left">
          <div className="filter-tabs">
            {[["all", "Tất cả"], ["active", "Đang triển khai"], ["completed", "Hoàn thành"]].map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? "chip-active" : ""}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="project-list">
            {filtered.map((p) => {
              const round = getCurrentRound(p);
              const rate = p.paymentTotal ? (p.paymentCollected / p.paymentTotal) * 100 : 0;
              const flagged = p.status === "active" && round.daysInStage >= BOTTLENECK_THRESHOLD;
              return (
                <div key={p.id} className={`project-card ${selected?.id === p.id ? "project-card-active" : ""}`} onClick={() => setSelectedId(p.id)}>
                  <div className="project-card-top">
                    <span className="project-card-name">{p.name}</span>
                    {flagged && <AlertTriangle size={14} className="flag-icon" />}
                  </div>
                  <div className="project-card-client">{p.client}</div>
                  <div className="project-card-stage">
                    Bước {round.currentStage}/{FINAL_STAGE_ID} · {STAGES.find((s) => s.id === round.currentStage)?.label}
                    {p.rounds.length > 1 && <span className="round-inline-tag">Vòng {p.rounds.length}</span>}
                  </div>
                  <ProgressBar pct={rate} tone={rate >= 80 ? "green" : rate >= 40 ? "amber" : "red"} />
                </div>
              );
            })}
            {filtered.length === 0 && <div className="empty-note">Không có dự án nào.</div>}
          </div>
        </div>
        <div className="split-right">
          {selected ? (
            <ProjectDetail project={selected} currentRole={currentRole} updateProject={updateProject}
              advanceStage={advanceStage} approveStage={approveStage} rejectStage={rejectStage} completeProject={completeProject}
              uploadAttachment={uploadAttachment} removeAttachment={removeAttachment} toggleUnlockStage={toggleUnlockStage}
              addRevenueEvent={addRevenueEvent} />
          ) : <div className="empty-note">Chọn một dự án để xem chi tiết.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  CLIENTS TAB — multi-contact, tiers, drilldown                          */
/* ---------------------------------------------------------------------- */

function NewClientForm({ onCancel, onCreate }) {
  const [f, setF] = useState({ company: "", industry: "", accountOwner: "", tier: "normal", overview: "", advantage: "" });
  const [contacts, setContacts] = useState([{ id: uid("ct"), name: "", position: "", phone: "", isPrimary: true }]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const updateContact = (id, field, val) => setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [field]: val } : c));
  const setPrimary = (id) => setContacts((prev) => prev.map((c) => ({ ...c, isPrimary: c.id === id })));
  const addContact = () => setContacts((prev) => [...prev, { id: uid("ct"), name: "", position: "", phone: "", isPrimary: false }]);
  const removeContact = (id) => setContacts((prev) => prev.length > 1 ? prev.filter((c) => c.id !== id) : prev);

  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Doanh nghiệp</label><input className="input" value={f.company} onChange={set("company")} /></div>
        <div className="form-row"><label>Ngành hàng</label><input className="input" value={f.industry} onChange={set("industry")} /></div>
        <div className="form-row"><label>Người phụ trách (nội bộ)</label><input className="input" value={f.accountOwner} onChange={set("accountOwner")} placeholder="VD: Nguyễn Văn A (KD)" /></div>
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
        <button className="btn btn-primary btn-sm" onClick={() => f.company.trim() && onCreate({ ...f, contacts })}><Plus size={14} /> Thêm khách hàng</button>
      </div>
    </div>
  );
}

function ClientCard({ c, onOpen, onToggleTier }) {
  const primary = c.contacts.find((x) => x.isPrimary) || c.contacts[0];
  return (
    <div className="client-card" onClick={() => onOpen(c.id)}>
      <div className="client-card-top">
        <div className="client-avatar"><Building2 size={18} /></div>
        <div><div className="client-company">{c.company}</div><div className="client-industry">{c.industry}</div></div>
      </div>
      <div className="client-contact"><User size={13} /> {primary?.name} <span className="dim">· {primary?.position}</span></div>
      {c.contacts.length > 1 && <div className="client-contact dim">+{c.contacts.length - 1} người liên hệ khác</div>}
      <div className="client-contact"><ShieldCheck size={13} /> Phụ trách: {c.accountOwner}</div>
      <div className="client-block"><div className="client-block-label">Tổng quan &amp; tiềm năng</div><p>{c.overview}</p></div>
      <div className="client-block"><div className="client-block-label">Lợi thế hợp tác</div><p>{c.advantage}</p></div>
      <div className="client-card-foot">
        <TierBadge tier={c.tier} />
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onToggleTier(c.id); }}>
          Chuyển sang {c.tier === "high" ? "Bình thường" : "Cao"}
        </button>
      </div>
    </div>
  );
}

function ClientDetail({ client, projects, pipeline, onBack, goToProject }) {
  const relatedProjects = projects.filter((p) => p.client === client.company);
  const activeP = relatedProjects.filter((p) => p.status === "active");
  const doneP = relatedProjects.filter((p) => p.status === "completed");
  const relatedPipeline = pipeline.filter((i) => i.clientId === client.id);

  return (
    <div className="tab-pane">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12 }}><ChevronLeft size={14} /> Quay lại danh sách khách hàng</button>

      <div className="pane-header">
        <div>
          <div className="pd-client"><Building2 size={13} /> {client.industry}</div>
          <h1>{client.company}</h1>
          <p className="pane-sub">Phụ trách: {client.accountOwner}</p>
        </div>
        <TierBadge tier={client.tier} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 className="panel-title">Người liên hệ</h3>
          <div className="contact-list">
            {client.contacts.map((c) => (
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
          <div className="client-block"><div className="client-block-label">Tổng quan &amp; tiềm năng</div><p>{client.overview}</p></div>
          <div className="client-block"><div className="client-block-label">Lợi thế hợp tác</div><p>{client.advantage}</p></div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Công trình đang triển khai ({activeP.length})</h3>
        {activeP.length === 0 && <div className="empty-note">Chưa có công trình nào đang triển khai.</div>}
        {activeP.map((p) => (
          <div className="cd-project-item" key={p.id} onClick={() => goToProject(p.id)}>
            <span>{p.name}</span><span className="dim">Bước {getCurrentRound(p).currentStage}/{FINAL_STAGE_ID}</span><ChevronRight size={15} />
          </div>
        ))}
      </div>
      <div className="panel">
        <h3 className="panel-title">Công trình đã hoàn thành ({doneP.length})</h3>
        {doneP.length === 0 && <div className="empty-note">Chưa có công trình nào hoàn thành.</div>}
        {doneP.map((p) => (
          <div className="cd-project-item" key={p.id} onClick={() => goToProject(p.id)}>
            <span>{p.name}</span><span className="dim">{formatCompactVND(p.paymentTotal)}</span><ChevronRight size={15} />
          </div>
        ))}
      </div>
      <div className="panel">
        <h3 className="panel-title">Công trình dự kiến / đang trong Pipeline ({relatedPipeline.length})</h3>
        {relatedPipeline.length === 0 && <div className="empty-note">Chưa có công trình tiềm năng nào được liên kết với khách hàng này.</div>}
        {relatedPipeline.map((i) => (
          <div className="cd-project-item" key={i.id}>
            <span>{i.title}</span><span className="dim">{PIPELINE_STAGES.find((s) => s.key === i.stage)?.label} · {formatCompactVND(i.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientsTab({ clients, addClient, toggleClientTier, projects, pipeline, goToProject }) {
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [openClientId, setOpenClientId] = useState(null);

  const filtered = clients.filter((c) =>
    c.company.toLowerCase().includes(query.toLowerCase()) || c.contacts.some((ct) => ct.name.toLowerCase().includes(query.toLowerCase())));
  const high = filtered.filter((c) => c.tier === "high");
  const normal = filtered.filter((c) => c.tier === "normal");

  const openClient = clients.find((c) => c.id === openClientId);
  if (openClient) {
    return <ClientDetail client={openClient} projects={projects} pipeline={pipeline} onBack={() => setOpenClientId(null)} goToProject={goToProject} />;
  }

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Chân dung khách hàng</h1><p className="pane-sub">Tổng quan doanh nghiệp, người liên hệ và đánh giá lợi thế hợp tác.</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm khách hàng</button>
      </div>

      <div className="search-row"><Search size={15} /><input className="input input-plain" placeholder="Tìm theo tên doanh nghiệp hoặc người liên hệ..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>

      {showForm && <NewClientForm onCancel={() => setShowForm(false)} onCreate={(c) => { addClient(c); setShowForm(false); }} />}

      <div className="client-columns">
        <div className="client-col">
          <div className="client-col-head col-head-high">Tiềm năng Cao ({high.length})</div>
          <div className="client-col-body">
            {high.map((c) => <ClientCard key={c.id} c={c} onOpen={setOpenClientId} onToggleTier={toggleClientTier} />)}
            {high.length === 0 && <div className="empty-note">Không có khách hàng nào.</div>}
          </div>
        </div>
        <div className="client-col">
          <div className="client-col-head col-head-normal">Tiềm năng Bình thường ({normal.length})</div>
          <div className="client-col-body">
            {normal.map((c) => <ClientCard key={c.id} c={c} onOpen={setOpenClientId} onToggleTier={toggleClientTier} />)}
            {normal.length === 0 && <div className="empty-note">Không có khách hàng nào.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PIPELINE TAB — renamed, priority highlight, client link                */
/* ---------------------------------------------------------------------- */

function NewLeadForm({ onCancel, onCreate, clients }) {
  const [title, setTitle] = useState("");
  const [clientChoice, setClientChoice] = useState("__new__");
  const [newClientName, setNewClientName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    const isNew = clientChoice === "__new__";
    const clientObj = !isNew ? clients.find((c) => c.id === clientChoice) : null;
    onCreate({
      title: title.trim(),
      clientId: isNew ? null : clientChoice,
      clientName: isNew ? (newClientName.trim() || "Khách hàng mới") : clientObj.company,
      value: Number(value) || 0, note,
    });
  };

  return (
    <div className="inline-form">
      <div className="form-grid">
        <div className="form-row"><label>Tên công trình tiềm năng</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Nội thất 5 phòng khám" /></div>
        <div className="form-row"><label>Giá trị ước tính (₫)</label><NumberInput className="input" value={value} onChange={setValue} /></div>
        <div className="form-row"><label>Khách hàng</label>
          <select className="input" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
            <option value="__new__">-- Khách hàng mới --</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </div>
        {clientChoice === "__new__" && (
          <div className="form-row"><label>Tên khách hàng mới</label><input className="input" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} /></div>
        )}
      </div>
      <div className="form-row"><label>Ghi chú</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="form-actions"><button className="btn btn-ghost btn-sm" onClick={onCancel}>Hủy</button><button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Thêm vào Pipeline</button></div>
    </div>
  );
}

function PipelineTab({ pipeline, clients, movePipelineItem, addLead, removeLead, togglePriority }) {
  const [showForm, setShowForm] = useState(false);
  const dragId = useRef(null);
  const totalValue = pipeline.reduce((s, i) => s + i.value, 0);

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div><h1>Pipeline · Công trình tiềm năng</h1>
          <p className="pane-sub">{pipeline.length} công trình tiềm năng · tổng giá trị ước tính {formatCompactVND(totalValue)}. Kéo thả để chuyển bước.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> Thêm công trình tiềm năng</button>
      </div>

      {showForm && <NewLeadForm clients={clients} onCancel={() => setShowForm(false)} onCreate={(l) => { addLead(l); setShowForm(false); }} />}

      <div className="kanban">
        {PIPELINE_STAGES.map((col) => {
          const items = pipeline.filter((i) => i.stage === col.key);
          const colValue = items.reduce((s, i) => s + i.value, 0);
          return (
            <div className="kanban-col" key={col.key} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId.current) movePipelineItem(dragId.current, col.key); dragId.current = null; }}>
              <div className="kanban-col-head" style={{ borderColor: col.color }}><span>{col.label}</span><span className="kanban-count">{items.length}</span></div>
              <div className="kanban-col-sub">{formatCompactVND(colValue)}</div>
              <div className="kanban-items">
                {items.map((it) => (
                  <div className={`kanban-card ${it.priority ? "kanban-card-priority" : ""}`} key={it.id} draggable onDragStart={() => (dragId.current = it.id)}>
                    <div className="kanban-card-top">
                      <span>{it.title}</span>
                      <div className="kanban-card-actions">
                        <button className={`icon-btn ${it.priority ? "icon-btn-priority" : ""}`} title="Đánh dấu quan trọng" onClick={() => togglePriority(it.id)}><Flag size={12} /></button>
                        <button className="icon-btn" onClick={() => removeLead(it.id)}><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <div className="kanban-card-client">{it.clientId && <Link2 size={11} />} {it.clientName}</div>
                    <div className="kanban-card-value">{formatCompactVND(it.value)}</div>
                    {it.note && <div className="kanban-card-note">{it.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  SALES FORECAST TAB — grouped by industry → client                      */
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
/*  CRM CSKH TAB — hồ sơ bảo hành, tự động nhận từ bước Nghiệm thu          */
/* ---------------------------------------------------------------------- */

function CskhNoteForm({ onAdd }) {
  const [text, setText] = useState("");
  const submit = () => { if (text.trim()) { onAdd(text.trim()); setText(""); } };
  return (
    <div className="cskh-note-form">
      <input className="input input-sm" placeholder="Ghi chú chăm sóc / phản hồi bảo hành..." value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-outline btn-sm" onClick={submit}><Plus size={13} /> Ghi chú</button>
    </div>
  );
}

function CrmCskhTab({ crmCskh, addCskhNote, closeCskhRecord, goToProject }) {
  const [filter, setFilter] = useState("all");
  const filtered = crmCskh.filter((r) => (filter === "all" ? true : r.status === filter));
  const activeCount = crmCskh.filter((r) => r.status === "active").length;

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div>
          <h1>CRM CSKH · Theo dõi bảo hành</h1>
          <p className="pane-sub">Dự án tự động chuyển vào đây ngay khi chốt bước Nghiệm thu, để chăm sóc khách hàng trong giai đoạn Bảo hành.</p>
        </div>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <KPICard icon={ShieldCheck} tone="blue" label="Đang trong bảo hành" value={activeCount} />
        <KPICard icon={CircleCheck} tone="green" label="Đã hoàn tất bảo hành" value={crmCskh.length - activeCount} />
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
                <div className="pd-client"><Building2 size={13} /> {r.client}</div>
                <h3 style={{ margin: "2px 0" }}>{r.projectName}</h3>
              </div>
              <span className={`status-pill status-${r.status === "active" ? "active" : "completed"}`}>
                {r.status === "active" ? "Đang bảo hành" : "Đã hoàn tất"}
              </span>
            </div>
            <div className="cskh-meta">
              <span><Calendar size={13} /> Chuyển giao: {r.transferredAt}</span>
              <span><ShieldCheck size={13} /> Hạn bảo hành: {r.warrantyMonths} tháng (đến {warrantyEnd})</span>
              <button className="btn btn-ghost btn-sm" onClick={() => goToProject(r.projectId)}>Xem dự án <ChevronRight size={13} /></button>
              {r.status === "active" && (
                <button className="btn btn-outline btn-sm" onClick={() => closeCskhRecord(r.id)}>Đóng hồ sơ bảo hành</button>
              )}
            </div>
            <div className="cskh-notes">
              <div className="attach-head-label" style={{ marginBottom: 6 }}><PhoneCall size={12} /> Ghi chú chăm sóc</div>
              {r.notes.length === 0 && <div className="attach-empty">Chưa có ghi chú nào.</div>}
              {r.notes.map((n) => (
                <div className="cskh-note-item" key={n.id}><span className="dim">{n.date}</span> — {n.text}</div>
              ))}
              <CskhNoteForm onAdd={(text) => addCskhNote(r.id, text)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  SOP TAB — sơ đồ quy trình tổng, danh mục KH & công nợ theo công trình   */
/* ---------------------------------------------------------------------- */

function computeSopSteps(projects, clients, pipeline, crmCskh, sopManual) {
  const reached = (macroId) => projects.filter((p) => {
    if (p.status === "completed") return true;
    return getCurrentRound(p).currentStage >= macroId;
  }).length;
  const autoCounts = {
    leads: pipeline.length,
    crm: clients.length,
    sales_process: pipeline.filter((i) => i.stage !== "leads").length,
    quote: reached(3),
    contract: reached(4),
    construction: reached(5),
    acceptance: reached(6),
    warranty: crmCskh.length,
  };
  return SOP_FUNNEL_STEPS.map((s) => ({
    ...s,
    count: s.source === "manual" ? Number(sopManual[s.key]) || 0 : autoCounts[s.key] || 0,
  }));
}

function SopFunnel({ steps, sopManual, setSopManual }) {
  const maxCount = Math.max(1, ...steps.map((s) => s.count));
  const withConversion = steps.map((s, idx) => {
    const prev = idx === 0 ? null : steps[idx - 1];
    const conv = prev && prev.count > 0 ? (s.count / prev.count) * 100 : null;
    return { ...s, conv };
  });
  const bottlenecks = withConversion.filter((s) => s.conv !== null && s.conv < SOP_BOTTLENECK_CONVERSION);

  return (
    <div className="panel">
      <h3 className="panel-title">Sơ đồ quy trình SOP — từ Marketing đến KH quay lại</h3>
      <p className="pane-sub" style={{ marginBottom: 12 }}>
        Số có nền chấm là số nhập tay (chưa có nguồn dữ liệu kết nối trong app) — các số còn lại tính tự động từ Dự án/Khách hàng/Pipeline.
        % là tỉ lệ chuyển đổi so với chặng trước; chặng dưới {SOP_BOTTLENECK_CONVERSION}% được đánh dấu là điểm nghẽn.
      </p>
      <div className="sop-funnel">
        {withConversion.map((s) => (
          <div className={`sop-funnel-row ${s.conv !== null && s.conv < SOP_BOTTLENECK_CONVERSION ? "sop-funnel-row-bottleneck" : ""}`} key={s.key}>
            <div className="sop-funnel-label">{s.label}</div>
            <div className="funnel-track sop-funnel-track"><div className="funnel-fill" style={{ width: `${(s.count / maxCount) * 100}%` }} /></div>
            <div className="sop-funnel-count">
              {s.source === "manual" ? (
                <NumberInput className="input input-sm sop-manual-input" value={sopManual[s.key]} onChange={(v) => setSopManual((prev) => ({ ...prev, [s.key]: v }))} />
              ) : <span>{s.count}</span>}
            </div>
            <div className="sop-funnel-conv">
              {s.conv !== null ? (
                <span className={s.conv < SOP_BOTTLENECK_CONVERSION ? "sop-bottleneck-tag" : "dim"}>{s.conv.toFixed(0)}%</span>
              ) : <span className="dim">—</span>}
            </div>
          </div>
        ))}
      </div>

      {bottlenecks.length > 0 && (
        <div className="sop-bottleneck-summary">
          <AlertTriangle size={14} />
          <span>Điểm nghẽn cần chú ý: {bottlenecks.map((b) => b.label).join(", ")} — tỉ lệ chuyển đổi từ chặng trước đang dưới {SOP_BOTTLENECK_CONVERSION}%.</span>
        </div>
      )}
    </div>
  );
}

function SopClientRow({ client, projects, goToProject }) {
  const [open, setOpen] = useState(false);
  const [openProjectId, setOpenProjectId] = useState(null);
  const related = projects.filter((p) => p.client === client.company);
  const totalRevenue = related.reduce((s, p) => s + p.paymentCollected, 0);
  const totalDebt = related.reduce((s, p) => s + (p.paymentTotal - p.paymentCollected), 0);

  return (
    <div className="panel industry-panel">
      <button className="industry-row-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="industry-name">{client.company}</span>
        <span className="dim">{related.length} công trình</span>
        <span className="industry-figures">Doanh thu {formatCompactVND(totalRevenue)} · Công nợ {formatCompactVND(totalDebt)}</span>
      </button>
      {open && (
        <div className="industry-body">
          {related.length === 0 && <div className="empty-note">Chưa có công trình nào.</div>}
          {related.map((p) => {
            const debt = p.paymentTotal - p.paymentCollected;
            const isOpenP = openProjectId === p.id;
            return (
              <div key={p.id} className="sop-project-block">
                <div className="cd-project-item" onClick={() => setOpenProjectId(isOpenP ? null : p.id)}>
                  {isOpenP ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span>{p.name}</span>
                  <span className="dim">{formatCompactVND(p.paymentCollected)} / {formatCompactVND(p.paymentTotal)}</span>
                  <span className={debt > 0 ? "figure-debt" : "figure-pos"}>{debt > 0 ? `Còn nợ ${formatCompactVND(debt)}` : "Đã thu đủ"}</span>
                </div>
                {isOpenP && (
                  <div className="sop-project-detail">
                    <div className="sop-project-detail-head">
                      <span className={`status-pill status-${p.status}`}>{p.status === "active" ? "Đang triển khai" : "Hoàn thành"}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => goToProject(p.id)}>Xem trong Dự án <ChevronRight size={13} /></button>
                    </div>
                    <div className="attach-head-label" style={{ margin: "8px 0 4px" }}>Thời điểm phát sinh doanh thu</div>
                    {(p.revenueEvents || []).length === 0 && <div className="empty-note" style={{ padding: "4px 0" }}>Chưa có ghi nhận doanh thu.</div>}
                    <div className="attach-list">
                      {(p.revenueEvents || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((ev) => (
                        <div className="revenue-event-item" key={ev.id}>
                          <Calendar size={12} /> <span className="dim">{ev.date}</span><strong>{formatVND(ev.amount)}</strong><span className="dim">{ev.note}</span>
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

function SopTab({ projects, clients, pipeline, crmCskh, sopManual, setSopManual, goToProject }) {
  const steps = computeSopSteps(projects, clients, pipeline, crmCskh, sopManual);
  const totalRevenue = projects.reduce((s, p) => s + p.paymentCollected, 0);
  const totalDebt = projects.reduce((s, p) => s + (p.paymentTotal - p.paymentCollected), 0);

  return (
    <div className="tab-pane">
      <div className="pane-header">
        <div>
          <h1>Quy trình SOP</h1>
          <p className="pane-sub">Đánh giá tiềm năng và điểm nghẽn theo từng chặng của quy trình, cùng danh mục khách hàng và công nợ theo công trình.</p>
        </div>
      </div>

      <SopFunnel steps={steps} sopManual={sopManual} setSopManual={setSopManual} />

      <div className="panel">
        <h3 className="panel-title">Danh mục khách hàng</h3>
        <p className="pane-sub" style={{ marginBottom: 10 }}>Tổng công trình triển khai và doanh thu từng công trình — bấm vào một khách hàng, rồi vào từng công trình để xem chi tiết.</p>
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 14 }}>
          <KPICard icon={DollarSign} tone="green" label="Tổng doanh thu đã thu" value={formatCompactVND(totalRevenue)} />
          <KPICard icon={AlertTriangle} tone="amber" label="Tổng công nợ còn lại" value={formatCompactVND(totalDebt)} />
        </div>
      </div>

      {clients.map((c) => <SopClientRow key={c.id} client={c} projects={projects} goToProject={goToProject} />)}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  APP SHELL                                                              */
/* ---------------------------------------------------------------------- */

const NAV = [
  { key: "dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { key: "projects", label: "Dự án", icon: FolderKanban },
  { key: "clients", label: "Khách hàng", icon: Users },
  { key: "pipeline", label: "Pipeline", icon: GitBranch },
  { key: "cskh", label: "CRM CSKH", icon: PhoneCall },
  { key: "sop", label: "Quy trình SOP", icon: ListChecks },
  { key: "forecast", label: "Sales Forecast", icon: TrendingUp },
];

const STORAGE_KEY = "xdnt-dashboard-state-v2";

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [projects, setProjects] = useState(seedProjects);
  const [clients, setClients] = useState(seedClients);
  const [pipeline, setPipeline] = useState(seedPipeline);
  const [forecast, setForecast] = useState(seedForecast);
  const [crmCskh, setCrmCskh] = useState(seedCrmCskh);
  const [sopManual, setSopManual] = useState(seedSopManual);
  const [selectedProjectId, setSelectedProjectId] = useState("p1");
  const [currentRole, setCurrentRole] = useState("BOD");
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const data = JSON.parse(res.value);
          if (data.projects) setProjects(data.projects);
          if (data.clients) setClients(data.clients);
          if (data.pipeline) setPipeline(data.pipeline);
          if (data.forecast) setForecast(data.forecast);
          if (data.crmCskh) setCrmCskh(data.crmCskh);
          if (data.sopManual) setSopManual(data.sopManual);
        }
      } catch (e) { /* no saved state yet */ } finally { setLoaded(true); }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await storage.set(STORAGE_KEY, JSON.stringify({ projects, clients, pipeline, forecast, crmCskh, sopManual })); }
      catch (e) { /* ignore */ }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [projects, clients, pipeline, forecast, crmCskh, sopManual, loaded]);

  /* ---- project actions ---- */
  const updateProject = useCallback((id, patch) => setProjects((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p)), []);

  const patchLastRound = (rounds, fn) => {
    const idx = rounds.length - 1;
    const next = [...rounds];
    next[idx] = fn({ ...next[idx], stages: { ...next[idx].stages } });
    return next;
  };

  const advanceStage = useCallback((id) => {
    let crmToAdd = null;
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const rounds = patchLastRound(p.rounds, (round) => {
        const stageId = round.currentStage;
        round.stages[stageId] = { ...round.stages[stageId], state: "done", completedAt: TODAY, completedBy: currentRole };
        if (stageId < FINAL_STAGE_ID) {
          if (stageId === HANDOFF_STAGE_ID) {
            crmToAdd = { id: uid("crm"), projectId: p.id, projectName: p.name, client: p.client, transferredAt: TODAY, warrantyMonths: 12, status: "active", notes: [] };
          }
          round.currentStage = stageId + 1; round.daysInStage = 0;
        }
        return round;
      });
      return { ...p, rounds };
    }));
    if (crmToAdd) setCrmCskh((prev) => (prev.some((r) => r.projectId === crmToAdd.projectId) ? prev : [...prev, crmToAdd]));
  }, [currentRole]);

  const approveStage = useCallback((id) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const rounds = patchLastRound(p.rounds, (round) => {
        round.stages[DECISION_STAGE_ID] = { ...round.stages[DECISION_STAGE_ID], state: "done", completedAt: TODAY, completedBy: currentRole };
        round.outcome = "approved"; round.currentStage = DECISION_STAGE_ID + 1; round.daysInStage = 0;
        return round;
      });
      return { ...p, rounds };
    }));
  }, [currentRole]);

  const rejectStage = useCallback((id, reason) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const rounds = patchLastRound(p.rounds, (round) => {
        round.stages[DECISION_STAGE_ID] = { ...round.stages[DECISION_STAGE_ID], state: "rejected", completedAt: TODAY, completedBy: currentRole };
        round.outcome = "rejected"; round.stageStatus = "rejected";
        return round;
      });
      rounds.push(makeRound(rounds.length + 1, reason, TODAY));
      return { ...p, rounds };
    }));
  }, [currentRole]);

  const completeProject = useCallback((id) => setProjects((prev) => prev.map((p) => p.id === id ? { ...p, status: "completed" } : p)), []);

  const createProject = useCallback((data) => {
    const id = uid("p");
    setProjects((prev) => [...prev, { id, name: data.name, client: data.client, scope: data.scope, status: "active", paymentTotal: data.paymentTotal, paymentCollected: 0, revenueEvents: [], rounds: [makeRound(1)] }]);
    setSelectedProjectId(id);
  }, []);

  const addRevenueEvent = useCallback((id, amount, date, note) => {
    setProjects((prev) => prev.map((p) => p.id === id
      ? { ...p, paymentCollected: p.paymentCollected + amount, revenueEvents: [...(p.revenueEvents || []), { id: uid("rev"), date, amount, note }] }
      : p));
  }, []);

  /* ---- CRM CSKH actions ---- */
  const addCskhNote = useCallback((recordId, text) => {
    setCrmCskh((prev) => prev.map((r) => r.id === recordId ? { ...r, notes: [...r.notes, { id: uid("nt"), date: TODAY, text }] } : r));
  }, []);
  const closeCskhRecord = useCallback((recordId) => setCrmCskh((prev) => prev.map((r) => r.id === recordId ? { ...r, status: "completed" } : r)), []);

  const uploadAttachment = useCallback((id, stageId, meta) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const rounds = patchLastRound(p.rounds, (round) => {
        const stage = round.stages[stageId];
        round.stages[stageId] = { ...stage, attachments: [...stage.attachments, { id: uid("a"), ...meta }] };
        return round;
      });
      return { ...p, rounds };
    }));
  }, []);

  const removeAttachment = useCallback((id, stageId, attId) => {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const rounds = patchLastRound(p.rounds, (round) => {
        const stage = round.stages[stageId];
        round.stages[stageId] = { ...stage, attachments: stage.attachments.filter((a) => a.id !== attId) };
        return round;
      });
      return { ...p, rounds };
    }));
  }, []);

  const toggleUnlockStage = useCallback((id, stageId, role) => {
    if (role !== "BOD") return;
    setProjects((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const rounds = patchLastRound(p.rounds, (round) => {
        const stage = round.stages[stageId];
        round.stages[stageId] = { ...stage, unlockedForEdit: !stage.unlockedForEdit };
        return round;
      });
      return { ...p, rounds };
    }));
  }, []);

  /* ---- client actions ---- */
  const addClient = useCallback((c) => setClients((prev) => [...prev, { id: uid("c"), ...c }]), []);
  const toggleClientTier = useCallback((id) => setClients((prev) => prev.map((c) => c.id === id ? { ...c, tier: c.tier === "high" ? "normal" : "high" } : c)), []);

  /* ---- pipeline actions ---- */
  const movePipelineItem = useCallback((id, stage) => setPipeline((prev) => prev.map((i) => i.id === id ? { ...i, stage } : i)), []);
  const addLead = useCallback((l) => setPipeline((prev) => [...prev, { id: uid("lp"), stage: "leads", priority: false, ...l }]), []);
  const removeLead = useCallback((id) => setPipeline((prev) => prev.filter((i) => i.id !== id)), []);
  const togglePriority = useCallback((id) => setPipeline((prev) => prev.map((i) => i.id === id ? { ...i, priority: !i.priority } : i)), []);

  const goToProject = (id) => { setSelectedProjectId(id); setTab("projects"); };

  return (
    <div className="xdnt-app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">XD</div>
          <div className="brand-text"><div className="brand-title">XD · Nội Thất</div><div className="brand-sub">Quản lý triển khai dự án</div></div>
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
          <div className="foot-note">Vai trò quyết định bước nào bạn được phép hoàn thành, và chỉ BOD được mở khóa tệp đã duyệt. Dữ liệu được lưu tự động trên trình duyệt.</div>
        </div>
      </aside>

      <main className="main">
        {tab === "dashboard" && <DashboardTab projects={projects} goToProject={goToProject} />}
        {tab === "projects" && (
          <ProjectsTab projects={projects} clients={clients} currentRole={currentRole} selectedId={selectedProjectId} setSelectedId={setSelectedProjectId}
            updateProject={updateProject} advanceStage={advanceStage} approveStage={approveStage} rejectStage={rejectStage} completeProject={completeProject}
            createProject={createProject} uploadAttachment={uploadAttachment} removeAttachment={removeAttachment} toggleUnlockStage={toggleUnlockStage}
            addRevenueEvent={addRevenueEvent} />
        )}
        {tab === "clients" && <ClientsTab clients={clients} addClient={addClient} toggleClientTier={toggleClientTier} projects={projects} pipeline={pipeline} goToProject={goToProject} />}
        {tab === "pipeline" && <PipelineTab pipeline={pipeline} clients={clients} movePipelineItem={movePipelineItem} addLead={addLead} removeLead={removeLead} togglePriority={togglePriority} />}
        {tab === "cskh" && <CrmCskhTab crmCskh={crmCskh} addCskhNote={addCskhNote} closeCskhRecord={closeCskhRecord} goToProject={goToProject} />}
        {tab === "sop" && <SopTab projects={projects} clients={clients} pipeline={pipeline} crmCskh={crmCskh} sopManual={sopManual} setSopManual={setSopManual} goToProject={goToProject} />}
        {tab === "forecast" && <ForecastTab forecast={forecast} setForecast={setForecast} />}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  STYLES                                                                  */
/* ---------------------------------------------------------------------- */

