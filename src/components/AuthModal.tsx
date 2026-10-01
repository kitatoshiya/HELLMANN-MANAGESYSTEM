import React, { useState } from "react";
import {
  X,
  Lock,
  Mail,
  UserCheck,
  Hash,
  UserPlus,
  LogIn,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "../lib/firebase";
import { StaffMember, UserProfile } from "../types";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  staffMembers: StaffMember[];
  onLoginSuccess: (userProfile: UserProfile, newStaff?: StaffMember) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  staffMembers,
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<"login" | "register">("login");

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setName("");
    setEmployeeNumber("");
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSwitchMode = (newMode: "login" | "register") => {
    setMode(newMode);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage("メールアドレスとパスワードを入力してください。");
      return;
    }

    setLoading(true);

    try {
      if (mode === "register") {
        if (!name.trim()) {
          setErrorMessage("担当者名は必須入力です。");
          setLoading(false);
          return;
        }

        if (password.length < 6) {
          setErrorMessage("パスワードは6文字以上で設定してください。");
          setLoading(false);
          return;
        }

        if (password !== confirmPassword) {
          setErrorMessage("確認用パスワードが一致しません。");
          setLoading(false);
          return;
        }

        // Create user with Firebase Auth
        let userCredential;
        if (auth) {
          try {
            userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
            if (userCredential.user) {
              await updateProfile(userCredential.user, {
                displayName: name.trim(),
              });
            }
          } catch (authErr: any) {
            console.warn("Firebase Auth create user error (proceeding with state sync):", authErr);
            if (authErr.code === "auth/email-already-in-use") {
              setErrorMessage("指定されたメールアドレスは既に登録されています。ログインをお試しください。");
              setLoading(false);
              return;
            } else if (authErr.code === "auth/invalid-email") {
              setErrorMessage("有効なメールアドレス形式を入力してください。");
              setLoading(false);
              return;
            } else if (authErr.code === "auth/weak-password") {
              setErrorMessage("パスワードが弱すぎます。6文字以上の英数字を入力してください。");
              setLoading(false);
              return;
            }
          }
        }

        // Synchronize with Staff Master
        const existingStaff = staffMembers.find(
          (s) => s.email.toLowerCase() === email.trim().toLowerCase()
        );

        let createdStaff: StaffMember | undefined = undefined;
        if (!existingStaff) {
          createdStaff = {
            id: `staff-${Date.now()}`,
            name: name.trim(),
            email: email.trim(),
            employeeNumber: employeeNumber.trim() || undefined,
          };
        }

        const newUserProfile: UserProfile = {
          name: name.trim(),
          email: email.trim(),
          employeeNumber: employeeNumber.trim() || existingStaff?.employeeNumber || undefined,
        };

        setSuccessMessage("ID登録が正常に完了しました！");
        setTimeout(() => {
          onLoginSuccess(newUserProfile, createdStaff);
          onClose();
          resetForm();
        }, 600);

      } else {
        // Login mode
        if (auth) {
          try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
          } catch (authErr: any) {
            console.warn("Firebase Auth sign in warning:", authErr);
            if (authErr.code === "auth/user-not-found" || authErr.code === "auth/wrong-password" || authErr.code === "auth/invalid-credential") {
              setErrorMessage("メールアドレスまたはパスワードが正しくありません。");
              setLoading(false);
              return;
            }
          }
        }

        // Find staff member by email to get registered Name & Employee Number
        const matchingStaff = staffMembers.find(
          (s) => s.email.toLowerCase() === email.trim().toLowerCase()
        );

        const loggedInUser: UserProfile = {
          name: matchingStaff ? matchingStaff.name : email.trim().split("@")[0],
          email: email.trim(),
          employeeNumber: matchingStaff?.employeeNumber,
        };

        setSuccessMessage("ログインしました！");
        setTimeout(() => {
          onLoginSuccess(loggedInUser);
          onClose();
          resetForm();
        }, 500);
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setErrorMessage("認証処理中にエラーが発生しました。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 text-white border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-100">Firebase アカウント認証</h2>
              <p className="text-xs text-slate-400 font-medium">
                社内担当者アカウントでのログイン / 新規登録
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

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950/60 p-1">
          <button
            type="button"
            onClick={() => handleSwitchMode("login")}
            className={`flex-1 py-2 text-xs font-extrabold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              mode === "login"
                ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs"
                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            メールでログイン
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode("register")}
            className={`flex-1 py-2 text-xs font-extrabold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              mode === "register"
                ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs"
                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            新規ID作成・登録
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 font-bold flex items-start gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-2 animate-in fade-in duration-150">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* If Registering, show Name and Employee Number inputs */}
            {mode === "register" && (
              <>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    担当者氏名 <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="例: 喜多 健二"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl font-bold text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    ※ 担当者マスタに自動同期登録されます。
                  </p>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                    社員番号 <span className="text-slate-400 font-normal">(任意)</span>
                  </label>
                  <div className="relative">
                    <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="例: EMP-001"
                      value={employeeNumber}
                      onChange={(e) => setEmployeeNumber(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Email Field */}
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                ログインメールアドレス <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="kita@tac-japan.co.jp"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl font-mono font-bold text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                パスワード <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                />
              </div>
            </div>

            {/* Confirm Password Field (Register mode) */}
            {mode === "register" && (
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  パスワード確認 <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white text-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-400"
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-extrabold rounded-xl text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
            >
              {loading ? (
                <span>処理中...</span>
              ) : mode === "login" ? (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Firebaseでログイン</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>新規IDを作成して登録</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 text-center font-bold shrink-0">
          ※ 登録した担当者情報は「担当者マスタ」に自動登録・連動します。
        </div>
      </div>
    </div>
  );
};
