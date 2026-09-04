import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { UserPlus, LogIn, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const { login, register } = useAuth();
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmployeeNumber, setRegEmployeeNumber] = useState('');

  // Feedback states
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setIsSubmitting(true);

    try {
      await login(loginEmail, loginPassword);
      setSuccessMsg('ログインに成功しました。');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Login error:', err);
      let msg = 'ログインに失敗しました。メールアドレスとパスワードを確認してください。';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = 'メールアドレスまたはパスワードが正しくありません。';
      } else if (err.code === 'auth/invalid-email') {
        msg = '有効なメールアドレス形式を入力してください。';
      }
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!regEmail || !regPassword || !regName) {
      setErrorMsg('すべての必須項目（メールアドレス、パスワード、氏名）を入力してください。');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMsg('パスワードは6文字以上で設定してください。');
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        email: regEmail,
        pass: regPassword,
        name: regName,
        employeeNumber: regEmployeeNumber.trim() || undefined,
      });
      setSuccessMsg('新規ID登録および担当者マスタ登録が完了しました！');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Register error:', err);
      let msg = '登録に失敗しました。';
      if (err.code === 'auth/email-already-in-use') {
        msg = 'このメールアドレス（ID）は既に登録されています。ログイン画面からログインしてください。';
      } else if (err.code === 'auth/weak-password') {
        msg = 'パスワードが短すぎます（6文字以上必要です）。';
      } else if (err.code === 'auth/invalid-email') {
        msg = '有効なメールアドレス形式を入力してください。';
      } else if (err.message) {
        msg = `登録エラー: ${err.message}`;
      }
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Background Subtle Glows */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden z-10">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 p-6 border-b border-slate-800 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">輸出進捗管理システム</h2>
          <p className="text-xs text-slate-400 mt-1">Firebase 認証 & 担当者マスタ連動ログイン</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-900/50">
          <button
            type="button"
            onClick={() => {
              setActiveTab('LOGIN');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex-1 py-3.5 text-xs font-bold transition-all flex items-center justify-center space-x-2 border-b-2 ${
              activeTab === 'LOGIN'
                ? 'border-blue-500 text-blue-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="w-4 h-4" />
            <span>IDログイン</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('REGISTER');
              setErrorMsg('');
              setSuccessMsg('');
            }}
            className={`flex-1 py-3.5 text-xs font-bold transition-all flex items-center justify-center space-x-2 border-b-2 ${
              activeTab === 'REGISTER'
                ? 'border-blue-500 text-blue-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>新規ID登録</span>
          </button>
        </div>

        {/* Body Form */}
        <div className="p-6">
          {/* Error Message Alert */}
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-xs text-red-300 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* Success Message Alert */}
          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-xs text-emerald-300 flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>{successMsg}</div>
            </div>
          )}

          {/* TAB 1: LOGIN */}
          {activeTab === 'LOGIN' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  ID (メールアドレス) <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  パスワード <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <span>ログイン処理中...</span>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>ログイン</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 2: REGISTER (新規ID登録) */}
          {activeTab === 'REGISTER' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  ID (メールアドレス) <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="example@export-logistics.co.jp"
                  className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  パスワード (6文字以上) <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="6文字以上のパスワード"
                  className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    氏名 (担当者名) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="例: 田中 一郎"
                    className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    社員番号 <span className="text-slate-500 font-normal">(任意)</span>
                  </label>
                  <input
                    type="text"
                    value={regEmployeeNumber}
                    onChange={(e) => setRegEmployeeNumber(e.target.value)}
                    placeholder="例: EMP-2001 (省略可)"
                    className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span>登録処理中...</span>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>新規ID・担当者マスタ登録</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
