import React, { useState } from "react";
import {
  FileCode,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Check,
  X,
  Sparkles,
  AlertCircle,
  HelpCircle,
  Eye,
  Edit3,
} from "lucide-react";
import { AppTheme, SupplierInquiryTemplate, StaffMember, DEFAULT_SUPPLIER_TEMPLATES } from "../types";
import { saveEmailTemplate, deleteEmailTemplate, resetDefaultEmailTemplates } from "../lib/firebase";
import { UnifiedRichEditor } from "./UnifiedRichEditor";

interface EmailTemplateSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: SupplierInquiryTemplate[];
  currentTheme: AppTheme;
  staffMembers: StaffMember[];
}

const PLACEHOLDER_TAGS = [
  { tag: "{vesselName}", label: "本船名", desc: "例: M/T PACIFIC LEADER" },
  { tag: "{orderNo}", label: "オーダーNo", desc: "例: ORD-2026-0914" },
  { tag: "{supplierName}", label: "サプライヤー社名", desc: "例: ヤンマーエンジニアリング株式会社" },
  { tag: "{contactName}", label: "担当者名", desc: "例: 田中 健一" },
  { tag: "{invoiceNo}", label: "インボイスNo", desc: "例: INV-TAC-8890" },
  { tag: "{destination}", label: "向け地", desc: "例: SIN (Singapore)" },
  { tag: "{customsDate}", label: "通関予定日", desc: "例: 2026-09-20" },
  { tag: "{flag}", label: "船籍(FLAG)", desc: "例: Panama" },
  { tag: "{deliveryDate}", label: "希望納期", desc: "例: 2026-09-25" },
  { tag: "{inquiryDetails}", label: "問合せ詳細・質疑貼付枠", desc: "コピペされた質問内容・対象品目" },
];

export const EmailTemplateSettingsModal: React.FC<EmailTemplateSettingsModalProps> = ({
  isOpen,
  onClose,
  templates,
  currentTheme,
  staffMembers,
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    templates[0]?.id || "tpl_pattern_1_quote"
  );
  const [editingTemplate, setEditingTemplate] = useState<SupplierInquiryTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<"visual" | "html" | "preview">("visual");
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Sync editing state when selectedTemplateId changes
  React.useEffect(() => {
    const target = templates.find((t) => t.id === selectedTemplateId) || templates[0];
    if (target) {
      setEditingTemplate({ ...target });
    }
  }, [selectedTemplateId, templates]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;

    if (!editingTemplate.title.trim()) {
      setErrorMsg("テンプレート名を入力してください。");
      return;
    }
    if (!editingTemplate.subjectTemplate.trim()) {
      setErrorMsg("件名ひな型を入力してください。");
      return;
    }

    setIsSaving(true);
    setErrorMsg("");
    try {
      await saveEmailTemplate({
        ...editingTemplate,
        updatedAt: new Date().toISOString(),
      });
      setSuccessMsg("テンプレートを保存しました！");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setErrorMsg(`保存失敗: ${err.message || String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    setIsSaving(true);
    try {
      await resetDefaultEmailTemplates();
      setShowResetConfirm(false);
      setSuccessMsg("初期標準テンプレートにリセットしました！");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setErrorMsg(`リセット失敗: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNewTemplate = () => {
    const nextPatternNum = Math.max(...templates.map((t) => t.patternNumber), 3) + 1;
    const newTpl: SupplierInquiryTemplate = {
      id: `tpl_custom_${Date.now()}`,
      patternNumber: nextPatternNum,
      category: "custom",
      title: `パターン${nextPatternNum}: 新規カスタム問合せ`,
      description: "業務に応じた専用の問合せひな型です。",
      subjectTemplate: "【問合せ】本船: {vesselName} / オーダーNo: {orderNo}",
      bodyHtmlTemplate: `
<p>{supplierName}<br><strong>{contactName} 様</strong></p>
<p><br></p>
<p>いつも大変お世話になっております。<br>株式会社タクト・ジャパン シップスチームでございます。</p>
<p><br></p>
<p>標記の本船オーダーにつきまして、下記のとおりご連絡・お問い合わせ申し上げます。</p>
<p><br></p>
<div style="background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 12px 0;">
  <strong>【ご連絡・お問合せ内容】</strong>
  <div style="margin-top: 6px;">{inquiryDetails}</div>
</div>
<p><br></p>
<p>ご確認のほど何卒よろしくお願い申し上げます。</p>
      `.trim(),
      updatedAt: new Date().toISOString(),
    };
    setSelectedTemplateId(newTpl.id);
    setEditingTemplate(newTpl);
  };

  const handleDeleteCustomTemplate = async (templateId: string) => {
    if (!confirm("このカスタムテンプレートを削除しますか？")) return;
    try {
      await deleteEmailTemplate(templateId);
      const remaining = templates.filter((t) => t.id !== templateId);
      if (remaining.length > 0) {
        setSelectedTemplateId(remaining[0].id);
      }
    } catch (e: any) {
      alert(`削除エラー: ${e.message}`);
    }
  };

  const insertTagToSubject = (tag: string) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      subjectTemplate: editingTemplate.subjectTemplate + " " + tag,
    });
  };

  const insertTagToBody = (tag: string) => {
    if (!editingTemplate) return;
    setEditingTemplate({
      ...editingTemplate,
      bodyHtmlTemplate: editingTemplate.bodyHtmlTemplate + ` <strong>${tag}</strong> `,
    });
  };

  // Generate a live preview with sample variables replaced
  const previewSubject = (editingTemplate?.subjectTemplate || "")
    .replace(/{vesselName}/g, "M/T PACIFIC LEADER")
    .replace(/{orderNo}/g, "ORD-2026-0914-TK")
    .replace(/{invoiceNo}/g, "INV-TAC-8890")
    .replace(/{destination}/g, "SIN (Singapore)")
    .replace(/{customsDate}/g, "2026-09-20")
    .replace(/{flag}/g, "Panama")
    .replace(/{deliveryDate}/g, "2026-09-25")
    .replace(/{supplierName}/g, "ヤンマーエンジニアリング株式会社")
    .replace(/{contactName}/g, "田中 健一");

  const previewBodyHtml = (editingTemplate?.bodyHtmlTemplate || "")
    .replace(/{vesselName}/g, "M/T PACIFIC LEADER")
    .replace(/{orderNo}/g, "ORD-2026-0914-TK")
    .replace(/{invoiceNo}/g, "INV-TAC-8890")
    .replace(/{destination}/g, "SIN (Singapore)")
    .replace(/{customsDate}/g, "2026-09-20")
    .replace(/{flag}/g, "Panama")
    .replace(/{deliveryDate}/g, "2026-09-25")
    .replace(/{supplierName}/g, "ヤンマーエンジニアリング株式会社")
    .replace(/{contactName}/g, "田中 健一")
    .replace(
      /{inquiryDetails}/g,
      "・CYLINDER LINER (Part No: YN-12044) x 2 SETS<br>・PISTON RING SET (Part No: YN-88210) x 4 SETS<br>※通関申告用に該非判定書および最新価格・納期の回答をお願いいたします。"
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-5xl rounded-2xl shadow-2xl border flex flex-col overflow-hidden max-h-[92vh] ${
          currentTheme === "light"
            ? "bg-white border-slate-300 text-slate-900"
            : currentTheme === "digital"
            ? "bg-[#04170e] border-emerald-900 text-emerald-300"
            : "bg-slate-900 border-slate-800 text-slate-100"
        }`}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between shrink-0 ${
            currentTheme === "light"
              ? "bg-slate-100 border-slate-200 text-slate-900"
              : "bg-slate-800/90 border-slate-700 text-white"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight flex items-center gap-2">
                <span>サプライヤー問合せ ひな型カスタム設定</span>
                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-bold">
                  {templates.length}パターン
                </span>
              </h3>
              <p className="text-[11px] opacity-75">
                見積依頼、通関質疑、出荷確定連絡（向け地・通関日・船籍FLAG）の定型文を自由にカスタマイズできます。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left: Template List Tabs */}
          <div
            className={`w-full md:w-[280px] lg:w-[320px] flex flex-col border-r shrink-0 border-inherit bg-slate-50/50 dark:bg-slate-950/40`}
          >
            <div className="p-3 border-b border-inherit flex items-center justify-between shrink-0">
              <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">
                テンプレート一覧
              </span>
              <button
                type="button"
                onClick={handleCreateNewTemplate}
                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>追加</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
              {templates.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      isSelected
                        ? "bg-blue-50/90 dark:bg-blue-950/50 border-blue-400 dark:border-blue-600 ring-1 ring-blue-400 shadow-xs"
                        : currentTheme === "light"
                        ? "bg-white hover:bg-slate-50 border-slate-200"
                        : "bg-slate-800/60 hover:bg-slate-800 border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
                          {tpl.patternNumber}
                        </span>
                        <span className="font-extrabold text-xs text-slate-900 dark:text-white line-clamp-1">
                          {tpl.title}
                        </span>
                      </div>
                      {tpl.isDefault && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                          標準
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {tpl.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Reset to defaults button */}
            <div className="p-3 border-t border-inherit bg-slate-100/60 dark:bg-slate-900/60 shrink-0">
              {showResetConfirm ? (
                <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-xs space-y-2 animate-in fade-in">
                  <p className="font-bold text-amber-900 dark:text-amber-200 text-[11px]">
                    標準3パターンを初期設定に復元しますか？
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleResetDefaults}
                      className="px-2 py-1 rounded bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 cursor-pointer"
                    >
                      初期化実行
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowResetConfirm(false)}
                      className="px-2 py-1 rounded border text-[11px] hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>初期標準ひな型に戻す</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: Editor Area */}
          {editingTemplate ? (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/20 dark:bg-slate-950/10">
              {/* Notifications */}
              {successMsg && (
                <div className="p-2.5 mx-4 mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center gap-2 animate-in fade-in">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}
              {errorMsg && (
                <div className="p-2.5 mx-4 mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 text-rose-800 dark:text-rose-200 text-xs font-bold flex items-center gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Form Content */}
              <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 custom-scrollbar text-xs">
                  {/* Title & Category */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                        <span>テンプレート名称</span>
                        <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={editingTemplate.title}
                        onChange={(e) =>
                          setEditingTemplate({ ...editingTemplate, title: e.target.value })
                        }
                        className={`w-full px-3 py-1.5 rounded-lg border font-bold ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-950"
                            : "bg-slate-800 border-slate-700 text-slate-100"
                        }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200">
                        パターン番号
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={editingTemplate.patternNumber}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            patternNumber: Number(e.target.value),
                          })
                        }
                        className={`w-full px-3 py-1.5 rounded-lg border font-bold font-mono ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-950"
                            : "bg-slate-800 border-slate-700 text-slate-100"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-1">
                    <label className="font-bold text-slate-800 dark:text-slate-200">
                      用途・説明
                    </label>
                    <input
                      type="text"
                      value={editingTemplate.description}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, description: e.target.value })
                      }
                      placeholder="このテンプレートを使用するシチュエーション"
                      className={`w-full px-3 py-1.5 rounded-lg border ${
                        currentTheme === "light"
                          ? "bg-white border-slate-300 text-slate-950"
                          : "bg-slate-800 border-slate-700 text-slate-100"
                      }`}
                    />
                  </div>

                  {/* Subject Template */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                        <span>件名ひな型 (Subject)</span>
                        <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[11px] text-slate-500">
                        ※下記の自動置換タグを件名に挿入できます
                      </span>
                    </div>
                    <input
                      type="text"
                      required
                      value={editingTemplate.subjectTemplate}
                      onChange={(e) =>
                        setEditingTemplate({
                          ...editingTemplate,
                          subjectTemplate: e.target.value,
                        })
                      }
                      className={`w-full px-3 py-2 rounded-lg border font-bold ${
                        currentTheme === "light"
                          ? "bg-white border-slate-300 text-slate-950 font-mono"
                          : "bg-slate-800 border-slate-700 text-slate-100 font-mono"
                      }`}
                    />
                  </div>

                  {/* Placeholder Insert Toolbar */}
                  <div className="p-2.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-blue-900 dark:text-blue-200">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      <span>ワンクリックで自動置換タグを挿入:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PLACEHOLDER_TAGS.map((item) => (
                        <div key={item.tag} className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => insertTagToSubject(item.tag)}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/80 text-blue-800 dark:text-blue-200 transition-colors cursor-pointer shadow-2xs"
                            title={`件名に ${item.tag} (${item.desc}) を挿入`}
                          >
                            +件名: {item.label}
                          </button>
                          <button
                            type="button"
                            onClick={() => insertTagToBody(item.tag)}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-800 dark:text-indigo-200 transition-colors cursor-pointer shadow-2xs"
                            title={`本文に ${item.tag} (${item.desc}) を挿入`}
                          >
                            +本文
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Body Editor Tabs */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-800 dark:text-slate-200">
                        メール本文ひな型 (Body HTML)
                      </label>
                      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-200 dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => setActiveTab("visual")}
                          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                            activeTab === "visual"
                              ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          <Edit3 className="w-3 h-3 inline mr-1" />
                          リッチ編集
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab("html")}
                          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                            activeTab === "html"
                              ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          <FileCode className="w-3 h-3 inline mr-1" />
                          HTMLソース
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab("preview")}
                          className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                            activeTab === "preview"
                              ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          <Eye className="w-3 h-3 inline mr-1" />
                          プレビュー
                        </button>
                      </div>
                    </div>

                    {activeTab === "visual" && (
                      <UnifiedRichEditor
                        value={editingTemplate.bodyHtmlTemplate}
                        onChange={(html) =>
                          setEditingTemplate({ ...editingTemplate, bodyHtmlTemplate: html })
                        }
                        placeholder="テンプレート本文を入力..."
                        minHeight="260px"
                        staffMembers={staffMembers}
                      />
                    )}

                    {activeTab === "html" && (
                      <textarea
                        rows={12}
                        value={editingTemplate.bodyHtmlTemplate}
                        onChange={(e) =>
                          setEditingTemplate({
                            ...editingTemplate,
                            bodyHtmlTemplate: e.target.value,
                          })
                        }
                        className={`w-full p-3 rounded-lg border font-mono text-xs leading-relaxed ${
                          currentTheme === "light"
                            ? "bg-slate-900 text-emerald-400 border-slate-700"
                            : "bg-black text-emerald-400 border-slate-800"
                        }`}
                      />
                    )}

                    {activeTab === "preview" && (
                      <div className="p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 space-y-3">
                        <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-900 font-mono text-xs border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 font-bold">件名プレビュー: </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {previewSubject}
                          </span>
                        </div>
                        <div
                          className="p-3 border rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 preview-content"
                          dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div
                  className={`px-5 py-3 border-t flex items-center justify-between shrink-0 ${
                    currentTheme === "light"
                      ? "bg-slate-100 border-slate-200"
                      : "bg-slate-900 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {!editingTemplate.isDefault && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomTemplate(editingTemplate.id)}
                        className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-bold cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                        削除
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-800"
                    >
                      閉じる
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSaving ? "保存中..." : "テンプレートを保存"}</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
