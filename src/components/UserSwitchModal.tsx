import React, { useState } from "react";
import { X, User, Check, Mail, ShieldCheck, UserPlus, Edit2, Hash, LogOut, CheckCircle2, Activity } from "lucide-react";
import { StaffMember, UserProfile } from "../types";
import { auth } from "../lib/firebase";
import { signOut } from "firebase/auth";

interface UserSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  onSelectUser: (user: UserProfile) => void;
  onUpdateCurrentUserProfile: (name: string, employeeNumber?: string) => void;
  onOpenAuthModal: () => void;
  onOpenFirestoreMonitor?: () => void;
}

export const UserSwitchModal: React.FC<UserSwitchModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  staffMembers,
  onSelectUser,
  onUpdateCurrentUserProfile,
  onOpenAuthModal,
  onOpenFirestoreMonitor,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(currentUser.name);
  const [editEmpNum, setEditEmpNum] = useState(currentUser.employeeNumber || "");

  if (!isOpen) return null;

  const handleStartEdit = () => {
    setEditName(currentUser.name);
    setEditEmpNum(currentUser.employeeNumber || "");
    setIsEditing(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      alert("名前は必須入力です。");
      return;
    }
    onUpdateCurrentUserProfile(editName.trim(), editEmpNum.trim() || undefined);
    setIsEditing(false);
  };

  const handleSignOut = async () => {
    if (auth) {
      try {
        await signOut(auth);
      } catch (e) {
        console.error("Sign out error:", e);
      }
    }
    onClose();
    onOpenAuthModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 text-white border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-100">ユーザー設定・ログイン切替</h2>
              <p className="text-xs text-slate-400 font-medium">
                Firebaseアカウント認証 & 担当者マスタ情報
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
        <div className="p-6 space-y-5 text-xs text-slate-700 dark:text-slate-300 overflow-y-auto max-h-[75vh]">
          
          {/* Current Logged-in User Box */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-sky-500/10 via-indigo-500/5 to-transparent border border-sky-500/30 dark:border-sky-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-sky-500" />
                現在アクティブなユーザーID
              </span>
              {!isEditing && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold rounded-lg text-xs flex items-center gap-1 transition-all"
                >
                  <Edit2 className="w-3.5 h-3.5 text-sky-500" />
                  <span>名前・社員番号の変更</span>
                </button>
              )}
            </div>

            {!isEditing ? (
              <div className="flex items-center gap-3 pt-1">
                <div className="w-12 h-12 rounded-2xl bg-sky-600 flex items-center justify-center text-white font-black text-lg shadow-md shrink-0">
                  {currentUser.email.charAt(0).toUpperCase()}
                </div>
                <div className="space-y-0.5">
                  <div className="font-extrabold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>{currentUser.name}</span>
                    {currentUser.employeeNumber && (
                      <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded font-mono text-[11px]">
                        社員番号: {currentUser.employeeNumber}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1 text-xs">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span>{currentUser.email}</span>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveEdit} className="space-y-3 pt-1 border-t border-sky-500/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                      担当者表示名 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                      社員番号 <span className="text-slate-400 font-normal">(任意)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="例: EMP-001"
                      value={editEmpNum}
                      onChange={(e) => setEditEmpNum(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xs"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-extrabold rounded-lg text-xs shadow-xs"
                  >
                    保存 (マスタ連動)
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Action: Firebase Auth Modal Trigger Button */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-sky-500" />
                  Firebase アカウント認証
                </h3>
                <p className="text-[11px] text-slate-500">
                  Firebaseメール認証で新規IDを作成、または既存アカウントへログイン
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthModal();
                }}
                className="flex-1 py-2 px-4 bg-sky-600 hover:bg-sky-500 text-white font-extrabold rounded-xl text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <UserPlus className="w-4 h-4" />
                <span>メールアドレスでログイン / 新規ID登録</span>
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                className="py-2 px-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors"
                title="Firebaseからログアウト"
              >
                <LogOut className="w-4 h-4 text-rose-500" />
                <span>ログアウト</span>
              </button>
            </div>
          </div>

          {/* Staff Master Quick Switcher List */}
          <div className="space-y-2">
            <label className="block font-extrabold text-slate-900 dark:text-slate-100 text-xs">
              担当者マスタから選択（ワンクリック切替）
            </label>
            <div className="space-y-1.5">
              {staffMembers.map((staff) => {
                const isSelected = currentUser.email.toLowerCase() === staff.email.toLowerCase();
                return (
                  <button
                    key={staff.id}
                    onClick={() => {
                      onSelectUser({
                        name: staff.name,
                        email: staff.email,
                        employeeNumber: staff.employeeNumber,
                      });
                      onClose();
                    }}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between transition-all ${
                      isSelected
                        ? "bg-sky-500/10 border-sky-500 ring-1 ring-sky-500 text-slate-900 dark:text-slate-100"
                        : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <div>
                      <div className="font-extrabold text-xs flex items-center gap-2">
                        <span>{staff.name}</span>
                        {staff.employeeNumber && (
                          <span className="px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded font-mono text-[10px]">
                            {staff.employeeNumber}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 font-semibold">
                        {staff.email}
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-sky-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <div>
            {onOpenFirestoreMonitor && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFirestoreMonitor();
                }}
                className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-sky-500 transition-colors font-mono cursor-pointer"
                title="Firestore 読み取りメトリクス & クォータ監視を開く"
              >
                <Activity className="w-3.5 h-3.5 text-amber-500" />
                <span>DB Telemetry (Quota)</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

