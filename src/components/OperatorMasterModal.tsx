import React, { useEffect, useState } from 'react';
import { Operator } from '../types';
import { fetchAllOperators, saveOperatorMaster, deleteOperatorMaster } from '../lib/operatorService';
import { Users, Plus, Save, Search, X, Check, Badge, Mail, UserCheck, Trash2, AlertTriangle } from 'lucide-react';

interface OperatorMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOperatorUpdated?: () => void;
}

export const OperatorMasterModal: React.FC<OperatorMasterModalProps> = ({ isOpen, onClose, onOperatorUpdated }) => {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // New/Edit Operator state
  const [editingEmail, setEditingEmail] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [empNumInput, setEmpNumInput] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // Delete confirm modal state
  const [deletingOp, setDeletingOp] = useState<Operator | null>(null);

  const loadData = async () => {
    setLoading(true);
    const data = await fetchAllOperators();
    setOperators(data);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEditClick = (op: Operator) => {
    setEditingEmail(op.email);
    setEmailInput(op.email);
    setNameInput(op.name);
    setEmpNumInput(op.employeeNumber || '');
    setShowAddForm(true);
  };

  const handleAddNewClick = () => {
    setEditingEmail('');
    setEmailInput('');
    setNameInput('');
    setEmpNumInput('');
    setShowAddForm(true);
  };

  const handleDeleteClick = (op: Operator) => {
    setDeletingOp(op);
  };

  const confirmDelete = async () => {
    if (!deletingOp) return;
    const targetEmail = deletingOp.email;
    const targetName = deletingOp.name;
    setDeletingOp(null);

    await deleteOperatorMaster(targetEmail);
    setSaveSuccess(`担当者「${targetName}」様を削除しました。`);
    setTimeout(() => setSaveSuccess(''), 2500);
    await loadData();
    if (onOperatorUpdated) onOperatorUpdated();
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !nameInput) return;

    const finalEmpNum = empNumInput.trim() || `EMP-${Math.floor(1000 + Math.random() * 9000)}`;

    const opToSave: Operator = {
      id: emailInput.trim().toLowerCase(),
      email: emailInput.trim().toLowerCase(),
      name: nameInput.trim(),
      employeeNumber: finalEmpNum,
      createdAt: new Date().toISOString(),
    };

    await saveOperatorMaster(opToSave);
    setSaveSuccess('担当者マスタを保存しました。');
    setTimeout(() => setSaveSuccess(''), 2500);

    setShowAddForm(false);
    await loadData();
    if (onOperatorUpdated) onOperatorUpdated();
  };

  const filteredOperators = operators.filter(
    (op) =>
      op.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      op.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (op.employeeNumber && op.employeeNumber.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl border border-slate-200 max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>担当者マスタ管理</span>
                <span className="px-2 py-0.5 bg-blue-900/60 text-blue-300 text-[10px] font-mono rounded border border-blue-700/50">
                  Firestore Master Sync
                </span>
              </h3>
              <p className="text-xs text-slate-400">ID (メールアドレス) • 氏名 • 社員番号の統合管理</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success Alert */}
        {saveSuccess && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-2.5 text-xs text-emerald-800 font-bold flex items-center space-x-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{saveSuccess}</span>
          </div>
        )}

        {/* Top Actions & Search Bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="氏名、ID、社員番号で検索..."
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="button"
            onClick={handleAddNewClick}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新規担当者を追加</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Add / Edit Form Modal Inner Drawer */}
          {showAddForm && (
            <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-700 shadow-md animate-in slide-in-from-top duration-150 mb-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs font-bold text-blue-300 flex items-center space-x-1.5">
                  <UserCheck className="w-4 h-4" />
                  <span>{editingEmail ? '担当者情報の編集' : '新規担当者登録'}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-slate-200 text-xs font-bold"
                >
                  キャンセル ✕
                </button>
              </div>

              <form onSubmit={handleSaveSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    ID (メールアドレス) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    disabled={!!editingEmail}
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="user@export-logistics.co.jp"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    氏名 (担当者名) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="例: 担当者氏名"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    社員番号 <span className="text-slate-500 font-normal">(任意)</span>
                  </label>
                  <input
                    type="text"
                    value={empNumInput}
                    onChange={(e) => setEmpNumInput(e.target.value)}
                    placeholder="例: EMP-1001 (省略可)"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div className="sm:col-span-2 flex justify-end space-x-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 text-slate-400 hover:text-white"
                  >
                    閉じる
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg flex items-center space-x-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>保存する</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Table List of Operators */}
          {loading ? (
            <div className="text-center py-8 text-xs text-slate-500">担当者マスタを読み込み中...</div>
          ) : filteredOperators.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">該当する担当者データが見つかりません。</div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">氏名</th>
                    <th className="py-3 px-4">ID (メールアドレス)</th>
                    <th className="py-3 px-4">社員番号</th>
                    <th className="py-3 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredOperators.map((op) => (
                    <tr key={op.email} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 flex items-center space-x-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs shrink-0">
                          {op.name.charAt(0)}
                        </div>
                        <span>{op.name}</span>
                      </td>

                      <td className="py-3 px-4 text-slate-600 font-mono">
                        <div className="flex items-center space-x-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{op.email}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                        <div className="flex items-center space-x-1">
                          <Badge className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>{op.employeeNumber || '-'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right flex items-center justify-end space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditClick(op)}
                          className="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 font-bold rounded-lg border border-blue-200 transition-colors cursor-pointer"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(op)}
                          className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 font-bold rounded-lg border border-red-200 transition-colors cursor-pointer flex items-center space-x-1"
                          title="この担当者を削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>削除</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </div>

      {/* Delete Confirmation Overlay Dialog */}
      {deletingOp && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-60 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <div className="w-10 h-10 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900">担当者削除の確認</h4>
                <p className="text-xs text-slate-500">この操作はマスタおよびDBから即座に削除されます</p>
              </div>
            </div>

            <div className="bg-red-50/70 border border-red-100 p-3 rounded-2xl text-xs text-slate-700 space-y-1">
              <div>
                <span className="font-bold text-slate-900">対象担当者: </span>
                <span className="font-bold text-red-700">{deletingOp.name}</span>
              </div>
              <div className="font-mono text-slate-600 text-[11px]">{deletingOp.email}</div>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              本当にこの担当者情報をマスタから削除してもよろしいですか？
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingOp(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-xl shadow-xs transition-all flex items-center space-x-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>削除を実行する</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
