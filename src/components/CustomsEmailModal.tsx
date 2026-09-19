import React, { useState, useEffect } from 'react';
import { Mail, Copy, Check, X, Send, FileText, ExternalLink, Settings } from 'lucide-react';
import { Shipment } from '../types';
import { getCurrentUser, addCustomsEmailLog } from '../lib/storageManager';
import { useAuth } from '../lib/AuthContext';

type MailerType = 'default' | 'gmail' | 'outlook';
type BodyFontSize = '12px' | '14px' | '16px' | '18px' | '20px';

interface CustomsEmailModalProps {
  shipment: Shipment | null;
  onClose: () => void;
  operatorName?: string;
}

export const CustomsEmailModal: React.FC<CustomsEmailModalProps> = ({
  shipment,
  onClose,
  operatorName,
}) => {
  const { currentOperator, currentUser: authUser } = useAuth();
  const localUser = getCurrentUser();
  const effectiveUser = authUser || localUser;

  // ログインユーザー名（operatorName > currentOperator.name > authUser.displayName > localUser.displayName > '担当者'）
  const loggedInUserName =
    operatorName ||
    currentOperator?.name ||
    authUser?.displayName ||
    localUser?.displayName ||
    '担当者';

  // User-dependent mailer preference persistence
  const currentUser = effectiveUser;
  const userId = currentUser ? (currentUser.uid || currentUser.email) : 'default_user';
  const STORAGE_KEY = `export_mgmt_mailer_pref_${userId}`;
  const FONT_SIZE_STORAGE_KEY = `export_mgmt_email_body_font_size_${userId}`;

  // 宛先 (To) と CC の初期値設定 (ログインユーザーのメールはCCから除外)
  const defaultTo = 'shirana@tac-japan.co.jp';
  const defaultCcAddresses = [
    'osasales3@tac-japan.co.jp',
    'osasales2@tac-japan.co.jp',
    'tac-hellmann@tac-japan.co.jp',
    'kita@tac-japan.co.jp',
  ].filter((email) => {
    if (!currentUser) return true;
    const userEmail = (currentUser.email || '').toLowerCase().trim();
    return !userEmail || email.toLowerCase().trim() !== userEmail;
  });

  const [toAddress, setToAddress] = useState(defaultTo);
  const [ccAddress, setCcAddress] = useState(defaultCcAddresses.join('; '));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const [mailerType, setMailerType] = useState<MailerType>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'gmail' || saved === 'outlook' || saved === 'default') {
      return saved;
    }
    return 'default';
  });

  const [bodyFontSize, setBodyFontSize] = useState<BodyFontSize>(() => {
    const saved = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (saved === '12px' || saved === '14px' || saved === '16px' || saved === '18px' || saved === '20px') {
      return saved as BodyFontSize;
    }
    return '14px';
  });

  const handleMailerChange = (type: MailerType) => {
    setMailerType(type);
    localStorage.setItem(STORAGE_KEY, type);
  };

  const handleFontSizeChange = (size: BodyFontSize) => {
    setBodyFontSize(size);
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, size);
  };

  useEffect(() => {
    if (!shipment) return;

    // 1. 通関日 (MM/DD 形式)
    let formattedDate = '08/12';
    if (shipment.customsClearanceDate) {
      const parts = shipment.customsClearanceDate.split('-');
      if (parts.length === 3) {
        formattedDate = `${parts[1]}/${parts[2]}`;
      } else {
        formattedDate = shipment.customsClearanceDate;
      }
    }

    // 2. フライト情報 (従来は向け地)
    let flightStr = (shipment.flightRoute || '').trim();
    if (flightStr.includes('/')) {
      flightStr = flightStr.split('/')[0].trim();
    }
    if (!flightStr) {
      flightStr = shipment.destination ? `${shipment.destination}向け` : 'フライト';
    }

    // 向け地 (本文用)
    let destStr = shipment.destination || shipment.consignee || 'CAN';
    if (destStr.includes('(')) {
      destStr = destStr.split('(')[0].trim();
    } else if (destStr.includes(' ')) {
      destStr = destStr.split(' ')[0].trim();
    }

    // 3. AWB番号 (HAWBが空白でない場合はMAWBの代わりにHAWB番号を優先反映)
    const hawbVal = shipment.hawbNumber ? shipment.hawbNumber.trim() : '';
    const awbNo = hawbVal !== '' ? hawbVal : ((shipment as any).primaryKey || shipment.mawbNumber || shipment.id || '131-25931791');

    // 4. 積地
    let polStr = shipment.portOfLoading || 'HND';
    if (polStr.includes('(')) {
      polStr = polStr.split('(')[0].trim();
    } else if (polStr.includes(' ')) {
      polStr = polStr.split(' ')[0].trim();
    }

    // 5. 個数
    let pcsStr = shipment.pieces || '25個';
    if (/^\d+$/.test(pcsStr.trim())) {
      pcsStr = `${pcsStr.trim()}個`;
    }

    // 6. 重量
    let wtStr = shipment.grossWeight || '163.8kg';
    if (/^\d+(\.\d+)?$/.test(wtStr.trim())) {
      wtStr = `${wtStr.trim()}kg`;
    }

    // 7. 担当者名（ログインユーザー名）
    const userName = loggedInUserName;

    // 8. FLAG (船籍)
    const flagStr = shipment.flag && shipment.flag.trim() ? shipment.flag.trim() : '';

    // 9. カット時間のフォーマット (例: "17:00" -> "17時カット", "17" -> "17時カット")
    const formatCutTimeForSubject = (cutTimeVal: string | null | undefined): string => {
      if (!cutTimeVal) return '';
      let str = cutTimeVal.trim();
      if (!str) return '';

      if (str.endsWith('カット')) {
        str = str.slice(0, -3).trim();
      }

      const timeColonMatch = str.match(/^(\d{1,2}):(\d{2})$/);
      if (timeColonMatch) {
        const hours = parseInt(timeColonMatch[1], 10);
        const minutes = timeColonMatch[2];
        if (minutes === '00') {
          return `${hours}時カット`;
        } else {
          return `${hours}:${minutes}カット`;
        }
      }

      if (/^\d{1,2}時$/.test(str)) {
        return `${str}カット`;
      }

      if (/^\d{1,2}$/.test(str)) {
        return `${parseInt(str, 10)}時カット`;
      }

      if (str.endsWith('時') || str.endsWith('分')) {
        return `${str}カット`;
      }

      return `${str}カット`;
    };

    const formattedCutTime = formatCutTimeForSubject(shipment.cutTime);

    // メールタイトルの生成法則: 通関日＋” 輸出通関依頼 ”＋フライト＋” ”＋AWB番号（HAWB優先）＋” サブ：ヘルマン”［＋” ”＋カット時間］
    // 例: 08/12 輸出通関依頼 NH006 S2602010942 サブ：ヘルマン 17時カット
    let generatedSubject = `${formattedDate} 輸出通関依頼 ${flightStr} ${awbNo} サブ：ヘルマン`;
    if (formattedCutTime) {
      generatedSubject += ` ${formattedCutTime}`;
    }

    // メール本文の生成法則
    const generatedBody = `白名様

お疲れ様です。

${generatedSubject}

${awbNo}
${polStr}-${destStr}
${pcsStr} ${wtStr}

FLAG：${flagStr}

下記PO NOをEDに記載お願いします。


以上、よろしくお願いいたします。

${userName}`;

    setSubject(generatedSubject);
    setBody(generatedBody);
  }, [shipment, loggedInUserName]);

  if (!shipment) return null;

  const handleCopySubject = async () => {
    try {
      await navigator.clipboard.writeText(subject);
      setCopiedSubject(true);
      setTimeout(() => setCopiedSubject(false), 2000);
    } catch (err) {
      console.error('Failed to copy subject', err);
    }
  };

  const handleCopyBody = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    } catch (err) {
      console.error('Failed to copy body', err);
    }
  };

  const handleCopyAll = async () => {
    try {
      const fullContent = `宛先: ${toAddress}\nCC: ${ccAddress}\n件名: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(fullContent);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (err) {
      console.error('Failed to copy full text', err);
    }
  };

  const handleOpenMailer = () => {
    // Record outgoing email log to storage
    if (shipment) {
      addCustomsEmailLog({
        shipmentId: shipment.id,
        mawbNumber: shipment.mawbNumber,
        hawbNumber: shipment.hawbNumber || undefined,
        threadId: `thread_${shipment.mawbNumber || shipment.id}`,
        direction: 'OUTGOING',
        type: 'CUSTOMS_REQUEST',
        status: 'SENT',
        sentOrReceivedAt: new Date().toISOString(),
        sender: {
          name: `${loggedInUserName} (通関チーム)`,
          email: currentUser?.email || 'tsukan@customs.logistics.co.jp',
        },
        toRecipients: toAddress.split(';').map((e) => e.trim()).filter(Boolean),
        ccRecipients: ccAddress.split(';').map((e) => e.trim()).filter(Boolean),
        subject,
        body,
      });
    }

    const encTo = encodeURIComponent(toAddress.trim());
    const encCc = encodeURIComponent(ccAddress.trim());
    const encSubject = encodeURIComponent(subject);
    const encBody = encodeURIComponent(body);

    if (mailerType === 'gmail') {
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=${encTo}&cc=${encCc}&su=${encSubject}&body=${encBody}`;
      window.open(gmailUrl, '_blank');
    } else if (mailerType === 'outlook') {
      const outlookUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encTo}&cc=${encCc}&subject=${encSubject}&body=${encBody}`;
      window.open(outlookUrl, '_blank');
    } else {
      const mailtoUrl = `mailto:${encTo}?cc=${encCc}&subject=${encSubject}&body=${encBody}`;
      window.location.href = mailtoUrl;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden text-slate-100 my-8">
        {/* Header */}
        <div className="bg-slate-800/90 px-6 py-4 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">通関依頼メール作成</h3>
              <p className="text-xs text-slate-400">
                AWB: <span className="font-mono text-blue-300 font-bold">{(shipment.hawbNumber && shipment.hawbNumber.trim()) || (shipment as any).primaryKey || shipment.mawbNumber || shipment.id}</span> の通関依頼メール下書き
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 text-sm">
          {/* Mailer Selector Bar (Per User Preference) */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-slate-300">起動メールソフト (個人設定):</span>
            </div>
            <div className="flex items-center space-x-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => handleMailerChange('default')}
                className={`px-3 py-1 text-xs rounded-md font-bold transition-all cursor-pointer ${
                  mailerType === 'default'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                標準アプリ (mailto)
              </button>
              <button
                type="button"
                onClick={() => handleMailerChange('gmail')}
                className={`px-3 py-1 text-xs rounded-md font-bold transition-all cursor-pointer ${
                  mailerType === 'gmail'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Gmail
              </button>
              <button
                type="button"
                onClick={() => handleMailerChange('outlook')}
                className={`px-3 py-1 text-xs rounded-md font-bold transition-all cursor-pointer ${
                  mailerType === 'outlook'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Outlook
              </button>
            </div>
          </div>

          {/* To Field (宛先) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
              <span>宛先 (To)</span>
              <span className="text-[11px] text-slate-400 font-normal">手入力・修正可</span>
            </label>
            <input
              type="text"
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder="shirana@tac-japan.co.jp"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* CC Field */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
              <span>CC</span>
              <span className="text-[11px] text-slate-400 font-normal">セミコロン（;）区切りで追加・編集可</span>
            </label>
            <input
              type="text"
              value={ccAddress}
              onChange={(e) => setCcAddress(e.target.value)}
              placeholder="osasales3@tac-japan.co.jp; osasales2@tac-japan.co.jp; tac-hellmann@tac-japan.co.jp"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Subject Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span>件名 (Subject)</span>
              </label>
              <button
                type="button"
                onClick={handleCopySubject}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium cursor-pointer"
              >
                {copiedSubject ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">件名をコピーしました</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>件名のみコピー</span>
                  </>
                )}
              </button>
            </div>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Body Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center space-x-3">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                  <span>メール本文 (Body)</span>
                </label>
                {/* Font Size Selector (Per User Preference) */}
                <div className="flex items-center space-x-1 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
                  <span className="text-[11px] text-slate-400 font-medium mr-1">文字サイズ:</span>
                  {(['12px', '14px', '16px', '18px', '20px'] as BodyFontSize[]).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => handleFontSizeChange(sz)}
                      title={`フォントサイズ: ${sz}`}
                      className={`px-1.5 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                        bodyFontSize === sz
                          ? 'bg-blue-600 text-white font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sz.replace('px', '')}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyBody}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium cursor-pointer"
              >
                {copiedBody ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">本文をコピーしました</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>本文のみコピー</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ fontSize: bodyFontSize }}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3.5 font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed resize-y transition-all"
            />
          </div>
        </div>

        {/* Modal Footer / Actions */}
        <div className="bg-slate-800/80 px-6 py-4 border-t border-slate-700/80 flex items-center justify-between flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopyAll}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copiedAll ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>件名＋本文をコピー完了!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-blue-400" />
                <span>件名＋本文を一括コピー</span>
              </>
            )}
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 transition-colors cursor-pointer"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={handleOpenMailer}
              className={`px-4 py-2 font-bold text-xs rounded-xl inline-flex items-center gap-1.5 shadow-lg transition-all cursor-pointer text-white ${
                mailerType === 'gmail'
                  ? 'bg-red-600 hover:bg-red-500 shadow-red-600/30'
                  : mailerType === 'outlook'
                  ? 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/30'
                  : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30'
              }`}
            >
              {mailerType === 'gmail' ? (
                <>
                  <ExternalLink className="w-4 h-4" />
                  <span>Gmailで開く</span>
                </>
              ) : mailerType === 'outlook' ? (
                <>
                  <ExternalLink className="w-4 h-4" />
                  <span>Outlookで開く</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>既定のメールアプリで開く</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
