import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { Shipment, Task, TaskStatus, User, ActivityLog, Operator, MilestoneKey, MilestoneState } from '../types';
import {
  updateTaskStatus,
  assignTask,
  addTaskToShipment,
  deleteTaskFromShipment,
  reorderTasks,
  deleteShipment,
  updateShipmentFlags,
  getActivityLogs,
  getCurrentUser,
  subscribeToStore,
  addCommentToShipment,
  deleteCommentFromShipment,
  toggleCommentImportant,
  updateShipmentMilestones,
  updateShipmentPdf,
  completeAllTasksForShipment,
  getShipments,
} from '../lib/storageManager';

import { fetchAllOperators } from '../lib/operatorService';
import { fetchAllTaskMasters, getLocalTaskMasters } from '../lib/taskMasterService';
import { isHeavyShipment, isImportantShipment } from '../lib/awbUtils';
import { TaskMaster } from '../types';
import { CustomsQaRelayPanel } from './CustomsQaRelayPanel';
import { getCustomsQaStatusBadgeInfo } from '../lib/m365EmailService';
import {
  ArrowLeft,
  Plane,
  Calendar,
  FileText,
  UserCheck,
  CheckCircle2,
  Clock,
  Circle,
  Plus,
  Trash2,
  History,
  ShieldCheck,
  Flame,
  User as UserIcon,
  Tag,
  Hash,
  AlertCircle,
  FileCheck,
  ZoomIn,
  Star,
  Zap,
  Package,
  Scale,
  MessageSquare,
  Send,
  Edit3,
  Edit2,
  Mail,
  FileUp,
  Flag,
  ChevronUp,
  ChevronDown,
  Layers,
  Sparkles,
  CheckCheck,
  Check,
  X,
  ExternalLink,
} from 'lucide-react';
import { PdfZoomModal } from './PdfZoomModal';
import { SiDocumentViewer } from './SiDocumentViewer';
import { ShipmentEditModal } from './ShipmentEditModal';
import { CustomsEmailModal } from './CustomsEmailModal';

interface ShipmentDetailProps {
  shipment: Shipment;
  onBack: () => void;
  onShipmentChange?: (shipmentId: string) => void;
}

export const ShipmentDetail: React.FC<ShipmentDetailProps> = ({
  shipment: initialShipment,
  onBack,
  onShipmentChange,
}) => {
  const [shipment, setShipment] = useState<Shipment>(initialShipment);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'comments' | 'logs' | 'customs_qa'>('tasks');
  const [showZoomModal, setShowZoomModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showCustomsQaModal, setShowCustomsQaModal] = useState(false);
  const [showDeleteShipmentConfirm, setShowDeleteShipmentConfirm] = useState(false);
  const [showCompleteAllModal, setShowCompleteAllModal] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<{ id: string; title: string } | null>(null);
  const detailFileInputRef = React.useRef<HTMLInputElement>(null);
  const [isUploadingDetailPdf, setIsUploadingDetailPdf] = useState(false);
  const currentUser = getCurrentUser();

  const handleHeaderPdfReuploadClick = () => {
    if (detailFileInputRef.current) {
      detailFileInputRef.current.click();
    }
  };

  const handleHeaderPdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDFファイル(.pdf)を選択してください。');
      return;
    }

    setIsUploadingDetailPdf(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64 = reader.result as string;
        const updated = updateShipmentPdf(shipment.id, base64);
        if (updated) {
          setShipment({ ...updated });
        }
        setIsUploadingDetailPdf(false);
        alert(`指示書「${file.name}」を正常に再アップロードし、サーバーおよび全端末へ同期更新しました。`);
      };
      reader.onerror = () => {
        setIsUploadingDetailPdf(false);
        alert('ファイルの読み込みに失敗しました。');
      };
    } catch (err) {
      setIsUploadingDetailPdf(false);
      alert('PDF再アップロード処理に失敗しました。');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const [operators, setOperators] = useState<Operator[]>([]);
  const [taskMasters, setTaskMasters] = useState<TaskMaster[]>([]);
  const [selectedMasterId, setSelectedMasterId] = useState('');
  const [newTaskShortName, setNewTaskShortName] = useState('');
  const [commentContent, setCommentContent] = useState('');
  const [commentAuthor, setCommentAuthor] = useState(currentUser.displayName || 'チームメンバー');
  const [isImportantMemo, setIsImportantMemo] = useState(false);
  const [animatingTask, setAnimatingTask] = useState<{ id: string; type: 'complete' | 'deflate' } | null>(null);

  const refreshData = () => {
    const updatedLogs = getActivityLogs(initialShipment.id);
    setLogs(updatedLogs);
    const updatedShipment = getShipments().find((s) => s.id === initialShipment.id);
    if (updatedShipment) {
      setShipment({ ...updatedShipment });
    }
  };

  useEffect(() => {
    refreshData();
    fetchAllOperators().then((ops) => {
      if (ops && ops.length > 0) {
        setOperators(ops);
      }
    });

    const localTms = getLocalTaskMasters();
    setTaskMasters(localTms);
    fetchAllTaskMasters().then((tms) => {
      if (tms && tms.length > 0) {
        setTaskMasters(tms);
      }
    });

    const unsubscribe = subscribeToStore(() => {
      refreshData();
      fetchAllOperators().then((ops) => {
        if (ops && ops.length > 0) {
          setOperators(ops);
        }
      });
      fetchAllTaskMasters().then((tms) => {
        if (tms && tms.length > 0) {
          setTaskMasters(tms);
        }
      });
    });
    return () => unsubscribe();
  }, [initialShipment.id]);

  const handleStatusChange = (e: React.MouseEvent | undefined, taskId: string, newStatus: TaskStatus) => {
    const isNowCompleting = newStatus === 'Completed';
    const isNowTodo = newStatus === 'Todo';
    const currentTask = shipment.tasks.find((t) => t.id === taskId);
    const wasCompleted = currentTask?.status === 'Completed';

    if (isNowCompleting) {
      setAnimatingTask({ id: taskId, type: 'complete' });

      if (e) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = (rect.left + rect.width / 2) / window.innerWidth;
        const y = (rect.top + rect.height / 2) / window.innerHeight;

        try {
          // Wave 1: Immediate punchy burst from check button (emerald, teal, amber gold, sky blue, fuchsia)
          confetti({
            particleCount: 55,
            spread: 75,
            origin: { x, y },
            colors: ['#10B981', '#34D399', '#059669', '#F59E0B', '#3B82F6', '#EC4899'],
            ticks: 200,
            gravity: 1.1,
            scalar: 1.0,
            shapes: ['circle', 'square'],
          });

          // Wave 2: Sparkling star cascade showering upwards and down
          setTimeout(() => {
            confetti({
              particleCount: 30,
              angle: 90,
              spread: 95,
              origin: { x, y: Math.max(0, y - 0.04) },
              colors: ['#34D399', '#FBBF24', '#F43F5E', '#A7F3D0', '#60A5FA'],
              ticks: 170,
              gravity: 1.2,
              scalar: 1.2,
            });
          }, 90);

          // If completing this task causes ALL tasks to be completed, trigger grand celebration
          const remainingIncomplete = shipment.tasks.filter((t) => t.id !== taskId && t.status !== 'Completed').length;
          if (remainingIncomplete === 0) {
            setTimeout(() => {
              confetti({
                particleCount: 85,
                spread: 110,
                origin: { x: 0.5, y: 0.4 },
                colors: ['#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6'],
                ticks: 240,
                gravity: 1.0,
                scalar: 1.1,
              });
            }, 280);
          }
        } catch {
          // safe fallback
        }
      }
    } else if (isNowTodo || wasCompleted) {
      setAnimatingTask({ id: taskId, type: 'deflate' });
    }

    setTimeout(() => {
      setAnimatingTask((prev) => (prev?.id === taskId ? null : prev));
    }, 950);

    const updated = updateTaskStatus(shipment.id, taskId, newStatus);
    if (updated) {
      setShipment({ ...updated });
    }
  };

  const handleAssigneeChange = (taskId: string, selectedValue: string) => {
    if (!selectedValue) {
      const updated = assignTask(shipment.id, taskId, null);
      if (updated) setShipment({ ...updated });
      return;
    }

    // 担当者マスタより検索
    const foundOp = operators.find((op) => op.email === selectedValue || op.id === selectedValue);
    let assignedUser: User | null = null;

    if (foundOp) {
      assignedUser = {
        uid: foundOp.id || foundOp.email,
        email: foundOp.email,
        displayName: foundOp.name,
        department: foundOp.department,
      };
    }

    const updated = assignTask(shipment.id, taskId, assignedUser);
    if (updated) {
      setShipment({ ...updated });
    }
  };

  const handleSelectTaskMaster = (masterId: string) => {
    setSelectedMasterId(masterId);
    if (!masterId) return;
    const found = taskMasters.find((tm) => tm.id === masterId);
    if (found) {
      setNewTaskTitle(found.content);
      setNewTaskShortName(found.shortName || '');
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const updated = addTaskToShipment(
      shipment.id,
      newTaskTitle.trim(),
      newTaskShortName.trim() || undefined
    );
    if (updated) {
      setShipment({ ...updated });
      setNewTaskTitle('');
      setNewTaskShortName('');
      setSelectedMasterId('');
      setShowAddTask(false);
    }
  };

  const handleMoveTaskUp = (index: number) => {
    if (index <= 0) return;
    const updatedTasks = [...shipment.tasks];
    const temp = updatedTasks[index];
    updatedTasks[index] = updatedTasks[index - 1];
    updatedTasks[index - 1] = temp;

    const updated = reorderTasks(shipment.id, updatedTasks);
    if (updated) {
      setShipment({ ...updated });
    }
  };

  const handleMoveTaskDown = (index: number) => {
    if (index >= shipment.tasks.length - 1) return;
    const updatedTasks = [...shipment.tasks];
    const temp = updatedTasks[index];
    updatedTasks[index] = updatedTasks[index + 1];
    updatedTasks[index + 1] = temp;

    const updated = reorderTasks(shipment.id, updatedTasks);
    if (updated) {
      setShipment({ ...updated });
    }
  };

  const handleDeleteTask = (task: Task) => {
    setTaskToDelete({ id: task.id, title: task.title });
  };

  const confirmDeleteTask = () => {
    if (!taskToDelete) return;
    const updated = deleteTaskFromShipment(shipment.id, taskToDelete.id);
    if (updated) {
      setShipment({ ...updated });
    }
    setTaskToDelete(null);
  };

  const handleToggleImportant = () => {
    const updated = updateShipmentFlags(shipment.id, { isImportant: !shipment.isImportant });
    if (updated) setShipment({ ...updated });
  };

  const handleToggleUrgent = () => {
    const updated = updateShipmentFlags(shipment.id, { isUrgent: !shipment.isUrgent });
    if (updated) setShipment({ ...updated });
  };

  const handleToggleDgCargo = () => {
    const updated = updateShipmentFlags(shipment.id, { isDgCargo: !shipment.isDgCargo });
    if (updated) setShipment({ ...updated });
  };

  const isHeavy = isHeavyShipment(shipment);

  const handleToggleHeavyCargo = () => {
    const updated = updateShipmentFlags(shipment.id, { isHeavyCargo: !isHeavy });
    if (updated) setShipment({ ...updated });
  };

  const handleToggleMilestone = (key: MilestoneKey, currentCompleted: boolean) => {
    const updated = updateShipmentMilestones(shipment.id, key, !currentCompleted);
    if (updated) {
      setShipment({ ...updated });
    }
  };

  const completedCount = shipment.tasks.filter((t) => t.status === 'Completed').length;
  const uncompletedTasksCount = shipment.tasks.filter((t) => t.status !== 'Completed').length;
  const isAllCompleted = shipment.tasks.length > 0 && uncompletedTasksCount === 0;
  const totalCount = shipment.tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleCompleteAllTasks = () => {
    const updated = completeAllTasksForShipment(shipment.id);
    if (updated) {
      setShipment({ ...updated });
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {
        // ignore
      }
    }
    setShowCompleteAllModal(false);
  };

  // Keyboard shortcut: Shift + C to trigger "Complete All Tasks"
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Check for Shift + C (or Shift + c)
      if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        // If zoom modal is open, let zoom modal handle it
        if (showZoomModal) return;

        if (isAllCompleted) {
          alert('すべての工程タスクは既に完了しています。');
          return;
        }
        setShowCompleteAllModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAllCompleted, showZoomModal]);

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentContent.trim()) return;
    const updated = addCommentToShipment(shipment.id, commentContent, commentAuthor, isImportantMemo);
    if (updated) {
      setShipment({ ...updated });
      setCommentContent('');
      setIsImportantMemo(false);
    }
  };

  const handleQuickNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentContent.trim()) return;
    const updated = addCommentToShipment(shipment.id, commentContent, commentAuthor, isImportantMemo);
    if (updated) {
      setShipment({ ...updated });
      setCommentContent('');
      setIsImportantMemo(false);
    }
  };

  const handleToggleCommentImportant = (commentId: string) => {
    const updated = toggleCommentImportant(shipment.id, commentId);
    if (updated) setShipment({ ...updated });
  };

  const handleDeleteComment = (commentId: string) => {
    const updated = deleteCommentFromShipment(shipment.id, commentId);
    if (updated) setShipment({ ...updated });
  };

  const handleDeleteShipment = () => {
    setShowDeleteShipmentConfirm(true);
  };

  const confirmDeleteShipment = () => {
    deleteShipment(shipment.id);
    setShowDeleteShipmentConfirm(false);
    onBack();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Hidden File Input for PDF Re-upload */}
      <input
        type="file"
        ref={detailFileInputRef}
        onChange={handleHeaderPdfChange}
        accept=".pdf,application/pdf"
        className="hidden"
      />

      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={onBack}
            className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            ダッシュボードへ戻る
          </button>

          <button
            onClick={handleDeleteShipment}
            className="inline-flex items-center px-3 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors shadow-2xs cursor-pointer"
            title="この案件情報をシステムから完全に削除します"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5 text-rose-600" />
            案件を削除
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleHeaderPdfReuploadClick}
            disabled={isUploadingDetailPdf}
            className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-indigo-900 bg-indigo-100 hover:bg-indigo-200 border border-indigo-300 rounded-xl transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            title="この案件の指示書PDFを再アップロード・差替同期します"
          >
            <FileUp className="w-4 h-4 mr-1.5 text-indigo-700" />
            {isUploadingDetailPdf ? 'PDF更新中...' : 'PDF再アップロード'}
          </button>

          <button
            onClick={() => setShowEmailModal(true)}
            className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors shadow-2xs cursor-pointer"
            title="通関依頼メールのタイトル・本文を自働作成"
          >
            <Mail className="w-4 h-4 mr-1.5 text-indigo-600" />
            通関依頼メール作成
          </button>

          <button
            onClick={() => {
              setActiveTab('customs_qa');
              setShowCustomsQaModal(true);
            }}
            className="inline-flex items-center px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer border text-blue-800 bg-blue-50 hover:bg-blue-100 border-blue-200 hover:border-blue-300"
            title="通関質疑 ＆ ヘルマン照会ハブをポップアップ画面で開きます"
          >
            <MessageSquare className="w-4 h-4 mr-1.5 text-blue-600" />
            <span>通関質疑ハブ</span>
            {(shipment.customsQas || []).length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-blue-200 text-blue-900 font-bold">
                {shipment.customsQas?.length}
              </span>
            )}
          </button>


          <button
            onClick={() => setShowEditModal(true)}
            className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors shadow-2xs cursor-pointer"
            title="MAWB/HAWB番号、荷主、通関日、フライト、担当者などの基本情報を編集"
          >
            <Edit3 className="w-4 h-4 mr-1.5 text-amber-600" />
            基本情報・担当者を編集
          </button>

          <button
            onClick={() => setShowZoomModal(true)}
            className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors shadow-2xs cursor-pointer"
            title="PDFプレビュー上で手書きメモ・テキスト注記を直接描画・Firestore保存"
          >
            <Edit2 className="w-4 h-4 mr-1.5 text-blue-600" />
            PDF指示書 ＆ 手書きメモ描画
          </button>

          <button
            type="button"
            onClick={() => {
              if (isAllCompleted) {
                alert('すべての工程タスクは既に完了しています。');
                return;
              }
              setShowCompleteAllModal(true);
            }}
            disabled={isAllCompleted}
            className={`inline-flex items-center px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer border ${
              isAllCompleted
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 opacity-90 cursor-default'
                : 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white border-emerald-500 shadow-xs hover:shadow-emerald-600/30'
            }`}
            title="すべての工程タスクを一括完了 [Shift + C]"
          >
            <CheckCheck className="w-4 h-4 mr-1.5" />
            <span>{isAllCompleted ? '全タスク完了済' : '全タスク一括完了'}</span>
            <span
              className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-mono rounded font-extrabold ${
                isAllCompleted ? 'bg-emerald-200 text-emerald-900' : 'bg-emerald-700/80 text-emerald-100'
              }`}
            >
              Shift+C
            </span>
          </button>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500">案件総合ステータス:</span>
            {shipment.status === 'Completed' && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" /> 全工程完了
              </span>
            )}
            {shipment.status === 'In Progress' && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center shadow-xs">
                <Clock className="w-3.5 h-3.5 mr-1 text-amber-600 animate-pulse" /> 進行中
              </span>
            )}
            {shipment.status === 'Todo' && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 flex items-center">
                <Circle className="w-3.5 h-3.5 mr-1 text-slate-500" /> 未着手
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Shipment Information Card */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl border border-slate-800 space-y-4">
        {/* Prominent Cut Time Alert Banner */}
        {shipment.cutTime && (
          <div className="bg-gradient-to-r from-rose-950 via-rose-900 to-slate-900 border-2 border-rose-500 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg shadow-rose-950/60 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center space-x-3.5">
              <div className="p-2.5 bg-rose-600 rounded-xl text-white shadow-md animate-pulse shrink-0">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase text-rose-300 tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping inline-block"></span>
                  カット時間指定あり (CUT TIME)
                </div>
                <div className="text-2xl font-black font-mono text-white tracking-tight flex items-baseline gap-2">
                  <span>{shipment.cutTime}</span>
                  <span className="text-xs font-normal text-rose-200">までに搬入・処理必須</span>
                </div>
              </div>
            </div>
            <div className="px-4 py-1.5 bg-rose-600/90 text-white font-bold text-xs rounded-xl border border-rose-400/80 shadow-xs flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
              最優先注意案件
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row justify-between md:items-center pb-4 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded bg-blue-600/30 text-blue-300 border border-blue-500/40">
                管理ID (プライマリキー)
              </span>
              {shipment.hawbNumber ? (
                <span className="text-xs text-slate-400">✔ HAWB優先キー</span>
              ) : (
                <span className="text-xs text-indigo-300">✔ MAWB直截キー</span>
              )}
              {shipment.isDgCargo && (
                <span className="px-2.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/30 text-amber-300 border border-amber-500/50 inline-flex items-center gap-1">
                  <Flame className="w-3 h-3 text-amber-400" />
                  DG (危険物貨物)
                </span>
              )}
              {isImportantShipment(shipment) && (
                <span className="px-2.5 py-0.5 text-[10px] font-black rounded bg-red-600 text-white border border-red-500 inline-flex items-center gap-1 shadow-sm animate-pulse">
                  <Star className="w-3 h-3 text-white fill-white" />
                  重要案件 (薄赤色表示)
                </span>
              )}
              {isHeavy && (
                <span className="px-2.5 py-0.5 text-[10px] font-black rounded bg-amber-500 text-white border border-amber-400 inline-flex items-center gap-1 shadow-sm animate-pulse">
                  <Scale className="w-3 h-3 text-white" />
                  重量案件 (1000kg+)
                </span>
              )}
              {shipment.assignedOperator && (
                <span className="px-2.5 py-0.5 text-[10px] font-bold rounded bg-blue-500/30 text-blue-300 border border-blue-500/50 inline-flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-blue-400" />
                  担当: {shipment.assignedOperator.name}
                </span>
              )}
              {shipment.cutTime && (
                <span className="px-2.5 py-0.5 text-[12px] font-bold rounded bg-rose-600 text-white border border-rose-500 inline-flex items-center gap-1 shadow-sm animate-pulse">
                  <Clock className="w-4 h-4 text-white" />
                  CUT: {shipment.cutTime}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold font-mono text-white flex items-center space-x-3">
                <span>{shipment.id}</span>
              </h2>

              {/* 優先度・状態設定コントロール (重要案件・緊急案件・DG危険物の切替) */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-800/90 p-1.5 rounded-2xl border border-slate-700/80 shadow-xs">
                <span className="text-[10px] text-slate-400 font-bold px-1.5 uppercase">設定切替:</span>
                
                {/* 重要案件トグルボタン (薄赤色バックカラー表示) */}
                <button
                  type="button"
                  onClick={handleToggleImportant}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 border select-none ${
                    shipment.isImportant
                      ? 'bg-red-600 text-white border-red-500 shadow-sm hover:bg-red-700 animate-pulse'
                      : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-red-300'
                  }`}
                  title="クリックで重要案件（薄赤色バックカラー表示）の設定を切り替えます"
                >
                  <Star className={`w-3.5 h-3.5 ${shipment.isImportant ? 'fill-current text-white' : 'text-red-400'}`} />
                  <span>重要案件 {shipment.isImportant ? '【ON】' : '【OFF】'}</span>
                </button>

                {/* 緊急案件トグルボタン */}
                <button
                  type="button"
                  onClick={handleToggleUrgent}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 border select-none ${
                    shipment.isUrgent
                      ? 'bg-rose-600 text-white border-rose-500 shadow-sm hover:bg-rose-700 animate-pulse'
                      : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-rose-400'
                  }`}
                  title="クリックで緊急案件の設定を切り替えます"
                >
                  <Zap className={`w-3.5 h-3.5 ${shipment.isUrgent ? 'fill-current text-rose-100' : 'text-rose-400'}`} />
                  <span>緊急案件 {shipment.isUrgent ? '【ON】' : '【OFF】'}</span>
                </button>

                {/* DG (危険物) トグルボタン */}
                <button
                  type="button"
                  onClick={handleToggleDgCargo}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 border select-none ${
                    shipment.isDgCargo
                      ? 'bg-amber-600/90 text-amber-100 border-amber-500 shadow-sm hover:bg-amber-600'
                      : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-amber-400'
                  }`}
                  title="クリックでDG(危険物)の有無を設定切替します"
                >
                  <Flame className={`w-3.5 h-3.5 ${shipment.isDgCargo ? 'text-amber-300 fill-amber-300/30' : 'text-amber-400'}`} />
                  <span>{shipment.isDgCargo ? 'DG品 (危険物)' : '非DG (一般貨物)'}</span>
                </button>

                {/* 重量案件トグルボタン (1000kg以上・黄色系バックカラー表示) */}
                <button
                  type="button"
                  onClick={handleToggleHeavyCargo}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 border select-none ${
                    isHeavy
                      ? 'bg-amber-500 text-white border-amber-400 shadow-sm hover:bg-amber-600 animate-pulse'
                      : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-amber-400'
                  }`}
                  title="クリックで重量案件（1000kg以上・黄色系バックカラー表示）の設定を切り替えます"
                >
                  <Scale className={`w-3.5 h-3.5 ${isHeavy ? 'text-white' : 'text-amber-400'}`} />
                  <span>重量案件 {isHeavy ? '【ON】' : '【OFF】'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs bg-slate-800/80 p-2.5 sm:p-3 rounded-2xl border border-slate-700/60">
            <div>
              <span className="text-slate-400 block text-[10px]">MAWB番号</span>
              <span className="font-mono font-bold text-slate-200">{shipment.mawbNumber}</span>
            </div>
            <div className="border-l border-slate-700 h-6" />
            <div>
              <span className="text-slate-400 block text-[10px]">HAWB番号</span>
              <span className="font-mono font-bold text-slate-200">{shipment.hawbNumber || '未割当'}</span>
            </div>
            <div className="border-l border-slate-700 h-6" />
            <div>
              <span className="text-slate-400 block text-[10px]">個数 / 重量</span>
              <span className={`font-mono font-bold ${isHeavy ? 'text-amber-200 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-600' : 'text-blue-300'}`}>
                {shipment.pieces || '-'} / {shipment.grossWeight || '-'}
                {isHeavy && <span className="ml-1 text-[9.5px] text-slate-950 bg-amber-400 px-1 py-0.2 rounded font-black">重量</span>}
              </span>
            </div>
            <div className="border-l border-slate-700 h-6" />
            <button
              type="button"
              onClick={() => setShowEditModal(true)}
              className="p-1.5 px-2.5 text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/40 rounded-xl transition-colors cursor-pointer flex items-center gap-1 text-xs border border-amber-500/40 font-bold"
              title="MAWB/HAWB/個数/重量/荷主/フライト/通関日/担当者を編集"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>編集</span>
            </button>
          </div>
        </div>

        {/* Cargo & Order Meta Details + Embedded PDF Preview Thumbnail */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 text-xs pt-1 items-start">
          {/* 左側: 全情報統合エリア（Shipper & Consignee まとめ + オーダー詳細 + 特記事項） */}
          <div className="lg:col-span-7 space-y-2.5">
            {/* SHIPPER & CONSIGNEE 1つの統合まとめエリア */}
            <div className="bg-slate-800/70 py-2.5 px-3.5 rounded-2xl border border-slate-700/80 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-700/70">
                <div className="pr-0 sm:pr-3 space-y-0.5">
                  <span className="text-slate-400 text-[11px] uppercase font-bold flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-400 mr-1.5 inline-block shrink-0"></span>
                    SHIPPER (輸出荷主)
                  </span>
                  <span className="font-bold text-white text-sm sm:text-[15px] leading-snug block">{shipment.shipper}</span>
                </div>
                <div className="pt-2 sm:pt-0 sm:pl-3 space-y-0.5">
                  <span className="text-slate-400 text-[11px] uppercase font-bold flex items-center">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 mr-1.5 inline-block shrink-0"></span>
                    CONSIGNEE (輸入荷受人)
                  </span>
                  <span className="font-bold text-white text-sm sm:text-[15px] leading-snug block">{shipment.consignee}</span>
                </div>
              </div>
            </div>

            {/* 積地・向地(DEST) & フライト・通関詳細 (向け地、カット時間、個数、重量を明確表示) */}
            <div className="bg-slate-800/50 py-2.5 px-3.5 rounded-2xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">向け地 (DEST):</span>
                <span className="font-bold text-blue-200 text-sm sm:text-[15px] leading-snug block">{shipment.destination || '未設定'}</span>
              </div>
              <div className={shipment.cutTime ? 'bg-rose-950/70 p-1.5 rounded-xl border border-rose-500/60 shadow-xs' : ''}>
                <span className="text-slate-400 text-[11px] block font-medium">カット時間:</span>
                <span className={shipment.cutTime ? 'font-bold text-rose-300 text-sm sm:text-[15px] font-mono flex items-center gap-1 leading-snug' : 'font-bold text-blue-200 text-sm sm:text-[15px] leading-snug'}>
                  {shipment.cutTime ? (
                    <>
                      <Clock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      {shipment.cutTime}
                    </>
                  ) : (
                    '設定なし'
                  )}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">個数 (Pieces):</span>
                <span className="font-bold text-indigo-200 text-[21px] sm:text-[22.5px] font-mono leading-tight block">
                  {shipment.pieces || ((shipment as any).pkgCount ? `${(shipment as any).pkgCount} 個` : '-')}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">重量 (Gross Wt):</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`font-bold text-[21px] sm:text-[22.5px] font-mono leading-tight block ${isHeavy ? 'text-amber-300' : 'text-indigo-200'}`}>
                    {shipment.grossWeight || ((shipment as any).weight ? `${(shipment as any).weight} kg` : '-')}
                  </span>
                  {isHeavy && (
                    <span className="px-1.5 py-0.5 text-[10px] font-black bg-amber-400 text-slate-950 rounded border border-amber-500 animate-pulse">
                      重量案件
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">FLAG (船籍):</span>
                <span className="font-bold text-emerald-300 font-mono text-[13px] sm:text-sm flex items-center gap-1 leading-snug">
                  <Flag className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  {shipment.flag ? shipment.flag : '-'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">積地:</span>
                <span className="font-bold text-blue-200 text-[13px] sm:text-sm leading-snug block">{shipment.portOfLoading || '未設定'}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">フライト:</span>
                <span className="font-bold text-blue-200 text-[19.5px] sm:text-[21px] font-mono leading-tight block">{shipment.flightRoute}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">通関予定日:</span>
                <span className="font-bold text-slate-100 text-[19.5px] sm:text-[21px] font-mono leading-tight block">{shipment.customsClearanceDate}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">INVOICE NO.:</span>
                <span className="font-mono font-semibold text-slate-200 text-[13px] sm:text-sm leading-snug block">{shipment.invoiceNumber}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block font-medium">受注NO.:</span>
                <span className="font-mono font-semibold text-slate-200 text-[13px] sm:text-sm leading-snug block">{shipment.orderNumber}</span>
              </div>
            </div>

            {/* Special Notes / Remarks section if present */}
            {shipment.specialNotes && (
              <div className="bg-slate-800/60 py-2.5 px-3.5 rounded-2xl border border-slate-700/80 space-y-1">
                <span className="text-amber-300 font-bold text-xs flex items-center gap-1">
                  <span>📌 特記事項 (PDFから自動抽出):</span>
                </span>
                <p className="font-mono whitespace-pre-wrap text-xs sm:text-[13px] text-slate-100 leading-relaxed">{shipment.specialNotes}</p>
              </div>
            )}
          </div>

          {/* 右側: PDF プレビュー サムネイルエリア (拡大・縮小ボタン付き) - 左側エリアの高さに合わせたコンパクト設計 */}
          <div className="lg:col-span-5 bg-slate-800/70 p-3 rounded-2xl border border-slate-700/80 flex flex-col h-[370px] shadow-sm">
            <div className="flex justify-between items-center px-1 mb-2 shrink-0">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-400" />
                <span>PDF指示書 プレビュー</span>
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowZoomModal(true)}
                  className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-slate-700/70 hover:bg-slate-700 px-2.5 py-1 rounded-xl transition-colors cursor-pointer border border-slate-600/50"
                  title="全画面拡大プレビューモーダルを開く"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                  <span>全画面拡大</span>
                </button>
              </div>
            </div>
            <div className="flex-1 w-full overflow-hidden rounded-xl relative border border-slate-700/60 shadow-inner flex flex-col min-h-0">
              <SiDocumentViewer
                shipment={shipment}
                isThumbnail={true}
                onClick={() => setShowZoomModal(true)}
                onShipmentUpdated={(updated) => setShipment({ ...updated })}
              />
            </div>
          </div>
        </div>

        {/* Progress Bar Summary */}
        <div className="pt-2">
          <div className="flex justify-between text-xs text-slate-300 mb-1.5 font-medium">
            <span>全体タスク達成率 ({completedCount} / {totalCount} 工程完了)</span>
            <span className="font-bold text-blue-400">{progressPct}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden border border-slate-700">
            <div
              className={`h-full transition-all duration-500 ${
                progressPct === 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Key Progress Milestones Visual Timeline Component */}
      {(() => {
        const milestoneLabelMap: Record<MilestoneKey, string> = {
          document_received: '貨物搬入済',
          customs_cleared: 'X線検査結果入手',
          customs_permit: '許可書入手',
          onboarded: '請求書メール',
        };

        const defaultList: MilestoneState[] = [
          { key: 'document_received', label: '貨物搬入済', completed: false, completedAt: null },
          { key: 'customs_cleared', label: 'X線検査結果入手', completed: false, completedAt: null },
          { key: 'customs_permit', label: '許可書入手', completed: false, completedAt: null },
          { key: 'onboarded', label: '請求書メール', completed: false, completedAt: null },
        ];

        const existingMap = new Map<MilestoneKey, MilestoneState>(
          (shipment.milestones || []).map((m) => [m.key, m])
        );
        const milestonesList: MilestoneState[] = defaultList.map((def) => {
          const existing = existingMap.get(def.key);
          if (existing) {
            return {
              key: def.key,
              label: milestoneLabelMap[def.key] || def.label,
              completed: !!existing.completed,
              completedAt: existing.completedAt || null,
              updatedAt: existing.updatedAt || null,
            };
          }
          return def;
        });

        return (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg text-white space-y-4">
            <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-600/30 text-blue-400 rounded-xl border border-blue-500/40 shadow-xs">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                    <span>進捗マイルストーン (Key Milestones)</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] border border-emerald-500/30 font-semibold flex items-center gap-1">
                      <span>☁️ Firestore自動保存</span>
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    主要4ステップの進捗状態をリアルタイムで追跡・タイムスタンプ付きでFirestoreへ自動同期します。
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-1">
              {milestonesList.map((m, idx) => {
                const isCompleted = m.completed;
                return (
                  <div
                    key={m.key}
                    onClick={() => handleToggleMilestone(m.key, isCompleted)}
                    className={`relative flex items-center p-4 rounded-2xl border transition-all cursor-pointer select-none group ${
                      isCompleted
                        ? 'bg-emerald-950/40 border-emerald-500/60 hover:bg-emerald-900/50 shadow-sm'
                        : 'bg-slate-800/60 border-slate-700/80 hover:bg-slate-800 hover:border-slate-600'
                    }`}
                  >
                    {/* Visual Connector line between milestone nodes */}
                    {idx < milestonesList.length - 1 && (
                      <div className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                        <span className={`block w-2.5 h-0.5 ${isCompleted ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                      </div>
                    )}

                    <div className="flex items-start space-x-3.5 w-full">
                      <div
                        className={`p-2 rounded-xl shrink-0 transition-all ${
                          isCompleted
                            ? 'bg-emerald-500 text-slate-950 font-bold shadow-md scale-105'
                            : 'bg-slate-700 text-slate-400 group-hover:bg-slate-600 group-hover:text-slate-200'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-slate-400 tracking-wider">STEP 0{idx + 1}</span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isCompleted
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-700/60 text-slate-400'
                            }`}
                          >
                            {isCompleted ? '完了' : '未完了'}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-100 truncate">{m.label}</h4>
                        <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{isCompleted && m.completedAt ? `完了日時: ${m.completedAt}` : 'クリックで完了に変更'}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 担当者クイックメモ・進捗投稿バー (Quick Memo Post Bar) */}
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50/50 to-slate-50 border border-blue-200/80 rounded-3xl p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200/60 pb-2.5">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-blue-600 text-white rounded-xl shadow-2xs">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>担当者クイックメモ・連絡事項の即時投稿</span>
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold">
                  ワンタップ保存
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                通関連絡・梱包変更・担当者からの引継ぎメモ等を素早く保存できます。
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-500 font-semibold text-[11px]">投稿者名:</span>
            <input
              type="text"
              value={commentAuthor}
              onChange={(e) => setCommentAuthor(e.target.value)}
              placeholder="担当者氏名"
              className="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/40 w-32 shadow-2xs"
            />
          </div>
        </div>

        <form onSubmit={handleQuickNoteSubmit} className="flex flex-col sm:flex-row items-stretch gap-2.5">
          <div className="flex-1 relative">
            <input
              type="text"
              required
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              placeholder="例: 「14:00通関完了予定」「保税倉庫搬入完了」「書類差し替えあり」..."
              className="w-full bg-white border border-slate-300 rounded-2xl px-4 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-2xs font-medium placeholder:text-slate-400"
            />
          </div>

          {/* 重要フラグ切り替えボタン (デフォルトOFF) */}
          <button
            type="button"
            onClick={() => setIsImportantMemo(!isImportantMemo)}
            className={`px-3.5 py-2.5 text-xs font-bold rounded-2xl border transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-2xs ${
              isImportantMemo
                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 ring-2 ring-rose-300 animate-pulse'
                : 'bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border-slate-300 hover:border-rose-300'
            }`}
            title="重要フラグ (ONにするとダッシュボード等で赤色強調表示されます)"
          >
            <Star className={`w-3.5 h-3.5 ${isImportantMemo ? 'fill-current text-white' : 'text-slate-400'}`} />
            <span>重要フラグ: {isImportantMemo ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="submit"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold text-xs rounded-2xl shadow-sm hover:shadow-md transition-all inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>メモを投稿</span>
          </button>
        </form>

        {/* 直近メモのクイックプレビュー (全文表示) */}
        {shipment.comments && shipment.comments.length > 0 && (
          <div className="pt-1 flex flex-col sm:flex-row sm:items-start gap-2 text-xs">
            <span className="text-[11px] font-bold text-slate-500 shrink-0 sm:pt-1">最新のメモ:</span>
            <div className="flex-1 flex flex-wrap items-center gap-2">
              {shipment.comments.slice(0, 3).map((c) => (
                <div
                  key={c.id}
                  onClick={() => setActiveTab('comments')}
                  className={`border rounded-xl px-3 py-1.5 text-[11px] flex items-center flex-wrap gap-x-2 gap-y-1 cursor-pointer shadow-2xs transition-colors ${
                    c.isImportant
                      ? 'bg-rose-50 hover:bg-rose-100 border-rose-300 text-rose-900 ring-1 ring-rose-300 font-semibold'
                      : 'bg-white/90 hover:bg-white border-blue-200/90 text-slate-700'
                  }`}
                  title="クリックでチームコメント詳細一覧へ移動"
                >
                  {c.isImportant && (
                    <span className="px-1.5 py-0.5 bg-rose-600 text-white font-black text-[9.5px] rounded shadow-2xs shrink-0 flex items-center gap-0.5">
                      <span>🔴</span>
                      <span>重要</span>
                    </span>
                  )}
                  <span className={`font-bold shrink-0 ${c.isImportant ? 'text-rose-800' : 'text-blue-700'}`}>{c.authorName}:</span>
                  <span className={`whitespace-normal break-words ${c.isImportant ? 'text-rose-950 font-bold' : 'text-slate-800'}`}>{c.content}</span>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">({c.formattedTime.split(' ')[1] || c.formattedTime})</span>
                </div>
              ))}
              {shipment.comments.length > 3 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('comments')}
                  className="text-[11px] font-bold text-blue-600 hover:underline px-1 py-1"
                >
                  他{shipment.comments.length - 3}件の全メモを見る →
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Tabs: Tasks vs Comments vs Logs */}
      <div id="main-tabs-section" className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden scroll-mt-6">
        <div className="border-b border-slate-200 px-6 pt-4 flex justify-between items-center bg-slate-50/50">
          <div className="flex space-x-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`pb-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
                activeTab === 'tasks'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileCheck className="w-4 h-4" />
              <span>作業タスク工程一覧 ({totalCount})</span>
            </button>

            <button
              onClick={() => setActiveTab('customs_qa')}
              className={`pb-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
                activeTab === 'customs_qa'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>通関質疑 ＆ ヘルマン照会ハブ ({shipment.customsQas?.length || 0})</span>
              {(shipment.customsQas || []).some((q) => q.status !== 'RESOLVED_TO_BROKER') && (
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('comments')}
              className={`pb-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
                activeTab === 'comments'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>チームコメント・進捗共有 ({shipment.comments?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`pb-3 text-xs font-bold border-b-2 transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${
                activeTab === 'logs'
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <History className="w-4 h-4" />
              <span>操作アクティビティ履歴ログ ({logs.length})</span>
            </button>
          </div>

          {activeTab === 'tasks' && (
            <div className="flex items-center space-x-2 mb-2">
              <button
                type="button"
                onClick={() => {
                  if (isAllCompleted) {
                    alert('すべての工程タスクは既に完了しています。');
                    return;
                  }
                  setShowCompleteAllModal(true);
                }}
                disabled={isAllCompleted}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl inline-flex items-center transition-all cursor-pointer border ${
                  isAllCompleted
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 opacity-90 cursor-default'
                    : 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white border-emerald-500 shadow-xs'
                }`}
                title="すべての工程タスクを一括完了 [Shift + C]"
              >
                <CheckCheck className="w-3.5 h-3.5 mr-1" />
                <span>{isAllCompleted ? '全タスク完了済' : '全タスク一括完了'}</span>
                <span
                  className={`ml-1 px-1 py-0.2 text-[9.5px] font-mono rounded font-extrabold ${
                    isAllCompleted ? 'bg-emerald-200 text-emerald-900' : 'bg-emerald-700/80 text-emerald-100'
                  }`}
                >
                  Shift+C
                </span>
              </button>

              <button
                onClick={() => setShowAddTask(!showAddTask)}
                className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl inline-flex items-center transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                工程タスク追加
              </button>
            </div>
          )}
        </div>

        <div className="p-6">
          {/* Add Task Form */}
          {showAddTask && (
            <form onSubmit={handleAddTask} className="mb-6 p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>新規作業工程タスクの追加</span>
                </h4>
                <span className="text-[11px] text-blue-600 font-medium">マスタから選択 または 自由入力</span>
              </div>

              {/* 作業工程タスクマスタから選択 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-slate-700 shrink-0">作業工程マスタから選択:</label>
                  <select
                    value={selectedMasterId}
                    onChange={(e) => handleSelectTaskMaster(e.target.value)}
                    className="flex-1 bg-white border border-blue-300 text-slate-800 text-xs rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium cursor-pointer"
                  >
                    <option value="">-- マスタから選ぶ (直接入力も可能) --</option>
                    {taskMasters.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        №{tm.orderNumber} [{tm.shortName || '未設定'}] {tm.content} {tm.isDgOnly ? '(DG専用)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* クイック選択チップ */}
                {taskMasters.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-slate-500 font-semibold">クイック選択:</span>
                    {taskMasters.slice(0, 8).map((tm) => (
                      <button
                        key={tm.id}
                        type="button"
                        onClick={() => handleSelectTaskMaster(tm.id)}
                        className={`px-2 py-0.5 text-[11px] rounded-lg border transition-all cursor-pointer ${
                          selectedMasterId === tm.id
                            ? 'bg-blue-600 text-white border-blue-700 font-bold shadow-2xs'
                            : 'bg-white hover:bg-blue-100 text-slate-700 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        {tm.shortName ? `[${tm.shortName}] ` : ''}{tm.content}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 短縮名 & タスク名入力 & アクション */}
              <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center pt-1">
                <div className="w-full sm:w-28 shrink-0">
                  <input
                    type="text"
                    maxLength={5}
                    placeholder="短縮名(5文字)"
                    value={newTaskShortName}
                    onChange={(e) => setNewTaskShortName(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    title="作業短縮文字（最大5文字）"
                  />
                </div>
                <input
                  type="text"
                  required
                  placeholder="例: 原産地証明書申請、特定危険物梱包点検..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>追加</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTask(false);
                      setSelectedMasterId('');
                      setNewTaskTitle('');
                      setNewTaskShortName('');
                    }}
                    className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* TASKS VIEW */}
          {activeTab === 'tasks' && (
            <div className="space-y-3">
              {/* 一括完了クイックアクションバー（タスク一覧の先頭） */}
              <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center space-x-2.5">
                  <div
                    className={`p-2 rounded-xl flex items-center justify-center ${
                      isAllCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    <CheckCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span>工程タスク進捗: {completedCount} / {totalCount} 件完了</span>
                      {isAllCompleted ? (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          ✔ 全工程完了済
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          残り {uncompletedTasksCount} 件
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      すべての工程に問題がなければ、ショートカットキーまたは右側のボタンからワンクリックで全タスクを一括完了できます。
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (isAllCompleted) {
                      alert('すべての工程タスクは既に完了しています。');
                      return;
                    }
                    setShowCompleteAllModal(true);
                  }}
                  disabled={isAllCompleted}
                  className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-xs border ${
                    isAllCompleted
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 opacity-80 cursor-default'
                      : 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white border-emerald-500 hover:shadow-emerald-600/30'
                  }`}
                  title="すべての工程タスクを一括完了 [Shift + C]"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>{isAllCompleted ? '全工程完了済み' : '全タスク一括完了'}</span>
                  <kbd
                    className={`px-1.5 py-0.5 text-[10px] font-mono rounded font-extrabold ${
                      isAllCompleted ? 'bg-emerald-200 text-emerald-900' : 'bg-emerald-700/90 text-emerald-100'
                    }`}
                  >
                    Shift + C
                  </kbd>
                </button>
              </div>
              {shipment.tasks.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">タスクが登録されていません。</div>
              ) : (
                shipment.tasks.map((task, taskIndex) => {
                  const isUrgentTask = task.isUrgent || task.priorityLevel === 'High' || task.priority === 'High' || (shipment.isUrgent && task.status !== 'Completed');
                  const isImportantTask = task.isImportant || task.priorityLevel === 'Medium' || task.priority === 'Medium' || (shipment.isImportant && task.status !== 'Completed');
                  const isAnimating = animatingTask?.id === task.id;
                  const animType = isAnimating ? animatingTask?.type : null;

                  return (
                    <motion.div
                      key={task.id}
                      animate={
                        animType === 'complete'
                          ? {
                              scale: [1, 1.035, 0.98, 1.015, 1],
                              borderColor: ['#10B981', '#34D399', '#059669', '#10B981'],
                              boxShadow: [
                                '0 0 0 0 rgba(16, 185, 129, 0)',
                                '0 0 28px 8px rgba(16, 185, 129, 0.35)',
                                '0 0 0 0 rgba(16, 185, 129, 0)',
                                '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
                              ],
                            }
                          : animType === 'deflate'
                          ? {
                              scale: [1, 0.95, 0.985, 1],
                              y: [0, 2, -1, 0],
                              filter: [
                                'brightness(1)',
                                'brightness(0.92) grayscale(0.35)',
                                'brightness(1) grayscale(0)',
                              ],
                            }
                          : { scale: 1, y: 0 }
                      }
                      transition={{
                        duration: animType === 'complete' ? 0.7 : 0.5,
                        ease: animType === 'complete' ? 'backOut' : 'easeInOut',
                      }}
                      className={`p-4 rounded-2xl border transition-colors relative ${
                        task.status === 'Completed'
                          ? 'bg-emerald-50/60 border-emerald-300 ring-1 ring-emerald-200/70 shadow-2xs'
                          : task.status === 'In Progress'
                          ? 'bg-amber-50/40 border-amber-300 ring-1 ring-amber-200 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                      }`}
                    >
                      {/* Pop-up Celebration Badge on Complete */}
                      <AnimatePresence>
                        {animType === 'complete' && (
                          <motion.div
                            initial={{ opacity: 0, y: 5, scale: 0.5, rotate: -4 }}
                            animate={{ opacity: 1, y: -24, scale: 1.15, rotate: 0 }}
                            exit={{ opacity: 0, y: -34, scale: 0.8 }}
                            transition={{ duration: 0.75, ease: 'easeOut' }}
                            className="absolute -top-1 left-12 z-30 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-black px-3.5 py-1 rounded-full shadow-xl flex items-center space-x-1.5 whitespace-nowrap pointer-events-none border border-emerald-300 ring-2 ring-emerald-400/40"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-spin" />
                            <span>🎉 工程タスク完了! ✨</span>
                          </motion.div>
                        )}

                        {/* Deflation Puff Badge on Revert to Todo */}
                        {animType === 'deflate' && (
                          <motion.div
                            initial={{ opacity: 0, scale: 1.05, y: 0 }}
                            animate={{ opacity: 1, scale: 0.9, y: -18 }}
                            exit={{ opacity: 0, scale: 0.7, y: -26 }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className="absolute -top-1 left-12 z-30 bg-slate-700 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-md flex items-center space-x-1 whitespace-nowrap pointer-events-none"
                          >
                            <span>💨 未着手(予定)へ変更</span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        {/* Task Title, Order & Reorder Buttons */}
                        <div className="flex items-start space-x-3">
                          {/* Order Number & Up/Down Reorder Buttons */}
                          <div className="flex flex-col items-center justify-center shrink-0 space-y-0.5 mt-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveTaskUp(taskIndex)}
                              disabled={taskIndex === 0}
                              className={`p-0.5 rounded transition-colors ${
                                taskIndex === 0
                                  ? 'text-slate-200 cursor-not-allowed'
                                  : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:scale-95 cursor-pointer'
                              }`}
                              title={taskIndex === 0 ? 'これ以上上には移動できません' : '工程を1つ上に移動'}
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>

                            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center shadow-2xs border border-slate-200">
                              {taskIndex + 1}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleMoveTaskDown(taskIndex)}
                              disabled={taskIndex === shipment.tasks.length - 1}
                              className={`p-0.5 rounded transition-colors ${
                                taskIndex === shipment.tasks.length - 1
                                  ? 'text-slate-200 cursor-not-allowed'
                                  : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 active:scale-95 cursor-pointer'
                              }`}
                              title={taskIndex === shipment.tasks.length - 1 ? 'これ以上下には移動できません' : '工程を1つ下に移動'}
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Dedicated Task Check Button with Tactile Spring, Shockwaves & Sparkle Burst */}
                          <div className="relative shrink-0 flex items-center justify-center mt-0.5">
                            <motion.button
                              type="button"
                              whileHover={{ scale: 1.12 }}
                              whileTap={{ scale: 0.82 }}
                              onClick={(e) => {
                                const nextStatus: TaskStatus = task.status === 'Completed' ? 'Todo' : 'Completed';
                                handleStatusChange(e, task.id, nextStatus);
                              }}
                              className={`group/chk relative w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-xs border ${
                                task.status === 'Completed'
                                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-400 text-white shadow-emerald-500/30'
                                  : task.status === 'In Progress'
                                  ? 'bg-amber-50 hover:bg-amber-100 border-amber-400 text-amber-600 hover:border-amber-500 ring-1 ring-amber-300/50'
                                  : 'bg-white hover:bg-emerald-50/80 border-slate-300 text-slate-300 hover:text-emerald-600 hover:border-emerald-400'
                              }`}
                              title={task.status === 'Completed' ? 'クリックで未着手(予定)に戻す' : 'クリックで完了にする'}
                            >
                              {/* Shockwave Rings on Complete */}
                              {animType === 'complete' && (
                                <>
                                  <motion.span
                                    initial={{ scale: 0.7, opacity: 0.95 }}
                                    animate={{ scale: 2.8, opacity: 0 }}
                                    transition={{ duration: 0.65, ease: 'easeOut' }}
                                    className="absolute inset-0 rounded-xl bg-emerald-400/50 pointer-events-none"
                                  />
                                  <motion.span
                                    initial={{ scale: 0.8, opacity: 0.9 }}
                                    animate={{ scale: 3.5, opacity: 0 }}
                                    transition={{ duration: 0.85, ease: 'easeOut', delay: 0.08 }}
                                    className="absolute inset-0 rounded-xl border-2 border-emerald-400 pointer-events-none"
                                  />
                                  {/* Radiating Micro Sparkles */}
                                  {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
                                    const rad = (angle * Math.PI) / 180;
                                    const dist = 26;
                                    return (
                                      <motion.span
                                        key={i}
                                        initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                                        animate={{
                                          x: Math.cos(rad) * dist,
                                          y: Math.sin(rad) * dist,
                                          scale: [0, 1.5, 0],
                                          opacity: [1, 1, 0],
                                        }}
                                        transition={{ duration: 0.6, ease: 'easeOut' }}
                                        className="absolute w-1.5 h-1.5 rounded-full bg-amber-300 shadow-xs pointer-events-none"
                                      />
                                    );
                                  })}
                                </>
                              )}

                              {task.status === 'Completed' ? (
                                <motion.div
                                  initial={animType === 'complete' ? { scale: 0, rotate: -45 } : false}
                                  animate={{ scale: 1, rotate: 0 }}
                                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                                >
                                  <Check className="w-5 h-5 stroke-[3.5]" />
                                </motion.div>
                              ) : task.status === 'In Progress' ? (
                                <Clock className="w-4 h-4 animate-pulse text-amber-600" />
                              ) : (
                                <Check className="w-4 h-4 opacity-0 group-hover/chk:opacity-60 transition-opacity" />
                              )}
                            </motion.button>
                          </div>

                          <div>
                            <h4
                              className={`text-sm font-bold flex items-center space-x-2 flex-wrap gap-y-1 ${
                                task.status === 'Completed' ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-900'
                              }`}
                            >
                              {task.shortName && (
                                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 font-bold border border-indigo-200 text-[11px] rounded shrink-0 mr-1.5 no-underline">
                                  {task.shortName}
                                </span>
                              )}
                              <span>{task.title}</span>

                              {/* Urgency / Importance Badges on Task Title */}
                              {isUrgentTask && task.status !== 'Completed' && (
                                <span className="px-2 py-0.5 bg-rose-600 text-white font-extrabold text-[10px] rounded-full shadow-2xs animate-pulse no-underline ml-1">
                                  ⚡ 緊急
                                </span>
                              )}
                              {isImportantTask && !isUrgentTask && task.status !== 'Completed' && (
                                <span className="px-2 py-0.5 bg-amber-500 text-white font-bold text-[10px] rounded-full shadow-2xs no-underline ml-1">
                                  ★ 重要
                                </span>
                              )}
                            </h4>

                            {/* REQUIREMENT 6 Visual User Badges & Cargo Info (向け地・個数) */}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              {/* 向け地 & 個数 表示バッジ */}
                              <span className="inline-flex items-center space-x-2 bg-blue-50/80 text-blue-900 px-2.5 py-1 rounded-xl border border-blue-200/80 text-xs font-semibold">
                                <span className="flex items-center font-bold text-slate-800" title="向け地 (Consignee)">
                                  <Plane className="w-3.5 h-3.5 mr-1 text-blue-600 shrink-0" />
                                  <span className="text-[10px] text-slate-500 font-normal mr-1">向け地:</span>
                                  <span className="text-slate-900 font-bold">{shipment.consignee || '未設定'}</span>
                                </span>
                                <span className="text-blue-300">|</span>
                                <span className="flex items-center font-bold text-slate-800" title="個数 (Pieces)">
                                  <Package className="w-3.5 h-3.5 mr-1 text-blue-600 shrink-0" />
                                  <span className="text-[10px] text-slate-500 font-normal mr-1">個数:</span>
                                  <span className="text-slate-900 font-bold">{shipment.pieces || '未記載'}</span>
                                </span>
                              </span>

                              {/* Active In Progress Worker Badge */}
                              {task.status === 'In Progress' && task.assignedTo && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                                  <UserIcon className="w-3.5 h-3.5 mr-1 text-amber-700" />
                                  [進行中] 👤 {task.assignedTo.displayName}
                                </span>
                              )}

                              {/* Completion User & Timestamp Badge */}
                              {task.status === 'Completed' && task.completedBy && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-700" />
                                  [完了] {task.completedBy.displayName} ({task.completedAt || '完了'})
                                </span>
                              )}

                              {/* Assigned User if Todo */}
                              {task.status === 'Todo' && task.assignedTo && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                  担当: {task.assignedTo.displayName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Toggle & Assignee Selector Controls */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0 self-end lg:self-center">
                          {/* Assignee Dropdown */}
                          <div className="relative">
                            <select
                              value={task.assignedTo ? (task.assignedTo.email || task.assignedTo.uid) : ''}
                              onChange={(e) => handleAssigneeChange(task.id, e.target.value)}
                              className="bg-slate-100 hover:bg-slate-200/70 border border-slate-300 text-slate-800 text-xs rounded-xl px-2.5 py-1.5 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                            >
                              <option value="">担当者を選択 (未選択)</option>
                              {operators.map((op) => (
                                <option key={op.email || op.id} value={op.email || op.id}>
                                  👤 {op.name} {op.employeeNumber ? `(${op.employeeNumber})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Quick Status Buttons */}
                          <div
                            className={`inline-flex rounded-xl p-0.5 border transition-all ${
                              task.status === 'Completed'
                                ? 'bg-emerald-100/80 border-emerald-300 ring-1 ring-emerald-200'
                                : task.status === 'In Progress'
                                ? 'bg-amber-100/80 border-amber-300 ring-1 ring-amber-200'
                                : 'bg-slate-100 border-slate-200'
                            }`}
                          >
                            <button
                              onClick={(e) => handleStatusChange(e, task.id, 'Todo')}
                              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                                task.status === 'Todo' ? 'bg-white text-slate-800 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              未着手
                            </button>

                            <button
                              onClick={(e) => handleStatusChange(e, task.id, 'In Progress')}
                              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                                task.status === 'In Progress'
                                  ? 'bg-amber-500 text-white shadow-2xs font-bold'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              進行中
                            </button>

                            <motion.button
                              whileTap={{ scale: 0.92 }}
                              onClick={(e) => handleStatusChange(e, task.id, 'Completed')}
                              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center space-x-1 ${
                                task.status === 'Completed'
                                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xs font-bold ring-1 ring-emerald-400'
                                  : 'text-slate-600 hover:text-emerald-700 hover:bg-emerald-50/50'
                              }`}
                            >
                              <Check className="w-3 h-3 stroke-[3]" />
                              <span>完了</span>
                            </motion.button>
                          </div>

                          {/* Delete Task Button */}
                          <button
                            onClick={() => handleDeleteTask(task)}
                            className="inline-flex items-center px-2.5 py-1 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                            title={`タスク「${task.title}」を削除`}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            <span>削除</span>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          )}

          {/* COMMENTS VIEW (Team Progress Sharing & Q&A) */}
          {activeTab === 'comments' && (
            <div className="space-y-6">
              {/* Comment Post Form */}
              <form onSubmit={handleAddComment} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                    <span>チームメッセージ・進捗コメント投稿</span>
                  </span>
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="text-slate-500 font-medium">投稿者:</span>
                    <input
                      type="text"
                      value={commentAuthor}
                      onChange={(e) => setCommentAuthor(e.target.value)}
                      placeholder="氏名を入力"
                      className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                    />
                  </div>
                </div>

                <textarea
                  rows={3}
                  required
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  placeholder="進捗状況の連絡、確認事項、質疑応答などをご記入ください..."
                  className="w-full bg-white border border-slate-300 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                />

                <div className="flex items-center justify-between gap-2">
                  {/* 重要フラグ切り替え (デフォルトOFF) */}
                  <button
                    type="button"
                    onClick={() => setIsImportantMemo(!isImportantMemo)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                      isImportantMemo
                        ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 ring-2 ring-rose-300 animate-pulse'
                        : 'bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border-slate-300 hover:border-rose-300'
                    }`}
                    title="重要フラグ (ONにすると赤色で強調表示されます)"
                  >
                    <Star className={`w-3.5 h-3.5 ${isImportantMemo ? 'fill-current text-white' : 'text-slate-400'}`} />
                    <span>重要フラグ: {isImportantMemo ? 'ON' : 'OFF'}</span>
                  </button>

                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>コメントを投稿</span>
                  </button>
                </div>
              </form>

              {/* Comments Timeline List */}
              {(!shipment.comments || shipment.comments.length === 0) ? (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-xs">
                  <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-semibold text-slate-600">コメントはまだありません</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    上の入力欄からチームメンバーへの進捗報告や質問を書き込むことができます。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {shipment.comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`rounded-2xl p-4 space-y-2 transition-all ${
                        comment.isImportant
                          ? 'bg-rose-50/90 border-2 border-rose-400 shadow-sm ring-2 ring-rose-200/70 hover:border-rose-500'
                          : 'bg-white border border-slate-200 shadow-2xs hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                              comment.isImportant ? 'bg-rose-600 text-white shadow-2xs' : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {comment.authorName ? comment.authorName.charAt(0) : '員'}
                          </div>
                          <span className={`text-xs font-bold ${comment.isImportant ? 'text-rose-950' : 'text-slate-900'}`}>
                            {comment.authorName}
                          </span>
                          {comment.authorEmail && (
                            <span className="text-[10px] text-slate-400 font-mono">({comment.authorEmail})</span>
                          )}
                          {comment.isImportant && (
                            <span className="px-2 py-0.5 bg-rose-600 text-white font-extrabold text-[10px] rounded-full shadow-2xs animate-pulse">
                              🔴 重要メモ
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mr-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{comment.formattedTime}</span>
                          </span>

                          <button
                            type="button"
                            onClick={() => handleToggleCommentImportant(comment.id)}
                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                              comment.isImportant
                                ? 'text-rose-600 hover:bg-rose-100'
                                : 'text-slate-300 hover:text-amber-500 hover:bg-slate-100'
                            }`}
                            title={comment.isImportant ? '重要フラグを解除 (OFF)' : '重要フラグを設定 (ON)'}
                          >
                            <Star className={`w-3.5 h-3.5 ${comment.isImportant ? 'fill-current text-rose-600' : ''}`} />
                          </button>

                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-slate-300 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition-colors cursor-pointer"
                            title="コメント削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p
                        className={`text-xs leading-relaxed whitespace-pre-wrap pt-1 font-sans ${
                          comment.isImportant ? 'text-rose-950 font-bold' : 'text-slate-700'
                        }`}
                      >
                        {comment.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LOGS VIEW (Requirement 6 - Firestore Activity Audit Timeline) */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-2xl flex items-center justify-between text-xs text-blue-900">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="font-semibold">
                    不変監査ログ（Firestore shipments/{shipment.id}/logs サブコレクションへ自動蓄積）
                  </span>
                </div>
                <span className="text-[10px] text-blue-700 font-mono">全 {logs.length} 件記録</span>
              </div>

              {logs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">操作ログがありません。</div>
              ) : (
                <div className="relative border-l-2 border-slate-200 ml-4 pl-6 space-y-6">
                  {logs.map((log) => (
                    <div key={log.id} className="relative group">
                      {/* Timeline Node Bullet */}
                      <div className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full bg-blue-600 ring-4 ring-white border border-blue-400 shadow-2xs" />

                      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-900 flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-slate-200 text-slate-700 font-semibold">
                              {log.actionTitle}
                            </span>
                            <span>{log.userName}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({log.userEmail})</span>
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">{log.formattedTime}</span>
                        </div>
                        <p className="text-slate-700 leading-relaxed pt-0.5">{log.details}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CUSTOMS QA & HELLMANN RELAY HUB */}
          {activeTab === 'customs_qa' && (
            <CustomsQaRelayPanel
              shipment={shipment}
              onShipmentUpdated={() => {
                refreshData();
              }}
            />
          )}
        </div>
      </div>
      {/* PDF Zoom Modal */}
      <PdfZoomModal
        shipment={shipment}
        isOpen={showZoomModal}
        onClose={() => setShowZoomModal(false)}
        onReturnToDashboard={() => {
          setShowZoomModal(false);
          if (onBack) onBack();
        }}
        onShipmentUpdated={(updated) => setShipment({ ...updated })}
        onNavigateShipment={(nextShipment) => {
          setShipment(nextShipment);
          if (onShipmentChange) onShipmentChange(nextShipment.id);
        }}
      />

      {/* Complete All Tasks Confirmation Modal */}
      {showCompleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3.5 text-emerald-600">
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 shadow-xs">
                <CheckCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-1.5">
                  <span>工程タスクの一括完了</span>
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Shift + C
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">案件ID: {shipment.id}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-slate-600 leading-relaxed">
              <p>
                この案件の未完了タスク（<span className="font-bold text-emerald-700">{uncompletedTasksCount}件</span>）を一括ですべて【<span className="font-bold text-slate-800">完了</span>】に更新しますか？
              </p>
              <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-3 text-xs text-emerald-900 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>各タスクに現在のタイムスタンプおよび操作ユーザーが記録されます</span>
                </div>
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>案件全体の総合ステータスも自動的に【全工程完了】になります</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCompleteAllModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                キャンセル (Esc)
              </button>
              <button
                type="button"
                onClick={handleCompleteAllTasks}
                autoFocus
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-98 rounded-xl shadow-md hover:shadow-emerald-600/30 transition-all inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>全タスクを一括完了にする</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shipment Delete Confirmation Modal */}
      {showDeleteShipmentConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">案件情報の削除確認</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">管理ID: {shipment.id}</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              この案件情報（MAWB: <span className="font-semibold text-slate-800">{shipment.mawbNumber}</span> / HAWB: <span className="font-semibold text-slate-800">{shipment.hawbNumber || 'なし'}</span>）を完全に削除してもよろしいですか？
            </p>
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-xl">
              ※ 関連する工程タスクやアクティビティログも削除されます。この操作は取り消せません。
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteShipmentConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmDeleteShipment}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-md transition-colors cursor-pointer"
              >
                案件を完全削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Delete Confirmation Modal */}
      {taskToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">工程タスクの削除</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              タスク「<span className="font-bold text-slate-800">{taskToDelete.title}</span>」を削除しますか？
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setTaskToDelete(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmDeleteTask}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-md transition-colors cursor-pointer"
              >
                削除実行
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Shipment Edit Modal */}
      <ShipmentEditModal
        shipment={shipment}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onShipmentUpdated={(updated) => setShipment({ ...updated })}
      />

      {/* Customs Email Modal */}
      {showEmailModal && (
        <CustomsEmailModal
          shipment={shipment}
          onClose={() => setShowEmailModal(false)}
        />
      )}

      {/* Customs QA Relay Popup Modal */}
      {showCustomsQaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-5xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-4 sm:px-6 flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm sm:text-base text-white">
                      通関質疑 ＆ ヘルマン照会ハブ
                    </h3>
                    {(() => {
                      const badgeInfo = getCustomsQaStatusBadgeInfo(shipment.customsQas);
                      return (
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${badgeInfo.badgeClass}`}>
                          <span className="text-[9px]">●</span>
                          <span>{badgeInfo.label}</span>
                        </span>
                      );
                    })()}
                    <span className="text-[11px] bg-blue-500/20 text-blue-300 font-mono px-2.5 py-0.5 rounded-md border border-blue-400/20">
                      HAWB: {shipment.hawbNumber || shipment.id}
                    </span>
                    <span className="text-[11px] bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded-md border border-slate-700">
                      MAWB: {shipment.mawbNumber}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    共通グループメール経由で社内通関士とヘルマン社を直結リレー
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomsQaModal(false);
                    const el = document.getElementById('main-tabs-section');
                    if (el) {
                      setTimeout(() => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 50);
                    }
                  }}
                  className="px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer border border-slate-700 hidden sm:flex items-center gap-1.5"
                  title="ポップアップを閉じて画面下部のタブエリアへ移動します"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                  <span>ページ内タブへ移動</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomsQaModal(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                  title="閉じる"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-50/50">
              <CustomsQaRelayPanel
                shipment={shipment}
                onShipmentUpdated={() => {
                  refreshData();
                }}
              />
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:px-6 bg-white border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
              <span>
                ※ 画面下部の「通関質疑＆ヘルマン照会ハブ」タブでも常時表示・操作可能です
              </span>
              <button
                type="button"
                onClick={() => setShowCustomsQaModal(false)}
                className="px-5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
