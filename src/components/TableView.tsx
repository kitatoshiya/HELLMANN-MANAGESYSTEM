import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Shipment, Task } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, FileText, MoreVertical, Edit, Trash2, Printer, CheckCircle2, Circle, Eye, Mail, MessageSquare, Check, HelpCircle } from 'lucide-react';
import { updateTaskStatus, togglePinShipment } from '../lib/storageManager';
import { isHeavyShipment, isImportantShipment } from '../lib/awbUtils';
import { getCustomsQaDashboardBadge } from '../lib/m365EmailService';
import { PdfZoomModal } from './PdfZoomModal';
import { CustomsEmailModal } from './CustomsEmailModal';

interface TableViewProps {
  shipments: Shipment[];
  onSelectShipment: (shipment: Shipment) => void;
  onEditShipment: (shipment: Shipment) => void;
  onDeleteShipment: (shipment: Shipment) => void;
  onOpenReport?: (shipment: Shipment) => void;
  onShipmentUpdated?: (updated: Shipment) => void;
}

export const TableView: React.FC<TableViewProps> = ({
  shipments,
  onSelectShipment,
  onEditShipment,
  onDeleteShipment,
  onOpenReport,
  onShipmentUpdated,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [previewPdfShipment, setPreviewPdfShipment] = useState<Shipment | null>(null);
  const [emailModalShipment, setEmailModalShipment] = useState<Shipment | null>(null);
  const [activeMenu, setActiveMenu] = useState<{ shipment: Shipment; rect: DOMRect } | null>(null);

  // Close floating menu on scroll or resize
  useEffect(() => {
    if (!activeMenu) return;
    const handleScrollOrResize = () => {
      setActiveMenu(null);
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [activeMenu]);

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = togglePinShipment(id);
    if (updated && onShipmentUpdated) {
      onShipmentUpdated(updated);
    }
  };

  type SortField = 'awb' | 'shipper' | 'consignee' | 'destination' | 'cutTime' | 'progress' | 'memo';
  type SortOrder = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('cutTime');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleToggleTask = (e: React.MouseEvent, shipment: Shipment, task: Task) => {
    e.stopPropagation();
    const nextStatus = task.status === 'Completed' ? 'Todo' : 'Completed';
    const updated = updateTaskStatus(shipment.id, task.id, nextStatus);
    if (updated && onShipmentUpdated) {
      onShipmentUpdated(updated);
    }
  };

  const getProgressInfo = (tasks?: Task[]) => {
    if (!tasks || tasks.length === 0) return { percent: 0, completed: 0, total: 0 };
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'Completed').length;
    return {
      percent: Math.round((completed / total) * 100),
      completed,
      total
    };
  };

  // Sort shipments: Pinned first, then by selected sort column
  const sortedShipments = [...shipments].sort((a, b) => {
    const aPinned = !!a.isPinned;
    const bPinned = !!b.isPinned;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    let comparison = 0;
    switch (sortField) {
      case 'awb': {
        const aVal = a.mawbNumber || (a as any).mawb || '';
        const bVal = b.mawbNumber || (b as any).mawb || '';
        comparison = aVal.localeCompare(bVal);
        break;
      }
      case 'shipper':
        comparison = (a.shipper || '').localeCompare(b.shipper || '');
        break;
      case 'consignee':
        comparison = (a.consignee || '').localeCompare(b.consignee || '');
        break;
      case 'destination':
        comparison = (a.destination || '').localeCompare(b.destination || '');
        break;
      case 'cutTime':
        comparison = (a.cutTime || '').localeCompare(b.cutTime || '');
        break;
      case 'progress':
        comparison = getProgressInfo(a.tasks).percent - getProgressInfo(b.tasks).percent;
        break;
      case 'memo': {
        const aImportant = (a.comments || []).some(c => c.isImportant) ? 1 : 0;
        const bImportant = (b.comments || []).some(c => c.isImportant) ? 1 : 0;
        if (aImportant !== bImportant) {
          comparison = aImportant - bImportant;
        } else {
          const aCount = a.comments?.length || 0;
          const bCount = b.comments?.length || 0;
          comparison = aCount - bCount;
        }
        break;
      }
      default:
        comparison = 0;
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const isNearingCutoff = (cutTime?: string | null) => {
    if (!cutTime) return false;
    return true; 
  };

  return (
    <div className="w-full bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden text-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className="bg-slate-100/90 sticky top-0 z-10 border-b border-slate-200 text-slate-600 text-[11px]">
            <tr>
              <th className="px-2 py-1.5 w-8 text-center"><input type="checkbox" className="rounded border-slate-300" /></th>
              <th className="px-1.5 py-1.5 w-8 text-center select-none" title="最上部ピン留め固定">📌</th>
              <th className="px-2.5 py-1.5 font-bold cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('awb')}>
                AWB番号 {sortField === 'awb' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('shipper')}>
                荷主 {sortField === 'shipper' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('consignee')}>
                CNEE {sortField === 'consignee' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('destination')}>
                仕向地 {sortField === 'destination' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold text-center">個数 / 重量</th>
              <th className="px-2.5 py-1.5 font-bold cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('progress')}>
                進捗 {sortField === 'progress' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('cutTime')}>
                CUT時間 {sortField === 'cutTime' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold">タスク進捗</th>
              <th className="px-2.5 py-1.5 font-bold text-center cursor-pointer hover:bg-slate-200 select-none" onClick={() => handleSort('memo')}>
                メモ {sortField === 'memo' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th className="px-2.5 py-1.5 font-bold text-center">アクション</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedShipments.map((shipment, idx) => {
              const progress = getProgressInfo(shipment.tasks);
              const isPinned = !!shipment.isPinned;
              const isExpanded = expandedRows.has(shipment.id);
              const nearCutoff = isNearingCutoff(shipment.cutTime);
              const mawb = shipment.mawbNumber || (shipment as any).mawb || '';
              const hawb = shipment.hawbNumber || (shipment as any).hawb || '';
              const hasComments = shipment.comments && shipment.comments.length > 0;
              const importantComments = (shipment.comments || []).filter(c => c.isImportant);
              const hasImportantMemo = importantComments.length > 0;
              const latestImportantMemo = hasImportantMemo
                ? [...importantComments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
                : null;
              const memoCount = shipment.comments?.length || 0;
              const importantSnippet = latestImportantMemo ? latestImportantMemo.content.trim().slice(0, 20) : '';
              const isHeavy = isHeavyShipment(shipment);
              const isImportant = isImportantShipment(shipment);
              const qaBadge = getCustomsQaDashboardBadge(shipment.customsQas);
              
              return (
                <React.Fragment key={`${shipment.id}-${idx}`}>
                  <tr 
                    className={`group transition-colors cursor-pointer ${
                      isPinned 
                        ? isImportant
                          ? 'bg-red-100/80 hover:bg-red-200/70 border-l-4 border-l-blue-600'
                          : isHeavy
                          ? 'bg-amber-100/80 hover:bg-amber-200/70 border-l-4 border-l-blue-600'
                          : 'bg-blue-50/25 hover:bg-blue-50/40 border-l-4 border-l-blue-600'
                        : isImportant
                        ? 'bg-red-50/90 hover:bg-red-100/80 border-l-4 border-l-red-500 shadow-2xs'
                        : isHeavy
                        ? 'bg-amber-50/90 hover:bg-amber-100/80 border-l-4 border-l-amber-500'
                        : nearCutoff && shipment.cutTime 
                        ? 'bg-red-50/30 hover:bg-blue-50/40' 
                        : 'hover:bg-blue-50/40'
                    }`}
                    onClick={() => toggleRow(shipment.id)}
                  >
                    <td className="px-2 py-1 text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5" />
                    </td>
                    <td className="px-1.5 py-1 text-center" onClick={e => togglePin(shipment.id, e)} title={isPinned ? 'ピン留め解除' : '最上部に固定ピン留め'}>
                      <span className={`text-sm cursor-pointer transition-all inline-block select-none ${isPinned ? 'text-rose-500 scale-110 drop-shadow-xs' : 'text-slate-300 hover:text-rose-400 opacity-0 group-hover:opacity-100'}`}>📌</span>
                    </td>
                    <td className="px-2.5 py-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isImportant && (
                          <span className="px-1.5 py-0.2 text-[9px] font-black bg-red-600 text-white rounded shadow-2xs border border-red-500 animate-pulse inline-block">
                            ★重要案件
                          </span>
                        )}
                        {isHeavy && (
                          <span className="px-1.5 py-0.2 text-[9px] font-black bg-amber-500 text-white rounded shadow-2xs border border-amber-600 inline-block">
                            重量案件
                          </span>
                        )}
                      </div>
                      {hawb ? (
                        <div className="flex flex-col justify-center">
                          {/* HAWB is bold, prominent, and green */}
                          <div 
                            className="font-black text-emerald-800 hover:text-emerald-900 hover:underline font-mono text-[20px] leading-tight cursor-pointer tracking-tight"
                            onClick={(e) => { e.stopPropagation(); onSelectShipment(shipment); }}
                            title="クリックして詳細を表示"
                          >
                            {hawb}
                          </div>
                          {/* MAWB is smaller and muted */}
                          {mawb && (
                            <div className="text-xs text-slate-500 font-mono font-medium leading-tight mt-0.5">
                              MAWB: <span className="font-bold text-slate-700">{mawb}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col justify-center">
                          {/* When no HAWB, MAWB is displayed prominently in blue and no HAWB text is shown */}
                          <div 
                            className="font-black text-blue-900 hover:text-blue-950 hover:underline font-mono text-[20px] leading-tight cursor-pointer tracking-tight" 
                            onClick={(e) => { e.stopPropagation(); onSelectShipment(shipment); }}
                            title="クリックして詳細を表示"
                          >
                            {mawb || 'NO-AWB'}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-2.5 py-1 max-w-[140px] truncate text-[11.5px] text-slate-600 font-medium" title={shipment.shipper}>
                      {shipment.shipper || '-'}
                    </td>
                    <td className="px-2.5 py-1 max-w-[170px] truncate font-extrabold text-slate-950 text-[13px]" title={shipment.consignee}>
                      {shipment.consignee || '-'}
                    </td>
                    <td className="px-2.5 py-1">
                      {shipment.destination ? (
                        <span className="bg-blue-100 text-blue-950 border border-blue-200 text-[18px] px-2 py-0.5 rounded-md font-black font-mono tracking-wide leading-none inline-block">
                          {shipment.destination}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1 text-center font-mono text-[11.5px]">
                      <span className="font-semibold text-slate-700">{shipment.pieces || '-'}</span>
                      <span className="mx-0.5 text-slate-300">/</span>
                      <span className={`font-semibold ${isHeavy ? 'text-amber-900 font-black bg-amber-100 px-1 py-0.5 rounded border border-amber-300' : 'text-slate-900'}`}>
                        {shipment.grossWeight || (shipment as any).weight || '-'}
                      </span>
                    </td>
                    <td className="px-2.5 py-1 w-24">
                      <div className="flex items-center space-x-1.5">
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                          <div 
                            className={`absolute top-0 left-0 h-full ${progress.percent === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} 
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600 w-6 text-right">{progress.percent}%</span>
                      </div>
                    </td>
                    <td className={`px-2.5 py-1 font-bold text-[11px] ${nearCutoff && shipment.cutTime ? 'text-red-600 bg-red-100/50 rounded px-1' : 'text-slate-700'}`}>
                      {shipment.cutTime ? `⏰ ${shipment.cutTime}` : '-'}
                    </td>
                    <td className="px-2.5 py-1">
                      <div className="flex items-center space-x-1">
                        {shipment.tasks?.map((t, i) => {
                          const taskTitle = t.title || t.shortName || (t as any).name || `作業${i + 1}`;
                          const isCompleted = t.status === 'Completed';
                          return (
                            <div key={i} title={`${taskTitle}: ${isCompleted ? '完了' : '未完了'}`} className="flex-shrink-0">
                              {isCompleted ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 bg-emerald-50 rounded-full" />
                              ) : (
                                <Circle className="w-3.5 h-3.5 text-slate-300" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-2.5 py-1 text-center" onClick={e => { e.stopPropagation(); onSelectShipment(shipment); }}>
                      <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                        {hasImportantMemo && latestImportantMemo ? (
                          <div
                            className="inline-flex items-center gap-1.5 cursor-pointer px-1.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-900 hover:bg-rose-100 hover:border-rose-300 transition-all max-w-[240px]"
                            title={`【最新の重要メモ】\n${latestImportantMemo.content}\n\n【全メモ (${memoCount}件)】\n` + (shipment.comments || []).map(c => `[${c.formattedTime}] ${c.isImportant ? '★重要 ' : ''}${c.authorName ? `${c.authorName}: ` : ''}${c.content}`).join('\n')}
                          >
                            <div className="flex items-center gap-0.5 shrink-0">
                              <FileText className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                              <span className="text-[10px] font-bold text-rose-700 whitespace-nowrap">
                                {memoCount}件
                              </span>
                            </div>
                            <span className="text-[11px] font-extrabold text-rose-900 truncate leading-tight bg-white/80 px-1 py-0.5 rounded border border-rose-200/70">
                              {importantSnippet}
                            </span>
                          </div>
                        ) : memoCount > 0 ? (
                          <div
                            className="inline-flex items-center justify-center cursor-pointer px-1.5 py-0.5 rounded-full hover:bg-amber-100/60 transition-colors"
                            title={`【メモ ${memoCount}件】\n` + (shipment.comments || []).map(c => `[${c.formattedTime}] ${c.authorName ? `${c.authorName}: ` : ''}${c.content}`).join('\n')}
                          >
                            <FileText className="w-3.5 h-3.5 text-amber-500" />
                            <span className="text-[10px] ml-1 font-bold text-amber-700 whitespace-nowrap">
                              {memoCount}件
                            </span>
                          </div>
                        ) : null}

                        {/* Customs QA Status Badge (ヘルマン照会中 / 回答あり / 未照会) */}
                        {qaBadge && (
                          <div
                            className={`inline-flex items-center gap-1 cursor-pointer px-1.5 py-0.5 rounded-md text-[10.5px] font-black border transition-all ${qaBadge.badgeClass}`}
                            title={`【通関質疑ハブ】\n${qaBadge.fullLabel}\nクリックで通関質疑ハブ・案件詳細を開きます`}
                          >
                            <HelpCircle className="w-3 h-3 shrink-0" />
                            <span className="whitespace-nowrap">{qaBadge.shortLabel}</span>
                            {qaBadge.count > 1 && (
                              <span className="text-[9px] bg-black/20 px-1 py-0.2 rounded font-black">
                                {qaBadge.count}
                              </span>
                            )}
                          </div>
                        )}

                        {!hasImportantMemo && memoCount === 0 && !qaBadge && (
                          <span className="text-slate-300 text-[11px]">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-1 text-center" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          if (activeMenu && activeMenu.shipment.id === shipment.id) {
                            setActiveMenu(null);
                          } else {
                            setActiveMenu({ shipment, rect });
                          }
                        }}
                        className={`p-1 rounded hover:bg-slate-200 text-slate-600 hover:text-slate-900 cursor-pointer transition-colors ${
                          activeMenu?.shipment.id === shipment.id ? 'bg-slate-200 text-slate-900' : ''
                        }`}
                        title="メニューを開く"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  
                  {/* Expanded Task Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.tr
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-slate-50/80 border-b border-slate-100 overflow-hidden"
                      >
                        <td colSpan={12} className="p-0">
                          <div className="py-2 px-6">
                            <div className="text-[11px] font-bold text-slate-600 mb-1.5 flex items-center justify-between">
                              <span className="flex items-center">
                                <ChevronDown className="w-3 h-3 mr-1 text-slate-500" />
                                タスク詳細・進捗状況
                              </span>
                              <span className="text-[10px] text-slate-600 font-medium">
                                ※ 各タスクをクリックすると「完了 ⇔ 予定」を素早く切り替えられます
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                              {shipment.tasks?.map((t, idx) => {
                                const taskTitle = t.title || t.shortName || (t as any).name || `作業${idx + 1}`;
                                const isCompleted = t.status === 'Completed';
                                return (
                                  <button
                                    type="button"
                                    key={t.id || idx} 
                                    onClick={(e) => handleToggleTask(e, shipment, t)}
                                    title={`クリックで【${isCompleted ? '未着手に戻す' : '完了にする'}】\n${taskTitle}`}
                                    className={`p-1.5 rounded-md border text-left cursor-pointer transition-all active:scale-[0.98] select-none ${
                                      isCompleted 
                                        ? 'bg-emerald-50/90 border-emerald-300 text-emerald-900 hover:bg-emerald-100 hover:border-emerald-400 shadow-2xs' 
                                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-blue-300 hover:text-slate-900 shadow-2xs'
                                    }`}
                                  >
                                    <div className="flex items-center space-x-1.5">
                                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7.5px] font-bold shrink-0 transition-colors ${
                                        isCompleted 
                                          ? 'bg-emerald-500 text-white' 
                                          : 'bg-slate-100 border border-slate-300 text-slate-500'
                                      }`}>
                                        {isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : idx + 1}
                                      </div>
                                      <div className="text-[10.5px] font-bold truncate leading-tight" title={taskTitle}>
                                        {taskTitle}
                                      </div>
                                    </div>
                                    {t.completedAt ? (
                                      <div className="text-[8.5px] font-medium text-emerald-700 mt-0.5 pl-5">
                                        完了: {t.completedAt}
                                      </div>
                                    ) : (
                                      <div className="text-[8px] text-slate-600 mt-0.5 pl-5">
                                        クリックで完了
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PDF Fullscreen Preview Modal */}
      {previewPdfShipment && (
        <PdfZoomModal
          shipment={previewPdfShipment}
          isOpen={!!previewPdfShipment}
          onClose={() => setPreviewPdfShipment(null)}
          onReturnToDashboard={() => {
            setPreviewPdfShipment(null);
          }}
          onShipmentUpdated={(updated) => {
            setPreviewPdfShipment(updated);
            if (onShipmentUpdated) {
              onShipmentUpdated(updated);
            }
          }}
        />
      )}

      {/* Customs Email Modal */}
      {emailModalShipment && (
        <CustomsEmailModal
          shipment={emailModalShipment}
          onClose={() => setEmailModalShipment(null)}
        />
      )}

      {/* Highest Z-Index Floating Menu Rendered at Document Body Root via Portal */}
      {activeMenu && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop to capture clicks outside */}
          <div
            className="fixed inset-0 z-[99998] bg-transparent"
            onClick={() => setActiveMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setActiveMenu(null);
            }}
          />
          {/* Floating Menu Body */}
          {(() => {
            const { shipment, rect } = activeMenu;
            const menuWidth = 208;
            const menuEstimatedHeight = 195;
            const isBottomOverflow = rect.bottom + menuEstimatedHeight > window.innerHeight - 10;

            const top = isBottomOverflow ? undefined : rect.bottom + 4;
            const bottom = isBottomOverflow ? window.innerHeight - rect.top + 4 : undefined;
            const right = Math.max(8, window.innerWidth - rect.right);

            return (
              <div
                style={{
                  position: 'fixed',
                  zIndex: 99999,
                  width: `${menuWidth}px`,
                  right: `${right}px`,
                  top: top !== undefined ? `${top}px` : undefined,
                  bottom: bottom !== undefined ? `${bottom}px` : undefined,
                }}
                className="bg-white border border-slate-200 rounded-xl shadow-2xl py-1 text-xs divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100 select-none overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="py-0.5">
                  {/* 1. 詳細表示 */}
                  <button
                    onClick={() => {
                      setActiveMenu(null);
                      onSelectShipment(shipment);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs hover:bg-blue-50 text-slate-700 hover:text-blue-700 flex items-center cursor-pointer font-medium transition-colors"
                  >
                    <FileText className="w-4 h-4 mr-2.5 text-blue-600 shrink-0" />
                    <span>詳細表示</span>
                  </button>
                  {/* 2. PDFプレビュー全面表示 */}
                  <button
                    onClick={() => {
                      setActiveMenu(null);
                      setPreviewPdfShipment(shipment);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 flex items-center cursor-pointer font-medium transition-colors"
                  >
                    <Eye className="w-4 h-4 mr-2.5 text-indigo-600 shrink-0" />
                    <span>PDFプレビュー全面表示</span>
                  </button>
                  {/* 3. 通関依頼メール作成 */}
                  <button
                    onClick={() => {
                      setActiveMenu(null);
                      setEmailModalShipment(shipment);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 flex items-center cursor-pointer font-medium transition-colors"
                  >
                    <Mail className="w-4 h-4 mr-2.5 text-emerald-600 shrink-0" />
                    <span>通関依頼メール作成</span>
                  </button>
                </div>
                <div className="py-0.5">
                  <button
                    onClick={() => {
                      setActiveMenu(null);
                      onEditShipment(shipment);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs hover:bg-amber-50 text-slate-700 hover:text-amber-700 flex items-center cursor-pointer transition-colors font-medium"
                  >
                    <Edit className="w-4 h-4 mr-2.5 text-amber-600 shrink-0" />
                    <span>基本情報編集</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveMenu(null);
                      onDeleteShipment(shipment);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs hover:bg-rose-50 text-rose-600 flex items-center cursor-pointer transition-colors font-medium"
                  >
                    <Trash2 className="w-4 h-4 mr-2.5 text-rose-600 shrink-0" />
                    <span>案件削除</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </>,
        document.body
      )}
    </div>
  );
};

