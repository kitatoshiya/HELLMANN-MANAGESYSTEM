import React, { useState, useEffect } from "react";
import {
  X,
  Mail,
  Copy,
  Check,
  Send,
  ExternalLink,
  UserCheck,
  FileText,
  Ship,
  Plane,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { QuotationItem, QuoteMessage, StaffMember, UserProfile } from "../types";
import { stripHtmlToPlainText } from "../lib/mentionUtils";

interface EmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote: QuotationItem | null;
  message?: QuoteMessage | null;
  staffMembers: StaffMember[];
  currentUser: UserProfile;
  targetStaff?: StaffMember | null;
  mode?: "staff_mention" | "customer_quote";
}

export const EmailModal: React.FC<EmailModalProps> = ({
  isOpen,
  onClose,
  quote,
  message,
  staffMembers,
  currentUser,
  targetStaff,
  mode = "staff_mention",
}) => {
  const [emailMode, setEmailMode] = useState<"staff_mention" | "customer_quote">(mode);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [copiedField, setCopiedField] = useState<"subject" | "body" | "all" | null>(null);
  const [sentSuccessToast, setSentSuccessToast] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEmailMode(mode || "staff_mention");
      setSendError(null);
      setSentSuccessToast(null);
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (!quote) return;

    if (targetStaff) {
      setRecipientEmail(targetStaff.email);
      setRecipientName(targetStaff.name);
    } else if (emailMode === "staff_mention") {
      const assigned = staffMembers.find((s) => s.id === quote.assignedStaffId);
      if (assigned) {
        setRecipientEmail(assigned.email);
        setRecipientName(assigned.name);
      } else {
        setRecipientEmail(staffMembers[0]?.email || "staff@marinetrade.co.jp");
        setRecipientName(staffMembers[0]?.name || "担当スタッフ");
      }
    } else {
      setRecipientEmail("customer@shipping-line.com");
      setRecipientName("本船手配担当者 各位");
    }

    const appUrl = window.location.origin;
    const msgText = message ? stripHtmlToPlainText(message.contentHtml) : "";

    if (emailMode === "staff_mention") {
      setSubject(`[メンション通知] 案件: ${quote.title} (本船: ${quote.vesselName})`);
      setBodyText(
`${recipientName || "担当者"} 様

お疲れ様です。${currentUser.name}です。
ACE船用品輸出見積管理システムにて、あなた宛てのメンション/メッセージが投稿されました。

--------------------------------------------------
■ 案件名: ${quote.title}
■ 本船名: ${quote.vesselName}
■ 向け地(IATA): ${quote.airportCodes.join(", ") || "未設定"}
■ 通関日: ${quote.customsClearanceDate || quote.grossWeight || "未設定"}
■ 投稿者: ${message?.authorName || currentUser.name} (${message?.authorEmail || currentUser.email})
--------------------------------------------------

【投稿コメント本文】
${msgText || "最新の見積更新・返信が届いています。内容をご確認ください。"}

▼ 以下のリンクよりシステムを起動して直接スレッドを確認・返信できます:
${appUrl}

よろしくお願いいたします。
--------------------------------------------------
送信元: ACE船用品輸出見積管理システム
`
      );
    } else {
      // Customer Quote Email Template
      setSubject(`【見積回答】本船 ${quote.vesselName} 向け船用品航空輸送見積書 (Quote No: ${quote.id.toUpperCase()})`);
      setBodyText(
`${recipientName || "お取引先"} 御中

平素は格別のご高配を賜り、厚く御礼申し上げます。
ご依頼いただきました本船 ${quote.vesselName} 向け船用品の航空輸送見積をお送りいたします。

--------------------------------------------------
■ 案件名: ${quote.title}
■ 対象本船: ${quote.vesselName}
■ 向け地空港: ${quote.airportCodes.join(", ")}
■ 通関日: ${quote.customsClearanceDate || quote.grossWeight || "未設定"}
--------------------------------------------------

【見積内容・返信メッセージ】
${msgText || "提示金額およびスケジュール詳細は添付の概算明細をご確認ください。"}

ご不明な点や追加のご要望がございましたら、お気軽にお問い合わせください。
何卒ご検討のほどよろしくお願い申し上げます。

--------------------------------------------------
担当者: ${currentUser.name}
メール: ${currentUser.email}
船用品エアー輸出管理チーム
`
      );
    }
  }, [quote, message, targetStaff, emailMode, staffMembers, currentUser]);

  if (!isOpen || !quote) return null;

  const handleCopy = (type: "subject" | "body" | "all") => {
    let copyVal = "";
    if (type === "subject") copyVal = subject;
    else if (type === "body") copyVal = bodyText;
    else copyVal = `To: ${recipientEmail}\n件名: ${subject}\n\n${bodyText}`;

    navigator.clipboard.writeText(copyVal);
    setCopiedField(type);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleLaunchMailer = () => {
    const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(bodyText)}`;
    window.location.href = mailtoUrl;

    setSentSuccessToast(`メーラーを起動しました (${recipientEmail} 宛て)`);
    setTimeout(() => setSentSuccessToast(null), 4000);
  };

  const handleDirectBackgroundSend = async () => {
    if (!recipientEmail) {
      setSendError("送信先メールアドレスを入力してください。");
      return;
    }

    setIsSending(true);
    setSendError(null);
    setSentSuccessToast(null);

    try {
      const resp = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: recipientEmail,
          subject,
          bodyText,
          fromName: currentUser.name,
          quoteId: quote?.id,
        }),
      });

      const data = await resp.json();

      if (resp.ok && data.success) {
        setSentSuccessToast(data.message || `🚀 メールをバックグラウンドから ${recipientEmail} へ即時送信しました！`);
        setTimeout(() => {
          setSentSuccessToast(null);
          onClose();
        }, 3000);
      } else {
        setSendError(data.error || "送信処理中にエラーが発生しました。");
      }
    } catch (err: unknown) {
      const error = err as Error;
      setSendError(`送信エラー: ${error?.message || "サーバーとの通信に失敗しました"}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative">
        {/* Sending Overlay */}
        {isSending && (
          <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-white text-center animate-in fade-in duration-150 select-none">
            <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mb-3 shadow-2xl animate-pulse">
              <Sparkles className="w-7 h-7 text-white animate-spin" />
            </div>
            <h4 className="text-base font-extrabold text-emerald-300">メールをバックグラウンド送信中です...</h4>
            <p className="text-xs text-slate-300 mt-1.5 max-w-sm leading-relaxed">
              指定アドレス宛てにメールを配信処理しています。<br />
              送信が完了するまで画面操作を行わずそのままお待ちください。
            </p>
          </div>
        )}

        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-950 text-white border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shadow-xs">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-sky-300">
                {emailMode === "staff_mention"
                  ? "✉️ 担当者メール通知 & メーラー連携"
                  : "📧 顧客向け正式見積メール作成"}
              </h3>
              <p className="text-[11px] text-slate-400 font-bold">
                {quote.title} • {quote.vesselName}
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

        {/* Mode Selector Tabs */}
        <div className="px-5 py-2 bg-slate-950/60 border-b border-slate-800 flex items-center gap-2 text-xs shrink-0">
          <button
            type="button"
            onClick={() => setEmailMode("staff_mention")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              emailMode === "staff_mention"
                ? "bg-sky-600 text-white shadow-xs font-black"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>社内担当者通知用</span>
          </button>

          <button
            type="button"
            onClick={() => setEmailMode("customer_quote")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              emailMode === "customer_quote"
                ? "bg-emerald-600 text-white shadow-xs font-black"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>顧客/本船宛て見積用</span>
          </button>
        </div>

        {/* Explanation Notice Box */}
        <div className="mx-5 mt-3 p-3 bg-sky-950/60 border border-sky-600/40 rounded-xl text-sky-200/90 text-[11px] leading-relaxed flex items-start gap-2.5 shrink-0">
          <AlertCircle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-1 font-medium">
            <p className="font-extrabold text-sky-300">⚡ ワンクリック・バックグラウンドメール配信機能</p>
            <p className="text-[10.5px] text-sky-200/80">
              「<strong>バックグラウンド即時送信</strong>」を押すと、メーラーを開かずにサーバー経由で直接指定アドレスへメールを送信します。
              （環境変数 <code className="bg-slate-900 px-1 rounded border border-slate-700 font-mono text-sky-300">SMTP_HOST</code> 等を設定すれば自社SMTPサーバー経由の送信に切り替わります）
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {sendError && (
          <div className="mx-5 mt-3 p-3 bg-rose-950/80 border border-rose-500 rounded-xl text-rose-200 text-xs font-bold flex items-center justify-between gap-2 animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{sendError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="text-rose-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Toast Success Alert */}
        {sentSuccessToast && (
          <div className="mx-5 mt-3 p-3 bg-emerald-950 border border-emerald-500 rounded-xl text-emerald-200 text-xs font-extrabold flex items-center gap-2 animate-in slide-in-from-top-2">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 animate-spin" />
            <span>{sentSuccessToast}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs font-medium text-slate-200 flex-1">
          {/* Recipient Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-extrabold text-slate-300 mb-1">
                送信先アドレス (To):
              </label>
              <input
                type="email"
                disabled={isSending}
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="email@domain.com"
              />
            </div>

            <div>
              <label className="block text-[11px] font-extrabold text-slate-300 mb-1">
                宛名・担当者名:
              </label>
              <input
                type="text"
                disabled={isSending}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="山田 太郎"
              />
            </div>
          </div>

          {/* Quick Select Staff Member Dropdown */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-[10px] text-slate-400 font-extrabold shrink-0">担当者一発選択:</span>
            {staffMembers.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={isSending}
                onClick={() => {
                  setRecipientEmail(s.email);
                  setRecipientName(s.name);
                }}
                className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold border shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  recipientEmail.toLowerCase() === s.email.toLowerCase()
                    ? "bg-sky-950 text-sky-300 border-sky-500"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>

          {/* Subject Line */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-extrabold text-slate-300">
                メール件名 (Subject):
              </label>
              <button
                type="button"
                disabled={isSending}
                onClick={() => handleCopy("subject")}
                className="text-[10px] text-sky-400 hover:text-sky-300 font-extrabold flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copiedField === "subject" ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">コピー完了</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>件名をコピー</span>
                  </>
                )}
              </button>
            </div>
            <input
              type="text"
              disabled={isSending}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Body Text */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-extrabold text-slate-300">
                メール本文 (Body Text):
              </label>
              <button
                type="button"
                disabled={isSending}
                onClick={() => handleCopy("body")}
                className="text-[10px] text-sky-400 hover:text-sky-300 font-extrabold flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copiedField === "body" ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">コピー完了</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>本文をコピー</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              value={bodyText}
              disabled={isSending}
              onChange={(e) => setBodyText(e.target.value)}
              rows={10}
              className="w-full p-3 bg-slate-800 border border-slate-700 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed custom-scrollbar disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-900"
            />
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => handleCopy("all")}
            disabled={isSending}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            {copiedField === "all" ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400 font-extrabold">全文コピー完了！</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-sky-400" />
                <span>件名・本文を一括コピペ</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLaunchMailer}
              disabled={isSending}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              title="ローカルのメールアプリ（Outlook/Gmail等）を起動"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              <span>メーラー起動 (mailto:)</span>
            </button>

            <button
              type="button"
              onClick={handleDirectBackgroundSend}
              disabled={isSending || !recipientEmail}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs shadow-lg transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 active:scale-95 ring-2 ring-emerald-500/30"
            >
              {isSending ? (
                <>
                  <Sparkles className="w-4 h-4 text-emerald-200 animate-spin" />
                  <span>バックグラウンド送信中...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 text-white" />
                  <span>ワンクリックバックグラウンド送信</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
