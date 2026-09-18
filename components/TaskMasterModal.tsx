import React, { useEffect, useState } from 'react';
import { TaskMaster } from '../types';
import {
  fetchAllTaskMasters,
  saveTaskMaster,
  deleteTaskMaster,
} from '../lib/taskMasterService';
import {
  ListChecks,
  Plus,
  Save,
  X,
  Check,
  Trash2,
  Edit2,
  AlertTriangle,
  Flame,
  CheckSquare,
  Square,
  ArrowUpDown,
} from 'lucide-react';

interface TaskMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskMasterUpdated?: () => void;
}

export const TaskMasterModal: React.FC<TaskMasterModalProps> = ({
  isOpen,
  onClose,
  onTaskMasterUpdated,
}) => {
  const [taskMasters, setTaskMasters] = useState<TaskMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [orderInput, setOrderInput] = useState<number>(1);
  const [shortNameInput, setShortNameInput] = useState('');
  const [contentInput, setContentInput] = useState('');
  const [isDgOnlyInput, setIsDgOnlyInput] = useState(false);
  const [autoIncludeInput, setAutoIncludeInput] = useState(true);

  // Delete Confirm State
  const [deletingTm, setDeletingTm] = useState<TaskMaster | null>(null);

  const loadData = async () => {
    setLoading(true);
    const data = await fetchAllTaskMasters();
    setTaskMasters(data);
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddNewClick = () => {
    setEditingId(null);
    const nextOrder = taskMasters.length > 0 ? Math.max(...taskMasters.map((t) => t.orderNumber)) + 1 : 1;
    setOrderInput(nextOrder);
    setShortNameInput('');
    setContentInput('');
    setIsDgOnlyInput(false);
    setAutoIncludeInput(true);
    setShowAddForm(true);
  };

  const handleEditClick = (tm: TaskMaster) => {
    setEditingId(tm.id);
    setOrderInput(tm.orderNumber);
    setShortNameInput(tm.shortName);
    setContentInput(tm.content);
    setIsDgOnlyInput(tm.isDgOnly);
    setAutoIncludeInput(tm.autoInclude);
    setShowAddForm(true);
  };

  const handleDeleteClick = (tm: TaskMaster) => {
    setDeletingTm(tm);
  };

  const confirmDelete = async () => {
    if (!deletingTm) return;
    const targetId = deletingTm.id;
    const targetName = deletingTm.shortName;
    setDeletingTm(null);

    await deleteTaskMaster(targetId);
    setSaveSuccess(`工程タスク「${targetName}」を削除しました。`);
    setTimeout(() => setSaveSuccess(''), 2500);
    await loadData();
    if (onTaskMasterUpdated) onTaskMasterUpdated();
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shortNameInput.trim() || !contentInput.trim()) return;

    const itemToSave: TaskMaster = {
      id: editingId || `task_m_${Date.now()}`,
      orderNumber: Number(orderInput) || 1,
      shortName: shortNameInput.trim().slice(0, 5),
      content: contentInput.trim().slice(0, 20),
      isDgOnly: isDgOnlyInput,
      autoInclude: autoIncludeInput,
    };

    await saveTaskMaster(itemToSave);
    setSaveSuccess('作業工程タスクマスタを保存しました。');
    setTimeout(() => setSaveSuccess(''), 2500);

    setShowAddForm(false);
    await loadData();
    if (onTaskMasterUpdated) onTaskMasterUpdated();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl border border-slate-200 max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <ListChecks className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>作業工程タスクマスタ管理</span>
                <span className="px-2 py-0.5 bg-indigo-900/60 text-indigo-300 text-[10px] font-mono rounded border border-indigo-700/50">
                  Global Workflow Sync
                </span>
              </h3>
              <p className="text-xs text-slate-400">PDF取り込み時の初期タスク生成ルール & 優先順位管理</p>
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

        {/* Top Action Bar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-xs text-slate-600 font-medium">
            全端末共有マスタ • 優先順位（№）順にソートされて自動初期反映されます
          </div>

          <button
            type="button"
            onClick={handleAddNewClick}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新規作業工程タスクを追加</span>
          </button>
        </div>

        {/* Form Drawer */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {showAddForm && (
            <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-700 shadow-md animate-in slide-in-from-top duration-150 mb-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-xs font-bold text-indigo-300 flex items-center space-x-1.5">
                  <ListChecks className="w-4 h-4" />
                  <span>{editingId ? '作業工程タスクの編集' : '新規作業工程タスク登録'}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-slate-200 text-xs font-bold cursor-pointer"
                >
                  キャンセル ✕
                </button>
              </div>

              <form onSubmit={handleSaveSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    № (作業工程優先順位) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={orderInput}
                    onChange={(e) => setOrderInput(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    作業短縮文字 (PDF表示用・5文字以下) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={5}
                    required
                    value={shortNameInput}
                    onChange={(e) => setShortNameInput(e.target.value)}
                    placeholder="例: SI確認, 通関申告"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                  />
                  <div className="text-[10px] text-slate-400 text-right mt-0.5">
                    {shortNameInput.length} / 5文字
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    作業内容 (明確に記載・20文字以下) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    required
                    value={contentInput}
                    onChange={(e) => setContentInput(e.target.value)}
                    placeholder="例: 輸出通関申告書類作成・税関提出"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
                  />
                  <div className="text-[10px] text-slate-400 text-right mt-0.5">
                    {contentInput.length} / 20文字
                  </div>
                </div>

                {/* Flags Toggles */}
                <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white block text-xs flex items-center">
                      <Flame className="w-3.5 h-3.5 text-amber-400 mr-1" /> DG設定 (危険物専用)
                    </span>
                    <span className="text-[10px] text-slate-400">DG（危険物）貨物の時のみ表示する</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={isDgOnlyInput}
                    onChange={(e) => setIsDgOnlyInput(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                </div>

                <div className="bg-slate-800 p-3 rounded-xl border border-slate-700 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white block text-xs flex items-center">
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400 mr-1" /> 表示フラグ (自動生成)
                    </span>
                    <span className="text-[10px] text-slate-400">ONの場合はPDF取り込み時に初期タスク反映</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoIncludeInput}
                    onChange={(e) => setAutoIncludeInput(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
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
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg flex items-center space-x-1 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>保存する</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Table List of Task Masters */}
          {loading ? (
            <div className="text-center py-8 text-xs text-slate-500">作業工程タスクマスタを読み込み中...</div>
          ) : taskMasters.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">登録された作業工程タスクがありません。</div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-3 w-16 text-center">№</th>
                    <th className="py-3 px-3 w-28">短縮文字 (5文字)</th>
                    <th className="py-3 px-4">作業内容 (20文字以下)</th>
                    <th className="py-3 px-3 text-center">DG設定</th>
                    <th className="py-3 px-3 text-center">表示フラグ</th>
                    <th className="py-3 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {taskMasters.map((tm) => (
                    <tr key={tm.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-800">
                        {tm.orderNumber}
                      </td>

                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 rounded text-xs">
                          {tm.shortName}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-bold text-slate-900">
                        {tm.content}
                      </td>

                      <td className="py-3 px-3 text-center">
                        {tm.isDgOnly ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded border border-amber-300 inline-flex items-center">
                            <Flame className="w-3 h-3 mr-0.5 text-amber-600" />
                            DG専用
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">共通</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-center">
                        {tm.autoInclude ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded border border-emerald-300 inline-flex items-center">
                            <Check className="w-3 h-3 mr-0.5 text-emerald-600" />
                            初期反映ON
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded border border-slate-200">
                            OFF
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right flex items-center justify-end space-x-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditClick(tm)}
                          className="px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 font-bold rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(tm)}
                          className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 font-bold rounded-lg border border-red-200 transition-colors cursor-pointer flex items-center space-x-1"
                          title="削除"
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

        {/* Footer */}
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
      {deletingTm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-60 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <div className="w-10 h-10 rounded-2xl bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-900">作業工程タスク削除の確認</h4>
                <p className="text-xs text-slate-500">この操作はマスタから即座に削除されます</p>
              </div>
            </div>

            <div className="bg-red-50/70 border border-red-100 p-3 rounded-2xl text-xs text-slate-700 space-y-1">
              <div>
                <span className="font-bold text-slate-900">№ {deletingTm.orderNumber}: </span>
                <span className="font-bold text-red-700">[{deletingTm.shortName}] {deletingTm.content}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              本当にこの作業工程タスクを削除してもよろしいですか？
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingTm(null)}
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
