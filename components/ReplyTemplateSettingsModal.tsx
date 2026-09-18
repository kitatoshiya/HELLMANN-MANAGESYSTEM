import React, { useEffect, useState, useRef } from 'react';
import { ReplyTemplate } from '../types';
import {
  fetchAllReplyTemplates,
  saveReplyTemplate,
  saveAllReplyTemplates,
  deleteReplyTemplate,
  resetToDefaultReplyTemplates,
  DEFAULT_REPLY_TEMPLATES,
} from '../lib/replyTemplateService';
import {
  MessageSquare,
  Plus,
  Save,
  X,
  Check,
  Trash2,
  Edit2,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Sparkles,
  Cloud,
  FileText,
  Copy,
} from 'lucide-react';

interface ReplyTemplateSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplatesUpdated?: () => void;
}

export const ReplyTemplateSettingsModal: React.FC<ReplyTemplateSettingsModalProps> = ({
  isOpen,
  onClose,
  onTemplatesUpdated,
}) => {
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [orderInput, setOrderInput] = useState<number>(1);
  const [titleInput, setTitleInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('一般');
  const [bodyInput, setBodyInput] = useState('');

  // Delete Confirm State
  const [deletingTemplate, setDeletingTemplate] = useState<ReplyTemplate | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadData = async () => {
    setLoading(true);
    const data = await fetchAllReplyTemplates();
    setTemplates(data);
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
    const nextOrder = templates.length > 0 ? Math.max(...templates.map((t) => t.orderNumber)) + 1 : 1;
    setOrderInput(nextOrder);
    setTitleInput('');
    setCategoryInput('一般');
    setBodyInput('');
    setShowForm(true);
  };

  const handleEditClick = (tmpl: ReplyTemplate) => {
    setEditingId(tmpl.id);
    setOrderInput(tmpl.orderNumber);
    setTitleInput(tmpl.title);
    setCategoryInput(tmpl.category || '一般');
    setBodyInput(tmpl.body);
    setShowForm(true);
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const newItems = [...templates];
    const temp = newItems[index - 1];
    newItems[index - 1] = newItems[index];
    newItems[index] = temp;
    setTemplates(newItems);
    await saveAllReplyTemplates(newItems);
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  const handleMoveDown = async (index: number) => {
    if (index === templates.length - 1) return;
    const newItems = [...templates];
    const temp = newItems[index + 1];
    newItems[index + 1] = newItems[index];
    newItems[index] = temp;
    setTemplates(newItems);
    await saveAllReplyTemplates(newItems);
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  const handleInsertPlaceholder = (placeholder: string) => {
    if (!textareaRef.current) {
      setBodyInput((prev) => prev + placeholder);
      return;
    }
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = bodyInput;
    const newText = text.substring(0, start) + placeholder + text.substring(end);
    setBodyInput(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + placeholder.length;
        textareaRef.current.focus();
      }
    }, 50);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleInput.trim()) {
      alert('ボタン表示名を入力してください。');
      return;
    }
    if (!bodyInput.trim()) {
      alert('定型本文を入力してください。');
      return;
    }

    const newItem: ReplyTemplate = {
      id: editingId || `tmpl_${Date.now()}`,
      orderNumber: Number(orderInput) || 1,
      title: titleInput.trim(),
      category: categoryInput.trim() || '一般',
      body: bodyInput.trim(),
    };

    await saveReplyTemplate(newItem);
    setSaveSuccess(editingId ? `定型文「${newItem.title}」を更新しました。` : `新規定型文「${newItem.title}」を追加しました。`);
    setTimeout(() => setSaveSuccess(''), 2500);

    setShowForm(false);
    await loadData();
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  const confirmDelete = async () => {
    if (!deletingTemplate) return;
    const targetId = deletingTemplate.id;
    const targetTitle = deletingTemplate.title;
    setDeletingTemplate(null);

    await deleteReplyTemplate(targetId);
    setSaveSuccess(`定型文「${targetTitle}」を削除しました。`);
    setTimeout(() => setSaveSuccess(''), 2500);
    await loadData();
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  const handleResetToDefault = async () => {
    setIsResetConfirmOpen(false);
    const defaults = await resetToDefaultReplyTemplates();
    setTemplates(defaults);
    setSaveSuccess('定型文を初期デフォルト設定にリセットしました。');
    setTimeout(() => setSaveSuccess(''), 2500);
    if (onTemplatesUpdated) onTemplatesUpdated();
  };

  const placeholders = [
    { tag: '{AWB}', label: 'AWB番号' },
    { tag: '{重量}', label: '確定重量 (例: 965.0 kg)' },
    { tag: '{個数}', label: '個数 (例: 5 個)' },
    { tag: '{仕向地}', label: '仕向地 (例: ICN)' },
    { tag: '{荷主}', label: '荷主 (Shipper)' },
    { tag: '{CNEE}', label: 'CNEE (Consignee)' },
    { tag: '{担当者}', label: '担当者氏名' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between border-b border-indigo-900/50 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-600/30 border border-indigo-400/40 rounded-xl text-indigo-200 shadow-inner">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                  返信・全員返信 業務定型文マスタ設定
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <Cloud className="w-3 h-3" /> 全ユーザー共通設定
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">
                メール返信・全員返信時にワンクリックで呼び出せる定型文ボタンをカスタマイズ・共有します
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Alert Banner */}
        {saveSuccess && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 text-xs text-emerald-800 font-bold flex items-center justify-between animate-in fade-in duration-150">
            <div className="flex items-center space-x-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{saveSuccess}</span>
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 bg-slate-50/50">
          {/* Top Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div className="text-xs text-slate-600 font-medium">
              登録済み定型文: <strong className="text-indigo-600 font-black">{templates.length}</strong> 件
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(true)}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1 cursor-pointer transition-colors"
                title="初期の定型文セットに戻します"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>初期設定に戻す</span>
              </button>
              <button
                type="button"
                onClick={handleAddNewClick}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black shadow-xs flex items-center space-x-1 cursor-pointer transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>+ 新規定型文を追加</span>
              </button>
            </div>
          </div>

          {/* Inline Add / Edit Form */}
          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="bg-white p-4 sm:p-5 rounded-2xl border-2 border-indigo-200 shadow-md space-y-4 animate-in fade-in slide-in-from-top-2 duration-150"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                  <Edit2 className="w-3.5 h-3.5 text-indigo-600" />
                  {editingId ? '定型文の編集' : '新規定型文の追加'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕ キャンセル
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Order */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">表示順 (No.)</label>
                  <input
                    type="number"
                    min="1"
                    value={orderInput}
                    onChange={(e) => setOrderInput(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 font-bold"
                  />
                </div>

                {/* Title */}
                <div className="sm:col-span-6">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    ボタン表示名 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    placeholder="例: 重量確定, 書類差し替え, X線OK"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 font-bold text-slate-900"
                    required
                  />
                </div>

                {/* Category */}
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">分類タグ (任意)</label>
                  <input
                    type="text"
                    placeholder="例: 重量, 書類, 通関, 保税, 一般"
                    value={categoryInput}
                    onChange={(e) => setCategoryInput(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-700"
                  />
                </div>
              </div>

              {/* Placeholder Insert Chips */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold text-slate-700">
                    定型本文 <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-medium">
                    ※ 以下の差込タグをクリックすると本文へ自動挿入されます
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-indigo-50/50 rounded-xl border border-indigo-100">
                  <span className="text-[10px] font-bold text-indigo-700 flex items-center mr-1">
                    <Sparkles className="w-3 h-3 mr-1" /> 差込タグ:
                  </span>
                  {placeholders.map((p) => (
                    <button
                      key={p.tag}
                      type="button"
                      onClick={() => handleInsertPlaceholder(p.tag)}
                      className="px-2 py-0.5 bg-white hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-md text-[10.5px] font-mono font-bold shadow-2xs cursor-pointer transition-colors"
                      title={`${p.label} を本文に挿入`}
                    >
                      {p.tag} <span className="text-[9px] font-sans text-slate-500 font-normal">({p.label})</span>
                    </button>
                  ))}
                </div>

                <textarea
                  ref={textareaRef}
                  rows={6}
                  value={bodyInput}
                  onChange={(e) => setBodyInput(e.target.value)}
                  placeholder="返信メールに挿入する本文を入力してください。{重量} や {AWB} などの差込タグが利用できます..."
                  className="w-full p-3 bg-white text-xs border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 font-mono text-slate-900 shadow-inner"
                  required
                />
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black shadow-xs flex items-center space-x-1 cursor-pointer transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingId ? '変更を保存' : '定型文を登録'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Templates List */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">定型文マスタを読み込み中...</div>
          ) : templates.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
              <FileText className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-xs font-bold text-slate-700">登録されている定型文はありません</div>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                「+ 新規定型文を追加」または「初期設定に戻す」ボタンから登録してください。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tmpl, idx) => (
                <div
                  key={tmpl.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-2xs hover:border-indigo-300 transition-all p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group"
                >
                  {/* Left info */}
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    {/* Order up/down buttons */}
                    <div className="flex flex-col items-center space-y-0.5 shrink-0 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleMoveUp(idx)}
                        disabled={idx === 0}
                        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-slate-100 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                        title="上へ移動"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] font-mono font-bold text-slate-400">{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(idx)}
                        disabled={idx === templates.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-slate-100 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                        title="下へ移動"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Badge and Text Preview */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="px-2.5 py-0.5 rounded-lg text-xs font-black bg-indigo-50 text-indigo-900 border border-indigo-200 shadow-2xs">
                          {tmpl.title}
                        </span>
                        {tmpl.category && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            {tmpl.category}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 font-mono line-clamp-2 whitespace-pre-line bg-slate-50 p-2 rounded-lg border border-slate-100">
                        {tmpl.body}
                      </p>
                    </div>
                  </div>

                  {/* Right Actions */}
                  <div className="flex items-center space-x-1.5 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditClick(tmpl)}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-200 rounded-lg text-xs font-bold flex items-center space-x-1 transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>編集</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingTemplate(tmpl)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 p-4 border-t border-slate-200 flex justify-between items-center shrink-0">
          <span className="text-[11px] text-slate-500">
            変更内容はFirestoreを通じて全オペレーターの画面へ即座に共有されます
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deletingTemplate && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/70 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-2.5 text-rose-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h4 className="text-sm font-black">定型文の削除確認</h4>
            </div>
            <p className="text-xs text-slate-600">
              定型文「<strong className="text-slate-900">{deletingTemplate.title}</strong>」を削除してもよろしいですか？
              <br />
              （全ユーザーの共通リストから削除されます）
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingTemplate(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/70 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-2.5 text-amber-600">
              <RotateCcw className="w-5 h-5 shrink-0" />
              <h4 className="text-sm font-black">初期設定へのリセット確認</h4>
            </div>
            <p className="text-xs text-slate-600">
              登録されている定型文をすべて初期状態（確認受領、重量確定、書類差し替え、書類回送、X線検査OK、搬入完了）に上書きリセットしますか？
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleResetToDefault}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                リセット実行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
