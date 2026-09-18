import React, { useState, useEffect } from 'react';
import { Mail, Save, RotateCcw, Check, X } from 'lucide-react';
import { getUserSignature, saveUserSignature } from '../lib/m365EmailService';
import { useAuth } from '../lib/AuthContext';

interface SignatureSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOperatorName?: string;
}

export const SignatureSettingsModal: React.FC<SignatureSettingsModalProps> = ({
  isOpen,
  onClose,
  defaultOperatorName,
}) => {
  const { currentUser, currentOperator, firebaseUser } = useAuth();
  const operatorName = defaultOperatorName || currentUser?.displayName || currentOperator?.name || firebaseUser?.displayName || '喜多';

  const [signatureText, setSignatureText] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSignatureText(getUserSignature(operatorName));
      setSavedSuccess(false);
    }
  }, [isOpen, operatorName]);

  if (!isOpen) return null;

  const handleSave = () => {
    saveUserSignature(signatureText, operatorName);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  const handleResetDefault = () => {
    const defaultText = `--\nTAC Japan 株式会社 通関オペレーションチーム\n担当: ${operatorName}\nEmail: tac-hellmann@tac-japan.co.jp`;
    setSignatureText(defaultText);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white p-4 px-6 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Mail className="w-5 h-5 text-purple-400" />
            <h3 className="font-bold text-base text-white">
              メール署名・シグニチャー設定
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg text-lg leading-none cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm text-slate-800">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-900 leading-relaxed font-medium">
            照会メール（ヘルマン社宛て等）の文末に自動挿入される署名（シグニチャー）を設定できます。担当者名ごとの署名として保存されます。
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              対象ログイン担当者:
            </label>
            <div className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-800 w-fit">
              {operatorName} 様
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                メール署名本文 (Signature):
              </label>
              <button
                type="button"
                onClick={handleResetDefault}
                className="text-[11px] text-purple-600 hover:text-purple-800 flex items-center gap-1 font-semibold cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>デフォルトに戻す</span>
              </button>
            </div>
            <textarea
              rows={6}
              value={signatureText}
              onChange={(e) => setSignatureText(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-xs font-mono leading-relaxed"
              placeholder="--&#10;TAC Japan 株式会社 通関チーム..."
            />
          </div>

          {savedSuccess && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>署名設定を保存しました。</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 px-6 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Save className="w-3.5 h-3.5" />
            <span>署名を保存</span>
          </button>
        </div>
      </div>
    </div>
  );
};
