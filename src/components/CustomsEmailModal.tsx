import React, { useState, useEffect } from 'react';
import { Mail, Copy, Check, X, Send, FileText, ExternalLink, Settings, Folder, CheckSquare, Square, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Shipment, OneDriveFileItem, EmailAttachment } from '../types';
import { getCurrentUser, addCustomsEmailLog } from '../lib/storageManager';
import { listOneDriveFilesForShipment, getShipmentOneDriveFolderPath, downloadOrPreviewOneDriveFile, prepareEmailAttachmentsFromCloudFiles } from '../lib/oneDriveService';
import { getM365Settings, sendMailViaGraphBackend } from '../lib/m365EmailService';
import { useAuth } from '../lib/AuthContext';

type MailerType = 'default' | 'gmail' | 'outlook';
type BodyFontSize = '12px' | '14px' | '16px' | '18px' | '20px';

interface CustomsEmailModalProps {
  shipment: Shipment | null;
  onClose: () => void;
  operatorName?: string;
  initialSelectedFileIds?: string[];
  initialSelectedFiles?: OneDriveFileItem[];
  isDirectSend?: boolean; // When true: directly sends email from the system without opening Gmail
  onSentSuccess?: () => void;
}

export const CustomsEmailModal: React.FC<CustomsEmailModalProps> = ({
  shipment,
  onClose,
  operatorName,
  initialSelectedFileIds,
  initialSelectedFiles,
  isDirectSend = false,
  onSentSuccess,
}) => {
  const { currentOperator, currentUser: authUser } = useAuth();
  const localUser = getCurrentUser();
  const effectiveUser = authUser || localUser;
  const settings = getM365Settings();
  const isGoogleDrive = (settings.storageProvider || 'onedrive') === 'googledrive';
  const providerName = '共有ドライブ';

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
  const [isSending, setIsSending] = useState(false);
  const [sendStatusMessage, setSendStatusMessage] = useState('');

  const [oneDriveFiles, setOneDriveFiles] = useState<OneDriveFileItem[]>(
    () => initialSelectedFiles || []
  );

  // When isDirectSend is false (e.g. top button), do NOT attach files by default
  const [selectedOneDriveFileIds, setSelectedOneDriveFileIds] = useState<string[]>(() => {
    if (isDirectSend && initialSelectedFileIds !== undefined) {
      return initialSelectedFileIds;
    }
    return [];
  });

  useEffect(() => {
    if (shipment && isDirectSend) {
      listOneDriveFilesForShipment(shipment).then((files) => {
        setOneDriveFiles(files);
        if (initialSelectedFileIds !== undefined && initialSelectedFileIds.length > 0) {
          setSelectedOneDriveFileIds(initialSelectedFileIds);
        } else if (initialSelectedFiles && initialSelectedFiles.length > 0) {
          setSelectedOneDriveFileIds(initialSelectedFiles.map((f) => f.id));
        }
      });
    } else {
      setOneDriveFiles([]);
      setSelectedOneDriveFileIds([]);
    }
  }, [shipment?.id, isDirectSend]);

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
      const selectedFiles = oneDriveFiles.filter((f) => selectedOneDriveFileIds.includes(f.id));
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
        attachments: selectedFiles.map((f) => ({
          id: f.id,
          fileName: f.name,
          sizeBytes: f.size,
          contentType: f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
          downloadUrl: f.downloadUrl || f.webUrl,
          isPdf: f.name.toLowerCase().endsWith('.pdf'),
        })),
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

  const handleDirectSend = async () => {
    if (!shipment) return;
    setIsSending(true);
    setSendStatusMessage('添付ファイルを準備中...');

    try {
      const selectedFiles = oneDriveFiles.filter((f) => selectedOneDriveFileIds.includes(f.id));

      // Fetch and prepare real base64 attachments
      let attachments: EmailAttachment[] = [];
      if (selectedFiles.length > 0) {
        setSendStatusMessage(`${providerName}から書類（${selectedFiles.length}件）を取得中...`);
        attachments = await prepareEmailAttachmentsFromCloudFiles(selectedFiles);
      }

      setSendStatusMessage('通関士宛てにメールを直接送信中...');

      const toList = toAddress.split(';').map((e) => e.trim()).filter(Boolean);
      const ccList = ccAddress.split(';').map((e) => e.trim()).filter(Boolean);

      const sendResult = await sendMailViaGraphBackend({
        toRecipients: toList,
        ccRecipients: ccList,
        subject,
        body,
        isHtml: false,
        attachments,
        allowSimulatedSend: true,
      });

      // Add to local / firestore email history log with attachments
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
        toRecipients: toList,
        ccRecipients: ccList,
        subject,
        body,
        attachments,
      });

      setIsSending(false);

      const attachText =
        attachments.length > 0
          ? `\n\n【添付書類 (${attachments.length}件)】\n` +
            attachments.map((a) => `・${a.fileName}`).join('\n')
          : '';
      alert(
        `【送信完了】\n本システムから通関士（白名様）宛てに直接メールを送信しました！\n宛先: ${toList.join(', ')}${attachText}`
      );

      onSentSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Direct email send failed:', err);
      setIsSending(false);
      alert(`メール直接送信中にエラーが発生しました: ${err.message || '通信エラー'}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden text-slate-100 my-8">
        {/* Header */}
        <div className="bg-slate-800/90 px-6 py-4 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div
              className={`p-2 rounded-xl border ${
                isDirectSend
                  ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
              }`}
            >
              {isDirectSend ? <Send className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {isDirectSend ? '通関士宛てメール直接送信（書類添付）' : '通関依頼メール作成'}
              </h3>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                <span>AWB:</span>
                <span className="font-mono text-blue-300 font-bold">
                  {(shipment.hawbNumber && shipment.hawbNumber.trim()) ||
                    (shipment as any).primaryKey ||
                    shipment.mawbNumber ||
                    shipment.id}
                </span>
                {isDirectSend ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.2 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full font-bold text-[11px]">
                    <CheckCircle2 className="w-3 h-3" />
                    システムから直接送信（Gmail画面は開きません）
                  </span>
                ) : (
                  <span className="text-slate-400 text-[11px]">（下書き作成・メーラー選択）</span>
                )}
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
          {/* Mode-specific Top Bar */}
          {isDirectSend ? (
            <div className="bg-emerald-950/60 border border-emerald-500/40 p-3 rounded-xl flex items-start gap-2.5 text-emerald-200">
              <Send className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs leading-relaxed">
                <span className="font-bold text-emerald-300">システム直接送信モード:</span>{' '}
                指定した書類（{selectedOneDriveFileIds.length}件）を添付した状態で、本システムから直接通関士宛てにメールを送信します。Gmail画面等の外部アプリは開きません。
              </div>
            </div>
          ) : (
            /* Mailer Selector Bar (Per User Preference) for standard draft creation */
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
          )}

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

          {/* Cloud Document Attachments Selector (Only shown in Direct Send mode) */}
          {isDirectSend && oneDriveFiles.length > 0 && (
            <div className="bg-slate-950 p-3 rounded-xl border border-blue-900/60 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-blue-400" />
                  <span>📁 {providerName}保管書類から添付選択:</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {selectedOneDriveFileIds.length} / {oneDriveFiles.length} 件選択中
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedOneDriveFileIds.length === oneDriveFiles.length) {
                        setSelectedOneDriveFileIds([]);
                      } else {
                        setSelectedOneDriveFileIds(oneDriveFiles.map((f) => f.id));
                      }
                    }}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline cursor-pointer px-1"
                  >
                    {selectedOneDriveFileIds.length === oneDriveFiles.length ? '全解除' : '全選択'}
                  </button>
                  {selectedOneDriveFileIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const toDownload = oneDriveFiles.filter((f) => selectedOneDriveFileIds.includes(f.id));
                        toDownload.forEach((f) => downloadOrPreviewOneDriveFile(f));
                      }}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 cursor-pointer ml-1"
                      title="選択した書類を一括ダウンロード"
                    >
                      <Download className="w-3 h-3" />
                      <span>ダウンロード</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {oneDriveFiles.map((file) => {
                  const isChecked = selectedOneDriveFileIds.includes(file.id);
                  return (
                    <label
                      key={file.id}
                      className={`flex items-center space-x-2 p-2 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                        isChecked
                          ? 'bg-blue-950/60 border-blue-500 text-blue-100 font-bold shadow-xs'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setSelectedOneDriveFileIds((prev) =>
                            prev.includes(file.id) ? prev.filter((id) => id !== file.id) : [...prev, file.id]
                          );
                        }}
                        className="rounded text-blue-500 focus:ring-blue-400 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="truncate flex-1" title={file.name}>
                        {file.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

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
            {isDirectSend ? (
              <button
                type="button"
                disabled={isSending}
                onClick={handleDirectSend}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl inline-flex items-center gap-2 shadow-lg shadow-emerald-900/40 transition-all cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{sendStatusMessage || '送信中...'}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>
                      このシステムから直接メールを送信
                      {selectedOneDriveFileIds.length > 0 && `（添付 ${selectedOneDriveFileIds.length} 件）`}
                    </span>
                  </>
                )}
              </button>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
