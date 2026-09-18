import React, { useState, useEffect } from 'react';
import {
  Mail,
  AlertTriangle,
  FileText,
  Download,
  ArrowRight,
  CheckCircle2,
  Clock,
  Send,
  Building2,
  ExternalLink,
  ChevronRight,
  RotateCw,
  Sparkles,
  Layers,
  X,
  PlusCircle,
  HelpCircle,
  Copy,
  Check,
  AlignLeft,
  FileCode,
} from 'lucide-react';
import { HellmannNewOrderEmail, EmailAttachment } from '../types';
import { sanitizeEmailHtml } from '../lib/htmlSanitizer';
import { subscribeToStore } from '../lib/storageManager';
import { ErrorBoundary } from './ErrorBoundary';
import {
  getPendingHellmannOrders,
  markHellmannOrderRegistered,
  markHellmannOrderProcessed,
  dismissHellmannOrder,
  createBrowserFileFromAttachment,
  simulateIncomingHellmannOrder,
  subscribeM365Store,
  getM365Settings,
  getEmailPayload,
} from '../lib/m365EmailService';

/**
 * OrderEmailBody: Renders the full original email content with exact line breaks,
 * fonts, font sizes, text colors, HTML tables, inline images (cid:), and styles.
 */
const OrderEmailBody: React.FC<{ order: HellmannNewOrderEmail }> = ({ order }) => {
  const [viewMode, setViewMode] = useState<'html' | 'text'>('html');
  const [copied, setCopied] = useState(false);
  const [payloadData, setPayloadData] = useState<{
    bodyHtml?: string;
    bodyText?: string;
    attachments?: EmailAttachment[];
  } | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (order?.id) {
      getEmailPayload(order.id).then((p) => {
        if (isMounted && p) {
          setPayloadData({
            bodyHtml: p.bodyHtml,
            bodyText: p.bodyText,
            attachments: p.attachments,
          });
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [order?.id]);

  const rawHtml = order.bodyHtml || payloadData?.bodyHtml;
  const rawText = order.bodyText || payloadData?.bodyText || '';
  const attachments = (order.attachments && order.attachments.length > 0)
    ? order.attachments
    : (payloadData?.attachments || []);

  const hasHtml = !!(
    rawHtml &&
    (/<[a-z/][\s\S]*>/i.test(rawHtml) ||
      rawHtml.includes('<br') ||
      rawHtml.includes('<p') ||
      rawHtml.includes('<div') ||
      rawHtml.includes('<table'))
  );

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = rawText || (rawHtml ? rawHtml.replace(/<[^>]+>/g, ' ') : '');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-1.5">
      {/* Header controls: Format switch & copy button */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
          <Mail className="w-3.5 h-3.5 text-slate-400" />
          <span>メール本文</span>
        </span>

        <div className="flex items-center space-x-2">
          {hasHtml && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode('html');
                }}
                className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer transition-all ${
                  viewMode === 'html'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                元の書式 (HTML)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode('text');
                }}
                className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer transition-all ${
                  viewMode === 'text'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                テキストのみ
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-blue-700 bg-white hover:bg-blue-50 rounded-md border border-slate-200 shadow-2xs transition-colors cursor-pointer"
            title="本文テキストをクリップボードにコピー"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 mr-1 text-emerald-600" />
                <span className="text-emerald-700 font-bold">コピー完了</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 mr-1 text-slate-400" />
                <span>本文コピー</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Email Body Canvas */}
      {hasHtml && viewMode === 'html' ? (
        <div
          className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs max-h-72 overflow-y-auto overflow-x-auto select-text selection:bg-blue-200 selection:text-blue-900 [&_p]:mb-2 [&_div]:mb-0.5 [&_table]:border-collapse [&_table]:w-full [&_td]:p-1.5 [&_td]:border [&_td]:border-slate-200 [&_th]:p-1.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_img]:max-w-full [&_img]:h-auto [&_a]:text-blue-600 [&_a]:underline"
          style={{
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif',
            fontSize: '13.5px',
            lineHeight: 1.65,
            color: '#1e293b',
            wordBreak: 'break-word',
          }}
          dangerouslySetInnerHTML={{
            __html: sanitizeEmailHtml(rawHtml, attachments),
          }}
        />
      ) : (
        <div
          className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-2xs max-h-72 overflow-y-auto select-text selection:bg-blue-200 selection:text-blue-900 whitespace-pre-wrap break-words"
          style={{
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, monospace, sans-serif',
            fontSize: '13.5px',
            lineHeight: 1.65,
            color: '#1e293b',
          }}
        >
          {rawText || (rawHtml ? rawHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').trim() : '（本文なし）')}
        </div>
      )}
    </div>
  );
};

interface HellmannNewOrderBannerProps {
  onStartSiImport: (file: File | null, orderEmail: HellmannNewOrderEmail) => void;
  onOpenSettings?: () => void;
}

const HellmannNewOrderBannerInner: React.FC<HellmannNewOrderBannerProps> = ({
  onStartSiImport,
  onOpenSettings,
}) => {
  const [orders, setOrders] = useState<HellmannNewOrderEmail[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<HellmannNewOrderEmail | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  const loadOrders = () => {
    try {
      const list = getPendingHellmannOrders();
      setOrders(Array.isArray(list) ? list.filter(Boolean) : []);
    } catch (e) {
      console.warn('[HellmannNewOrderBanner] Error loading pending orders:', e);
      setOrders([]);
    }
  };

  useEffect(() => {
    loadOrders();
    const unsub1 = subscribeM365Store(() => {
      loadOrders();
    });
    const unsub2 = subscribeToStore(() => {
      loadOrders();
    });
    return () => {
      try {
        unsub1();
        unsub2();
      } catch (_) {}
    };
  }, []);

  const safeOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const pendingRegCount = safeOrders.filter((o) => o?.status === 'NEW_PENDING_EXTERNAL_REG').length;
  const readyForImportCount = safeOrders.filter((o) => o?.status === 'EXTERNAL_REGISTERED').length;

  if (safeOrders.length === 0) {
    return null;
  }

  const handleMarkRegistered = (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!orderId) return;
    try {
      markHellmannOrderRegistered(orderId);
      loadOrders();
    } catch (err) {
      console.error('Error marking registered:', err);
    }
  };

  const handleDismiss = (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!orderId) return;
    try {
      dismissHellmannOrder(orderId);
      loadOrders();
    } catch (err) {
      console.error('Error dismissing order:', err);
    }
  };

  const handleMarkAsImportedAndClose = (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!orderId) return;
    try {
      markHellmannOrderProcessed(orderId);
      loadOrders();
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error marking imported:', err);
    }
  };

  const handleStartImport = (order: HellmannNewOrderEmail, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!order) return;
    onStartSiImport(null, order);
    setIsModalOpen(false);
  };

  const handleDownloadAttachment = (dataUrl?: string, fileName?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName || 'attachment.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSimulateNewEmail = () => {
    simulateIncomingHellmannOrder();
    loadOrders();
  };

  const m365Settings = getM365Settings();

  return (
    <>
      {/* High-Impact Top Banner */}
      <div className="mb-5 bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 text-white rounded-2xl shadow-lg border border-amber-400/40 p-4 transition-all">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0 shadow-inner">
              <AlertTriangle className="w-5 h-5 text-amber-100 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-wide flex items-center gap-1.5">
                  <span>🚨 ヘルマン新着通関依頼メール:</span>
                  <span className="bg-white text-amber-900 px-2 py-0.5 rounded-full text-xs font-black shadow-xs">
                    {safeOrders.length}件
                  </span>
                </span>
                {m365Settings?.groupEmail && (
                  <span className="hidden sm:inline-block px-2 py-0.5 bg-black/20 text-amber-100 rounded-md text-[11px] font-mono">
                    {m365Settings.groupEmail}
                  </span>
                )}
              </div>
              <p className="text-xs text-amber-100 mt-0.5 font-medium leading-tight">
                {pendingRegCount > 0 ? (
                  <span>
                    社内別システム（基幹DB）への登録待ちが <strong>{pendingRegCount}件</strong> あります。登録完了後に「SI (PDF) 取り込み」を行ってください。
                  </span>
                ) : (
                  <span>
                    社内登録完了済み: <strong>{readyForImportCount}件</strong>。下のボタンからワンクリックで「SI (PDF) 取り込み」を実行できます。
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-white hover:bg-amber-50 text-amber-900 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap active:scale-95"
            >
              <Mail className="w-4 h-4 text-amber-600" />
              <span>新着依頼一覧を開く ({safeOrders.length})</span>
              <ChevronRight className="w-4 h-4 text-amber-700" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal: New Order Emails Manager */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <span>ヘルマン社 新規通関依頼メール管理</span>
                    <span className="text-xs bg-amber-500 text-slate-950 font-extrabold px-2 py-0.5 rounded-full">
                      {safeOrders.length}件 未処理
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    社内別システムへ登録後、添付SI（PDF）を本システムの「SI取り込み」へ自動連携します。
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {m365Settings.isDemoMode && (
                  <button
                    type="button"
                    onClick={handleSimulateNewEmail}
                    className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-xl text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                    title="動作テスト用にヘルマンからの新着メールを1件シミュレーション受信します"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>テスト新着メール受信</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Toast Notification Banner (iFrame safe) */}
            {toastMessage && (
              <div className="bg-amber-50 border-b border-amber-200 p-3 px-6 flex items-center justify-between text-xs font-bold text-amber-900 animate-in fade-in duration-150">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{toastMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setToastMessage(null)}
                  className="text-amber-700 hover:text-amber-950 p-1 cursor-pointer font-bold"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Workflow Guide Info Banner */}
            <div className="bg-amber-50/80 border-b border-amber-200/80 p-3.5 px-6 flex items-center justify-between text-xs text-amber-900">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>業務手順:</strong> ① メール記載情報で社内別システムへ登録 ➔ ②
                  [社内登録完了 ➔ SI取り込み] ボタンで本システム案件化
                </span>
              </div>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    onOpenSettings();
                  }}
                  className="text-amber-800 underline font-bold hover:text-amber-950 cursor-pointer ml-2 text-[11px] whitespace-nowrap"
                >
                  M365連携設定
                </button>
              )}
            </div>

            {/* List of Incoming Orders */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {safeOrders.map((order, idx) => {
                if (!order) return null;
                const isRegistered = order.status === 'EXTERNAL_REGISTERED';
                const attachments = Array.isArray(order.attachments) ? order.attachments.filter(Boolean) : [];

                return (
                  <div
                    key={`${order.id || idx}-${idx}`}
                    className={`rounded-2xl border transition-all p-5 shadow-xs ${
                      isRegistered
                        ? 'bg-emerald-50/40 border-emerald-300'
                        : 'bg-white border-slate-200 hover:border-amber-400'
                    }`}
                  >
                    {/* Header line of email */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${
                            isRegistered
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                          }`}
                        >
                          {isRegistered ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>社内別システム登録完了</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              <span>社内別システム登録待ち</span>
                            </>
                          )}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          {(() => {
                            if (!order.receivedDateTime) return '-';
                            const d = new Date(order.receivedDateTime);
                            if (isNaN(d.getTime())) return order.receivedDateTime;
                            return d.toLocaleString('ja-JP', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            });
                          })()}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 font-medium">
                        差出人: <strong className="text-slate-800">{order.senderName || '不明'}</strong>{' '}
                        {order.senderEmail && (
                          <span className="text-slate-400 text-[11px]">({order.senderEmail})</span>
                        )}
                      </div>
                    </div>

                    {/* Email Subject & Body Preview */}
                    <div className="py-2.5">
                      <h4 className="font-bold text-sm text-slate-900 mb-2">{order.subject || '（件名なし）'}</h4>
                      <OrderEmailBody order={order} />
                    </div>

                    {/* Cargo Highlights (MAWB / HAWB / Shipper) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-100/70 p-3 rounded-xl border border-slate-200/80 text-xs mb-3">
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold block">MAWB番号:</span>
                        <span className="font-bold font-mono text-slate-800">{order.mawbCandidate || '-'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold block">HAWB番号:</span>
                        <span className="font-bold font-mono text-blue-700">{order.hawbCandidate || '-'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold block">SHIPPER:</span>
                        <span className="font-semibold text-slate-800 truncate block" title={order.shipperCandidate}>
                          {order.shipperCandidate || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold block">CONSIGNEE:</span>
                        <span className="font-semibold text-slate-800 truncate block" title={order.consigneeCandidate}>
                          {order.consigneeCandidate || '-'}
                        </span>
                      </div>
                    </div>

                    {/* Attachments list */}
                    {attachments.length > 0 && (
                      <div className="mb-4">
                        <span className="text-[11px] font-bold text-slate-600 mb-1.5 block flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          <span>メール添付ファイル ({attachments.length}件):</span>
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {attachments.map((att, attIdx) => {
                            if (!att) return null;
                            const fileName = typeof att === 'string' ? att : att.fileName || '添付ファイル';
                            const sizeBytes = typeof att === 'object' && att?.sizeBytes ? att.sizeBytes : 0;
                            const dataUrl = typeof att === 'object' ? att?.dataUrl : undefined;
                            const attKey = (typeof att === 'object' && att?.id) ? att.id : `att-${attIdx}`;
                            return (
                              <div
                                key={attKey}
                                className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-400 p-2 px-3 rounded-xl text-xs text-slate-800 transition-colors shadow-2xs"
                              >
                                <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="font-medium truncate max-w-[200px]">{fileName}</span>
                                {sizeBytes > 0 && (
                                  <span className="text-[10px] text-slate-400">
                                    ({Math.round(sizeBytes / 1024)} KB)
                                  </span>
                                )}
                                {dataUrl && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleDownloadAttachment(dataUrl, fileName, e)}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer transition-colors"
                                    title="添付ファイルをダウンロード保存"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        {!isRegistered ? (
                          <button
                            type="button"
                            onClick={(e) => handleMarkRegistered(order.id, e)}
                            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-slate-300"
                          >
                            <CheckCircle2 className="w-4 h-4 text-slate-500" />
                            <span>社内別システムへ登録完了済みにする</span>
                          </button>
                        ) : (
                          <span className="text-xs text-emerald-700 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>社内登録済み ➔ 次は「SI取り込み」を行ってください</span>
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={(e) => handleDismiss(order.id, e)}
                          className="px-2.5 py-2 text-slate-400 hover:text-slate-600 text-xs font-medium cursor-pointer"
                          title="この依頼を一覧から非表示にします"
                        >
                          非表示
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Mark as Imported & Close button (User Requested) */}
                        <button
                          type="button"
                          onClick={(e) => handleMarkAsImportedAndClose(order.id, e)}
                          className="px-3.5 py-2.5 rounded-xl text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300/80 shadow-xs flex items-center gap-1.5 cursor-pointer transition-all transform active:scale-95"
                          title="本システムに取り込んだことにしてこの画面を閉じます"
                        >
                          <CheckCircle2 className="w-4 h-4 text-amber-700" />
                          <span>取り込んだことにする</span>
                        </button>

                        {/* Import into this system button */}
                        <button
                          type="button"
                          onClick={(e) => handleStartImport(order, e)}
                          disabled={isProcessingFile}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow-md flex items-center gap-2 cursor-pointer transition-all transform active:scale-95 ${
                            isRegistered
                              ? 'bg-emerald-600 hover:bg-emerald-500'
                              : 'bg-blue-600 hover:bg-blue-500'
                          }`}
                        >
                          <Layers className="w-4 h-4" />
                          <span>社内登録完了 ➔ SI (PDF) 取り込み実行</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
              <span className="font-mono">
                Microsoft 365 連携中: {m365Settings.isDemoMode ? '【デモ / シミュレーションモード】' : '【Graph API 稼働中】'}
              </span>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold cursor-pointer transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const HellmannNewOrderBanner: React.FC<HellmannNewOrderBannerProps> = (props) => {
  return (
    <ErrorBoundary fallbackTitle="新着通関依頼バナー">
      <HellmannNewOrderBannerInner {...props} />
    </ErrorBoundary>
  );
};
