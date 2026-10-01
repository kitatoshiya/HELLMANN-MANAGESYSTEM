import React, { useState } from "react";
import {
  Building2,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Search,
  Users,
  Mail,
  Phone,
  Tag,
  FileText,
  AlertCircle,
  Save,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { AppTheme, Supplier, SupplierContact, INITIAL_DEFAULT_SUPPLIERS } from "../types";
import { saveSupplier, deleteSupplier } from "../lib/firebase";

interface SupplierMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  currentTheme: AppTheme;
  onSelectSupplierForInquiry?: (supplier: Supplier) => void;
}

const EMPTY_CONTACT: () => SupplierContact = () => ({
  id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
  name: "",
  email: "",
  phone: "",
  department: "",
  isPrimary: false,
});

export const SupplierMasterModal: React.FC<SupplierMasterModalProps> = ({
  isOpen,
  onClose,
  suppliers,
  currentTheme,
  onSelectSupplierForInquiry,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filtered suppliers
  const filteredSuppliers = suppliers.filter((s) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.code && s.code.toLowerCase().includes(q)) ||
      (s.notes && s.notes.toLowerCase().includes(q)) ||
      s.contacts.some(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          (c.department && c.department.toLowerCase().includes(q))
      )
    );
  });

  const handleStartCreate = () => {
    const newSup: Supplier = {
      id: `sup_${Date.now()}`,
      name: "",
      code: "",
      contacts: [
        {
          id: `c_${Date.now()}`,
          name: "",
          email: "",
          phone: "",
          department: "",
          isPrimary: true,
        },
      ],
      defaultCcEmails: [],
      defaultPattern: 1,
      defaultLanguage: "ja",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingSupplier(newSup);
    setIsCreating(true);
    setErrorMsg("");
  };

  const handleStartEdit = (supplier: Supplier) => {
    // Ensure contacts array is clone
    const clonedContacts = (supplier.contacts && supplier.contacts.length > 0
      ? supplier.contacts
      : [EMPTY_CONTACT()]
    ).map((c) => ({ ...c }));

    setEditingSupplier({
      ...supplier,
      contacts: clonedContacts,
      defaultCcEmails: supplier.defaultCcEmails ? [...supplier.defaultCcEmails] : [],
    });
    setIsCreating(false);
    setErrorMsg("");
  };

  const handleAddContact = () => {
    if (!editingSupplier) return;
    if (editingSupplier.contacts.length >= 5) {
      setErrorMsg("担当者は最大5名まで登録可能です。");
      return;
    }
    const newContact = EMPTY_CONTACT();
    if (editingSupplier.contacts.length === 0) {
      newContact.isPrimary = true;
    }
    setEditingSupplier({
      ...editingSupplier,
      contacts: [...editingSupplier.contacts, newContact],
    });
    setErrorMsg("");
  };

  const handleRemoveContact = (index: number) => {
    if (!editingSupplier) return;
    if (editingSupplier.contacts.length <= 1) {
      setErrorMsg("少なくとも1名の担当者枠が必要です。");
      return;
    }
    const nextContacts = editingSupplier.contacts.filter((_, i) => i !== index);
    if (!nextContacts.some((c) => c.isPrimary) && nextContacts.length > 0) {
      nextContacts[0].isPrimary = true;
    }
    setEditingSupplier({
      ...editingSupplier,
      contacts: nextContacts,
    });
    setErrorMsg("");
  };

  const handleContactChange = (index: number, field: keyof SupplierContact, value: any) => {
    if (!editingSupplier) return;
    const nextContacts = [...editingSupplier.contacts];
    if (field === "isPrimary" && value === true) {
      // Set others to false
      nextContacts.forEach((c, i) => {
        c.isPrimary = i === index;
      });
    } else {
      nextContacts[index] = { ...nextContacts[index], [field]: value };
    }
    setEditingSupplier({
      ...editingSupplier,
      contacts: nextContacts,
    });
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;

    if (!editingSupplier.name.trim()) {
      setErrorMsg("サプライヤー社名を入力してください。");
      return;
    }

    // Validate at least one valid contact email
    const validContacts = editingSupplier.contacts.filter(
      (c) => c.name.trim() !== "" || c.email.trim() !== ""
    );

    if (validContacts.length === 0) {
      setErrorMsg("担当者名またはメールアドレスを少なくとも1件入力してください。");
      return;
    }

    // Check email formats if provided
    for (const c of validContacts) {
      if (c.email.trim() && !c.email.includes("@")) {
        setErrorMsg(`「${c.name || "担当者"}」のメールアドレス形式が不正です (${c.email})。`);
        return;
      }
    }

    setIsSaving(true);
    try {
      await saveSupplier({
        ...editingSupplier,
        name: editingSupplier.name.trim(),
        code: editingSupplier.code?.trim() || "",
        contacts: validContacts,
        updatedAt: new Date().toISOString(),
      });
      setEditingSupplier(null);
      setIsCreating(false);
      setErrorMsg("");
    } catch (err: any) {
      setErrorMsg(`保存エラー: ${err.message || String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSupplier(id);
      setConfirmDeleteId(null);
      if (editingSupplier?.id === id) {
        setEditingSupplier(null);
      }
    } catch (err: any) {
      alert(`削除に失敗しました: ${err.message}`);
    }
  };

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
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight flex items-center gap-2">
                <span>サプライヤーマスタ管理</span>
                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 font-bold">
                  {suppliers.length}社 登録中
                </span>
              </h3>
              <p className="text-[11px] opacity-75">
                問い合わせ先の担当者（最大5名）とメールアドレス、定型CCを登録・管理します。
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

        {/* Content Body: Split list & editor if editing, or full list */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Column: Supplier List */}
          <div
            className={`flex flex-col border-r shrink-0 ${
              editingSupplier ? "w-full md:w-[360px] lg:w-[400px] hidden md:flex" : "w-full"
            } border-inherit`}
          >
            {/* Search & Add Bar */}
            <div className="p-3.5 border-b border-inherit space-y-2.5 shrink-0 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="社名、略称、担当者名、メールで検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium border ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                        : "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleStartCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-transform active:scale-95 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新規登録</span>
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
              {filteredSuppliers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <Building2 className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 stroke-1" />
                  <p className="font-bold">該当するサプライヤーが見つかりません</p>
                  <p className="text-[11px] opacity-70">
                    検索条件を変更するか、「新規登録」から新しいサプライヤーを追加してください。
                  </p>
                </div>
              ) : (
                filteredSuppliers.map((sup) => {
                  const isSelected = editingSupplier?.id === sup.id;
                  const primaryContact = sup.contacts.find((c) => c.isPrimary) || sup.contacts[0];

                  return (
                    <div
                      key={sup.id}
                      className={`p-3.5 rounded-xl border transition-all ${
                        isSelected
                          ? "ring-2 ring-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700"
                          : currentTheme === "light"
                          ? "bg-white hover:bg-slate-50 border-slate-200 shadow-xs"
                          : "bg-slate-800/60 hover:bg-slate-800 border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                              {sup.name}
                            </span>
                            {sup.code && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                {sup.code}
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 flex items-center gap-0.5">
                              <Users className="w-2.5 h-2.5" />
                              担当者 {sup.contacts.length}名
                            </span>
                          </div>

                          {/* Primary contact preview */}
                          {primaryContact && (
                            <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-800 dark:text-slate-100">
                                窓口: {primaryContact.name || "（名称未設定）"}
                              </span>
                              {primaryContact.email && (
                                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  &lt;{primaryContact.email}&gt;
                                </span>
                              )}
                              {primaryContact.phone && (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-0.5">
                                  <Phone className="w-2.5 h-2.5" /> {primaryContact.phone}
                                </span>
                              )}
                            </div>
                          )}

                          {/* All contacts pills if > 1 */}
                          {sup.contacts.length > 1 && (
                            <div className="flex items-center gap-1 flex-wrap pt-1">
                              {sup.contacts.map((c, i) => (
                                <span
                                  key={c.id || i}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    c.isPrimary
                                      ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 font-bold"
                                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                  }`}
                                  title={`${c.name || "担当者"} <${c.email}>`}
                                >
                                  {c.name || `担当者${i + 1}`}
                                </span>
                              ))}
                            </div>
                          )}

                          {sup.notes && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 pt-0.5">
                              📝 {sup.notes}
                            </p>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          {onSelectSupplierForInquiry && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectSupplierForInquiry(sup);
                                onClose();
                              }}
                              className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs flex items-center gap-1"
                              title="このサプライヤー宛てに問合せを作成"
                            >
                              <Mail className="w-3 h-3" />
                              <span>問合せ</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleStartEdit(sup)}
                            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                            title="編集"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(sup.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
                            title="削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Confirm delete prompt */}
                      {confirmDeleteId === sup.id && (
                        <div className="mt-2.5 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between gap-2 animate-in fade-in duration-100">
                          <span>本当に「{sup.name}」を削除しますか？</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDelete(sup.id)}
                              className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[11px] hover:bg-rose-700 cursor-pointer"
                            >
                              削除
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-[11px] hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Add / Edit Form */}
          {editingSupplier ? (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30 dark:bg-slate-950/20">
              <div
                className={`p-4 border-b flex items-center justify-between shrink-0 ${
                  currentTheme === "light"
                    ? "bg-white border-slate-200 text-slate-900"
                    : "bg-slate-900 border-slate-800 text-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm">
                      {isCreating ? "新規サプライヤー登録" : `サプライヤー編集: ${editingSupplier.name || "名称未定"}`}
                    </h4>
                    <p className="text-[11px] opacity-70">
                      問い合わせ窓口の担当者名とメールアドレス（最大5名）を登録してください。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingSupplier(null)}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  編集を閉じる
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveSupplier} className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar text-xs">
                  {errorMsg && (
                    <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {/* Basic Info */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                        <span>サプライヤー社名</span>
                        <span className="text-rose-500">*必須</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="例: ヤンマーエンジニアリング株式会社"
                        value={editingSupplier.name}
                        onChange={(e) =>
                          setEditingSupplier({ ...editingSupplier, name: e.target.value })
                        }
                        className={`w-full px-3 py-2 rounded-lg border font-bold ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-950 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-500"
                            : "bg-slate-800 border-slate-700 text-slate-100 focus:border-indigo-500"
                        }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200">
                        略称 / コード
                      </label>
                      <input
                        type="text"
                        placeholder="例: YANMAR"
                        value={editingSupplier.code || ""}
                        onChange={(e) =>
                          setEditingSupplier({ ...editingSupplier, code: e.target.value })
                        }
                        className={`w-full px-3 py-2 rounded-lg border font-mono ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-950"
                            : "bg-slate-800 border-slate-700 text-slate-100"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Contacts Section (Up to 5) */}
                  <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        <h5 className="font-extrabold text-sm text-indigo-950 dark:text-indigo-200">
                          問い合わせ先 担当者一覧（最大5名まで登録可能）
                        </h5>
                      </div>
                      <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                        登録枠: {editingSupplier.contacts.length} / 5
                      </span>
                    </div>

                    <div className="space-y-3">
                      {editingSupplier.contacts.map((contact, index) => (
                        <div
                          key={contact.id || index}
                          className={`p-3 rounded-lg border transition-all ${
                            contact.isPrimary
                              ? "bg-white dark:bg-slate-900 border-indigo-400 dark:border-indigo-600 shadow-xs ring-1 ring-indigo-400"
                              : "bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold text-[10px] flex items-center justify-center">
                                {index + 1}
                              </span>
                              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold">
                                <input
                                  type="radio"
                                  name="primaryContactRadio"
                                  checked={Boolean(contact.isPrimary)}
                                  onChange={() => handleContactChange(index, "isPrimary", true)}
                                  className="text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className={contact.isPrimary ? "text-indigo-600 dark:text-indigo-400 font-extrabold" : "text-slate-600 dark:text-slate-400"}>
                                  主担当（デフォルト選択）
                                </span>
                              </label>
                            </div>

                            {editingSupplier.contacts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveContact(index)}
                                className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 text-xs transition-colors"
                                title="この担当者枠を削除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                            <div className="space-y-1">
                              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                                担当者名 <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                placeholder="例: 山田 太郎"
                                value={contact.name}
                                onChange={(e) => handleContactChange(index, "name", e.target.value)}
                                className={`w-full px-2.5 py-1.5 rounded border text-xs font-medium ${
                                  currentTheme === "light"
                                    ? "bg-white border-slate-300 text-slate-900"
                                    : "bg-slate-800 border-slate-700 text-slate-100"
                                }`}
                              />
                            </div>

                            <div className="space-y-1 sm:col-span-1 md:col-span-2">
                              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1">
                                <Mail className="w-3 h-3 text-slate-400" />
                                メールアドレス <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="email"
                                placeholder="yamada@supplier.co.jp"
                                value={contact.email}
                                onChange={(e) => handleContactChange(index, "email", e.target.value)}
                                className={`w-full px-2.5 py-1.5 rounded border font-mono text-xs ${
                                  currentTheme === "light"
                                    ? "bg-white border-slate-300 text-slate-900"
                                    : "bg-slate-800 border-slate-700 text-slate-100"
                                }`}
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                                部署 / 役職 (任意)
                              </label>
                              <input
                                type="text"
                                placeholder="例: 舶用営業課"
                                value={contact.department || ""}
                                onChange={(e) => handleContactChange(index, "department", e.target.value)}
                                className={`w-full px-2.5 py-1.5 rounded border text-xs ${
                                  currentTheme === "light"
                                    ? "bg-white border-slate-300 text-slate-900"
                                    : "bg-slate-800 border-slate-700 text-slate-100"
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {editingSupplier.contacts.length < 5 && (
                      <button
                        type="button"
                        onClick={handleAddContact}
                        className="w-full py-2 rounded-lg border border-dashed border-indigo-400 dark:border-indigo-600 hover:bg-indigo-100/50 dark:hover:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>担当者を追加（最大5名まで、あと{5 - editingSupplier.contacts.length}名）</span>
                      </button>
                    )}
                  </div>

                  {/* Defaults & CC */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200">
                        定型CCアドレス (任意・カンマ区切り)
                      </label>
                      <input
                        type="text"
                        placeholder="cc1@partner.com, cc2@partner.com"
                        value={
                          Array.isArray(editingSupplier.defaultCcEmails)
                            ? editingSupplier.defaultCcEmails.join(", ")
                            : ""
                        }
                        onChange={(e) =>
                          setEditingSupplier({
                            ...editingSupplier,
                            defaultCcEmails: e.target.value
                              .split(/[,;]/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className={`w-full px-3 py-2 rounded-lg border font-mono ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-950"
                            : "bg-slate-800 border-slate-700 text-slate-100"
                        }`}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200">
                        標準問い合わせパターン
                      </label>
                      <select
                        value={editingSupplier.defaultPattern || 1}
                        onChange={(e) =>
                          setEditingSupplier({
                            ...editingSupplier,
                            defaultPattern: Number(e.target.value),
                          })
                        }
                        className={`w-full px-3 py-2 rounded-lg border font-bold ${
                          currentTheme === "light"
                            ? "bg-white border-slate-300 text-slate-950"
                            : "bg-slate-800 border-slate-700 text-slate-100"
                        }`}
                      >
                        <option value={1}>パターン①: 見積・納期問合せ</option>
                        <option value={2}>パターン②: 通関・技術問合せ</option>
                        <option value={3}>パターン③: 出荷確定連絡（向け地・FLAG等）</option>
                      </select>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-1">
                    <label className="font-bold text-slate-800 dark:text-slate-200">
                      特記事項 / サプライヤーメモ (定休日、リードタイム目安、電話連絡先等)
                    </label>
                    <textarea
                      rows={3}
                      placeholder="例: 主機・発電機部品。通常リードタイム2〜3営業日。至急時は03-xxxx-xxxxへ電話要。"
                      value={editingSupplier.notes || ""}
                      onChange={(e) =>
                        setEditingSupplier({ ...editingSupplier, notes: e.target.value })
                      }
                      className={`w-full px-3 py-2 rounded-lg border ${
                        currentTheme === "light"
                          ? "bg-white border-slate-300 text-slate-950"
                          : "bg-slate-800 border-slate-700 text-slate-100"
                      }`}
                    />
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
                  <button
                    type="button"
                    onClick={() => setEditingSupplier(null)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-800"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? "保存中..." : "サプライヤーを保存"}</span>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="hidden md:flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-400 space-y-3 bg-slate-50/20 dark:bg-slate-950/10">
              <Building2 className="w-12 h-12 text-indigo-300 dark:text-indigo-800 stroke-1" />
              <div>
                <h4 className="font-extrabold text-sm text-slate-700 dark:text-slate-300">
                  サプライヤーを選択して詳細を確認・編集
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1">
                  左の一覧からサプライヤーをクリックするか、右上の「新規登録」ボタンから新しくサプライヤーを追加できます。
                </p>
              </div>
              <button
                type="button"
                onClick={handleStartCreate}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-transform active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>新規サプライヤーを登録する</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
