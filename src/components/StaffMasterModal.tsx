import React, { useState } from "react";
import { X, UserPlus, Users, Trash2, Edit2, Check, UserCheck, Mail, Hash } from "lucide-react";
import { StaffMember } from "../types";

interface StaffMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffMembers: StaffMember[];
  onAddStaff: (staff: Omit<StaffMember, "id">) => void;
  onUpdateStaff: (staff: StaffMember) => void;
  onDeleteStaff: (id: string) => void;
}

export const StaffMasterModal: React.FC<StaffMasterModalProps> = ({
  isOpen,
  onClose,
  staffMembers,
  onAddStaff,
  onUpdateStaff,
  onDeleteStaff,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<StaffMember | null>(null);

  // Form states for new/edit staff
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");

  if (!isOpen) return null;

  const handleStartEdit = (staff: StaffMember) => {
    setEditingId(staff.id);
    setName(staff.name);
    setEmail(staff.email);
    setEmployeeNumber(staff.employeeNumber || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setName("");
    setEmail("");
    setEmployeeNumber("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      alert("担当者名とログインメールアドレスは必須入力です。");
      return;
    }

    if (editingId) {
      onUpdateStaff({
        id: editingId,
        name: name.trim(),
        email: email.trim(),
        employeeNumber: employeeNumber.trim() || undefined,
      });
      handleCancelEdit();
    } else {
      onAddStaff({
        name: name.trim(),
        email: email.trim(),
        employeeNumber: employeeNumber.trim() || undefined,
      });
      setName("");
      setEmail("");
      setEmployeeNumber("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 text-white border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-100">担当者マスタ管理</h2>
              <p className="text-xs text-slate-400 font-medium">
                社内担当者登録・編集・ログインメールアドレス設定
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] text-xs">
          
          {/* Add / Edit Form Box */}
          <form
            onSubmit={handleSubmit}
            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3"
          >
            <div className="flex items-center justify-between text-slate-900 dark:text-slate-100 font-extrabold text-xs border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                <UserPlus className="w-4 h-4" />
                {editingId ? "担当者情報の編集" : "新規担当者の登録"}
              </span>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-bold text-[11px]"
                >
                  新規登録モードに戻る
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  担当者名 <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <UserCheck className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="例: 喜多 健二"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  ログインメール <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    placeholder="kita@tac-japan.co.jp"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  社員番号 <span className="text-slate-400 font-normal">(任意)</span>
                </label>
                <div className="relative">
                  <Hash className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="例: EMP-001"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xs"
                >
                  キャンセル
                </button>
              )}
              <button
                type="submit"
                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-extrabold rounded-lg text-xs shadow-xs flex items-center gap-1 cursor-pointer transition-all"
              >
                <Check className="w-4 h-4" />
                <span>{editingId ? "更新保存" : "担当者を追加"}</span>
              </button>
            </div>
          </form>

          {/* Master Staff Table List */}
          <div className="space-y-2">
            <h3 className="font-extrabold text-slate-900 dark:text-slate-100 text-xs flex items-center justify-between">
              <span>登録済み担当者一覧 ({staffMembers.length} 名)</span>
            </h3>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs bg-white dark:bg-slate-900">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                    <th className="px-3 py-2">担当者名</th>
                    <th className="px-3 py-2">ログインメール</th>
                    <th className="px-3 py-2">社員番号</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200 font-medium">
                  {staffMembers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-400 font-bold">
                        登録された担当者がありません。「新規担当者の登録」から追加してください。
                      </td>
                    </tr>
                  ) : (
                    staffMembers.map((staff) => (
                      <tr
                        key={staff.id}
                        className={`hover:bg-sky-50/50 dark:hover:bg-slate-800/50 transition-colors ${
                          editingId === staff.id ? "bg-amber-50 dark:bg-amber-950/30" : ""
                        }`}
                      >
                        <td className="px-3 py-2 font-bold text-slate-900 dark:text-slate-100">
                          {staff.name}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                          {staff.email}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-500">
                          {staff.employeeNumber || "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleStartEdit(staff)}
                              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 text-sky-600 rounded transition-colors"
                              title="編集"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeletingStaff(staff)}
                              className="p-1 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-500 rounded transition-colors"
                              title="削除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Delete Confirmation Popup */}
        {deletingStaff && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/80 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                    担当者の削除確認
                  </h3>
                  <p className="text-xs text-slate-500">この操作は取り消せません</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  {deletingStaff.name}
                </div>
                <div className="text-slate-500 font-mono text-[11px]">
                  {deletingStaff.email}
                </div>
                {deletingStaff.employeeNumber && (
                  <div className="text-slate-500 font-mono text-[11px]">
                    社員番号: {deletingStaff.employeeNumber}
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                この担当者マスタ情報を削除しますか？（※割り当て済みの案件からは担当者設定が解除されます）
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeletingStaff(null)}
                  className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xs"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteStaff(deletingStaff.id);
                    setDeletingStaff(null);
                  }}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-lg text-xs shadow-md transition-all"
                >
                  削除する
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-bold shrink-0">
          <span className="text-slate-500">
            ※ 見積新規作成時やカードヘッダーで担当者を割り当て可能になります。
          </span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
