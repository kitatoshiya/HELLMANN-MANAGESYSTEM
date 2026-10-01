import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  StickyNote as StickyIcon,
  ExternalLink as LinkIcon,
  Image as ImageIcon,
  Trash2,
  Edit3,
  Move,
  Search,
  Maximize2,
  RotateCcw,
  Check,
  X,
  Sparkles,
  Link as ChainIcon,
  Upload,
  User,
  Clock,
  LayoutGrid,
} from "lucide-react";
import { AppTheme, StickyNote, StickyNoteColor, StickyNoteLink, UserProfile } from "../types";
import {
  db,
  loadLocalStickyNotes,
  saveLocalStickyNotes,
  INITIAL_SAMPLE_STICKY_NOTES,
  cleanForFirestore,
  handleFirestoreError,
  OperationType,
} from "../lib/firebase";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";

interface StickyBoardProps {
  currentUser: UserProfile;
  currentTheme: AppTheme;
}

const COLOR_SCHEMES: Record<
  StickyNoteColor,
  {
    name: string;
    bg: string;
    headerBg: string;
    text: string;
    border: string;
    badgeBg: string;
    badgeText: string;
    shadow: string;
    dotBg: string;
  }
> = {
  yellow: {
    name: "イエロー",
    bg: "bg-amber-100 dark:bg-amber-950/90",
    headerBg: "bg-amber-200/80 dark:bg-amber-900/80 border-b border-amber-300 dark:border-amber-700/60",
    text: "text-amber-950 dark:text-amber-100",
    border: "border-amber-300 dark:border-amber-700/80",
    badgeBg: "bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200",
    badgeText: "text-amber-900 dark:text-amber-200",
    shadow: "shadow-lg shadow-amber-950/10 dark:shadow-amber-950/40",
    dotBg: "bg-amber-400",
  },
  blue: {
    name: "ブルー",
    bg: "bg-sky-100 dark:bg-sky-950/90",
    headerBg: "bg-sky-200/80 dark:bg-sky-900/80 border-b border-sky-300 dark:border-sky-700/60",
    text: "text-sky-950 dark:text-sky-100",
    border: "border-sky-300 dark:border-sky-700/80",
    badgeBg: "bg-sky-200 dark:bg-sky-900 text-sky-900 dark:text-sky-200",
    badgeText: "text-sky-900 dark:text-sky-200",
    shadow: "shadow-lg shadow-sky-950/10 dark:shadow-sky-950/40",
    dotBg: "bg-sky-400",
  },
  green: {
    name: "グリーン",
    bg: "bg-emerald-100 dark:bg-emerald-950/90",
    headerBg: "bg-emerald-200/80 dark:bg-emerald-900/80 border-b border-emerald-300 dark:border-emerald-700/60",
    text: "text-emerald-950 dark:text-emerald-100",
    border: "border-emerald-300 dark:border-emerald-700/80",
    badgeBg: "bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200",
    badgeText: "text-emerald-900 dark:text-emerald-200",
    shadow: "shadow-lg shadow-emerald-950/10 dark:shadow-emerald-950/40",
    dotBg: "bg-emerald-400",
  },
  pink: {
    name: "ピンク",
    bg: "bg-pink-100 dark:bg-pink-950/90",
    headerBg: "bg-pink-200/80 dark:bg-pink-900/80 border-b border-pink-300 dark:border-pink-700/60",
    text: "text-pink-950 dark:text-pink-100",
    border: "border-pink-300 dark:border-pink-700/80",
    badgeBg: "bg-pink-200 dark:bg-pink-900 text-pink-900 dark:text-pink-200",
    badgeText: "text-pink-900 dark:text-pink-200",
    shadow: "shadow-lg shadow-pink-950/10 dark:shadow-pink-950/40",
    dotBg: "bg-pink-400",
  },
  purple: {
    name: "パープル",
    bg: "bg-purple-100 dark:bg-purple-950/90",
    headerBg: "bg-purple-200/80 dark:bg-purple-900/80 border-b border-purple-300 dark:border-purple-700/60",
    text: "text-purple-950 dark:text-purple-100",
    border: "border-purple-300 dark:border-purple-700/80",
    badgeBg: "bg-purple-200 dark:bg-purple-900 text-purple-900 dark:text-purple-200",
    badgeText: "text-purple-900 dark:text-purple-200",
    shadow: "shadow-lg shadow-purple-950/10 dark:shadow-purple-950/40",
    dotBg: "bg-purple-400",
  },
  slate: {
    name: "ダークグレー",
    bg: "bg-slate-200 dark:bg-slate-900/90",
    headerBg: "bg-slate-300/80 dark:bg-slate-800/80 border-b border-slate-400 dark:border-slate-700/60",
    text: "text-slate-950 dark:text-slate-100",
    border: "border-slate-400 dark:border-slate-700/80",
    badgeBg: "bg-slate-300 dark:bg-slate-800 text-slate-900 dark:text-slate-200",
    badgeText: "text-slate-900 dark:text-slate-200",
    shadow: "shadow-lg shadow-slate-950/10 dark:shadow-slate-950/50",
    dotBg: "bg-slate-400",
  },
};

export const StickyBoard: React.FC<StickyBoardProps> = ({
  currentUser,
  currentTheme,
}) => {
  const [notes, setNotes] = useState<StickyNote[]>(loadLocalStickyNotes);
  const [searchQuery, setSearchQuery] = useState("");
  const [maxZIndex, setMaxZIndex] = useState(10);
  const [editingNote, setEditingNote] = useState<StickyNote | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Dragging state and refs for accurate real-time sync
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const notesRef = useRef<StickyNote[]>(notes);
  notesRef.current = notes;

  const draggingNoteIdRef = useRef<string | null>(draggingNoteId);
  draggingNoteIdRef.current = draggingNoteId;

  // Real-time Firestore Sync across all devices and users
  useEffect(() => {
    if (!db) return;

    try {
      const unsubscribe = onSnapshot(
        collection(db, "sticky_notes"),
        (snapshot) => {
          if (snapshot.empty) {
            // Seed sample notes to Firestore if empty so all users share initial data
            INITIAL_SAMPLE_STICKY_NOTES.forEach((n) => {
              setDoc(doc(db, "sticky_notes", n.id), cleanForFirestore(n)).catch((err) =>
                handleFirestoreError(err, OperationType.WRITE, `sticky_notes/${n.id}`)
              );
            });
            setNotes(INITIAL_SAMPLE_STICKY_NOTES);
            saveLocalStickyNotes(INITIAL_SAMPLE_STICKY_NOTES);
          } else {
            const firestoreNotes: StickyNote[] = [];
            snapshot.forEach((d) => {
              const data = d.data() as StickyNote;
              firestoreNotes.push({
                ...data,
                id: d.id,
              });
            });

            // Update max zIndex tracking
            const maxZ = firestoreNotes.reduce((max, n) => Math.max(max, n.zIndex || 1), 10);
            setMaxZIndex(maxZ);

            // Don't overwrite position of note currently being dragged locally
            const activeDragId = draggingNoteIdRef.current;
            if (activeDragId) {
              const currentLocalNote = notesRef.current.find((n) => n.id === activeDragId);
              if (currentLocalNote) {
                const merged = firestoreNotes.map((fn) =>
                  fn.id === activeDragId ? { ...fn, x: currentLocalNote.x, y: currentLocalNote.y } : fn
                );
                setNotes(merged);
                saveLocalStickyNotes(merged);
                return;
              }
            }

            setNotes(firestoreNotes);
            saveLocalStickyNotes(firestoreNotes);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, "sticky_notes");
        }
      );

      return () => unsubscribe();
    } catch (e) {
      console.warn("Failed to subscribe to sticky_notes collection:", e);
    }
  }, []);

  // Sync to localStorage as fallback
  useEffect(() => {
    saveLocalStickyNotes(notes);
  }, [notes]);

  // Handle note save / update to Firestore & State
  const handleSaveNote = async (updatedNote: StickyNote) => {
    const isNew = !notesRef.current.some((n) => n.id === updatedNote.id);
    const newNotes = isNew
      ? [updatedNote, ...notesRef.current]
      : notesRef.current.map((n) => (n.id === updatedNote.id ? updatedNote : n));

    setNotes(newNotes);
    saveLocalStickyNotes(newNotes);

    if (db) {
      try {
        await setDoc(doc(db, "sticky_notes", updatedNote.id), cleanForFirestore(updatedNote));
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, `sticky_notes/${updatedNote.id}`);
      }
    }
  };

  // Handle note deletion
  const handleDeleteNote = async (noteId: string) => {
    const filtered = notesRef.current.filter((n) => n.id !== noteId);
    setNotes(filtered);
    saveLocalStickyNotes(filtered);

    if (db) {
      try {
        await deleteDoc(doc(db, "sticky_notes", noteId));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `sticky_notes/${noteId}`);
      }
    }
  };

  // Align/Arrange all sticky notes in a clean grid layout
  const handleArrangeNotes = async () => {
    const currentNotes = notesRef.current;
    if (currentNotes.length === 0) return;

    // Calculate columns based on board width
    const containerWidth = containerRef.current?.getBoundingClientRect().width || 1100;
    const cardWidthWithGap = 360; // 330px width + 30px gap
    const cols = Math.max(1, Math.floor((containerWidth - 60) / cardWidthWithGap));

    const rearranged = currentNotes.map((n, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      return {
        ...n,
        x: 30 + col * cardWidthWithGap,
        y: 30 + row * 340,
        updatedAt: new Date().toISOString(),
      };
    });

    setNotes(rearranged);
    saveLocalStickyNotes(rearranged);

    if (db) {
      try {
        await Promise.all(
          rearranged.map((n) => setDoc(doc(db, "sticky_notes", n.id), cleanForFirestore(n)))
        );
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, "sticky_notes");
      }
    }

    setToastMessage("✨ 付箋の配置をグリッド状に整理しました");
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Bring note to front when clicked or dragged
  const handleBringToFront = (noteId: string) => {
    const nextZ = maxZIndex + 1;
    setMaxZIndex(nextZ);

    let updatedTarget: StickyNote | null = null;
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id === noteId) {
          updatedTarget = { ...n, zIndex: nextZ };
          return updatedTarget;
        }
        return n;
      })
    );

    if (db) {
      const target = notesRef.current.find((n) => n.id === noteId);
      if (target) {
        const toSave = { ...target, zIndex: nextZ };
        setDoc(doc(db, "sticky_notes", noteId), cleanForFirestore(toSave)).catch((err) =>
          handleFirestoreError(err, OperationType.WRITE, `sticky_notes/${noteId}`)
        );
      }
    }
  };

  // Start dragging a note
  const handleMouseDown = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
    note: StickyNote
  ) => {
    handleBringToFront(note.id);
    setDraggingNoteId(note.id);

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;

      setDragOffset({
        x: relativeX - note.x,
        y: relativeY - note.y,
      });
    }
  };

  // Handle mouse move / touch move during dragging
  useEffect(() => {
    if (!draggingNoteId) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const rawX = clientX - rect.left - dragOffset.x;
        const rawY = clientY - rect.top - dragOffset.y;

        // Constrain bounds within reasonable values
        const newX = Math.max(10, Math.min(rawX, rect.width - 250));
        const newY = Math.max(10, Math.min(rawY, rect.height - 120));

        setNotes((prev) =>
          prev.map((n) => {
            if (n.id === draggingNoteId) {
              return {
                ...n,
                x: Math.round(newX),
                y: Math.round(newY),
                updatedAt: new Date().toISOString(),
              };
            }
            return n;
          })
        );
      }
    };

    const handleMouseUp = () => {
      const currentDragId = draggingNoteIdRef.current;
      if (currentDragId) {
        const targetNote = notesRef.current.find((n) => n.id === currentDragId);
        if (targetNote) {
          handleSaveNote(targetNote);
        }
      }
      setDraggingNoteId(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleMouseMove);
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [draggingNoteId, dragOffset]);

  // Open modal for creating a brand new sticky note
  const handleOpenNewNoteModal = (colorPreset: StickyNoteColor = "yellow") => {
    const newNote: StickyNote = {
      id: `note-${Date.now()}`,
      title: "",
      content: "",
      color: colorPreset,
      x: Math.min(60 + notes.length * 30, 400),
      y: Math.min(40 + notes.length * 25, 300),
      width: 320,
      links: [],
      createdBy: currentUser.email,
      createdByName: currentUser.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      zIndex: maxZIndex + 1,
    };
    setMaxZIndex((prev) => prev + 1);
    setEditingNote(newNote);
    setIsModalOpen(true);
  };

  // Preset Template loader
  const handleAddPresetNote = (presetType: "urgent" | "links" | "image") => {
    const nowIso = new Date().toISOString();
    const nextZ = maxZIndex + 1;
    setMaxZIndex(nextZ);

    let presetNote: StickyNote;
    const offset = (notes.length % 5) * 40;

    if (presetType === "urgent") {
      presetNote = {
        id: `note-${Date.now()}`,
        title: "🚨 緊急品手配チェックリスト",
        content: "・税関事前申告書類の準備\n・AWB（航空運送状）の番号発効確認\n・現地代理店へのETA連絡",
        color: "pink",
        x: 100 + offset,
        y: 80 + offset,
        width: 320,
        createdBy: currentUser.email,
        createdByName: currentUser.name,
        createdAt: nowIso,
        updatedAt: nowIso,
        zIndex: nextZ,
      };
    } else if (presetType === "links") {
      presetNote = {
        id: `note-${Date.now()}`,
        title: "🔗 社内共有WEBツール・システムリンク",
        content: "日々の船用品手配で頻繁にアクセスする外部ポータル・追跡ツール一覧",
        color: "blue",
        x: 450 + offset,
        y: 80 + offset,
        width: 320,
        links: [
          { id: "l-1", title: "Flightradar24 リアルタイムフライト追跡", url: "https://www.flightradar24.com" },
          { id: "l-2", title: "海運貨物ドキュメント変換ポータル", url: "https://drive.google.com" },
        ],
        createdBy: currentUser.email,
        createdByName: currentUser.name,
        createdAt: nowIso,
        updatedAt: nowIso,
        zIndex: nextZ,
      };
    } else {
      presetNote = {
        id: `note-${Date.now()}`,
        title: "📦 スペアパーツ梱包・識別サンプル写真",
        content: "大型主機関パーツ出荷時の防錆処置・パレット固定の参考画像です。",
        color: "green",
        x: 250 + offset,
        y: 200 + offset,
        width: 340,
        imageUrl: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
        createdBy: currentUser.email,
        createdByName: currentUser.name,
        createdAt: nowIso,
        updatedAt: nowIso,
        zIndex: nextZ,
      };
    }

    handleSaveNote(presetNote);
  };

  // Filter notes by search query
  const filteredNotes = notes.filter((n) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.createdByName?.toLowerCase().includes(q) ||
      n.createdBy.toLowerCase().includes(q) ||
      n.links?.some((l) => l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q))
    );
  });

  // Helper to render body text with auto-linkified URLs
  const renderFormattedContent = (content: string) => {
    if (!content) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = content.split(urlRegex);

    return parts.map((part, idx) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={idx}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="text-sky-600 dark:text-sky-400 underline font-bold hover:text-sky-500 break-all inline-flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {part} <LinkIcon className="w-3 h-3 inline" />
          </a>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden select-none">
      {/* Top Controls Toolbar for Backstage Canvas */}
      <div
        className={`px-4 sm:px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3 shadow-sm z-20 ${
          currentTheme === "light"
            ? "bg-amber-50/90 text-slate-900 border-amber-200"
            : currentTheme === "cute"
            ? "bg-pink-100/90 text-pink-950 border-pink-200"
            : currentTheme === "digital"
            ? "bg-[#04170e] text-emerald-300 border-emerald-900 font-mono"
            : "bg-slate-900 text-slate-100 border-slate-800"
        }`}
      >
        {/* Title & Info Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-500 shadow-sm shrink-0">
            <StickyIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-black text-sm sm:text-base tracking-tight flex items-center gap-1.5">
                裏画面 <span className="text-amber-500 font-extrabold">【全ユーザー共通・自由付箋ボード】</span>
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                {notes.length} 件の付箋
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              タイトル・文字情報・WEBリンク・画像を貼り付け、ドラッグで配置を自由に変更できます（Firestore自動同期）
            </p>
          </div>
        </div>

        {/* Action Controls & Preset Shortcuts */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Filter Search Input */}
          <div className="relative max-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="付箋を検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Preset Buttons */}
          <div className="hidden lg:flex items-center gap-1 bg-slate-800/60 p-1 rounded-lg border border-slate-700/60 text-xs">
            <span className="text-[10px] text-slate-400 px-1 font-bold">テンプレート:</span>
            <button
              onClick={() => handleAddPresetNote("urgent")}
              className="px-2 py-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800 text-[10px] font-bold transition-all"
            >
              + 緊急メモ
            </button>
            <button
              onClick={() => handleAddPresetNote("links")}
              className="px-2 py-1 rounded bg-sky-950/80 hover:bg-sky-900 text-sky-200 border border-sky-800 text-[10px] font-bold transition-all"
            >
              + リンク集
            </button>
            <button
              onClick={() => handleAddPresetNote("image")}
              className="px-2 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-800 text-[10px] font-bold transition-all"
            >
              + 画像メモ
            </button>
          </div>

          {/* Reset positions option */}
          <button
            onClick={handleArrangeNotes}
            title="ワンクリックで全付箋の配置をグリッド状に自動整列"
            className="p-1.5 px-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <LayoutGrid className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-[11px] font-black">整列</span>
          </button>

          {/* Add New Sticky Note Primary Button */}
          <button
            onClick={() => handleOpenNewNoteModal("yellow")}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-black text-xs text-slate-950 bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 shadow-md border border-amber-300 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>新規付箋を貼る</span>
          </button>
        </div>
      </div>

      {/* Interactive Freeform Canvas Board Container */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-auto custom-scrollbar p-6 transition-colors ${
          currentTheme === "light"
            ? "bg-[#fffdf7] bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:24px_24px]"
            : currentTheme === "cute"
            ? "bg-pink-50/50 bg-[radial-gradient(#fbcfe8_1px,transparent_1px)] [background-size:24px_24px]"
            : currentTheme === "digital"
            ? "bg-[#010a05] bg-[radial-gradient(#064e3b_1px,transparent_1px)] [background-size:24px_24px]"
            : "bg-[#0b0f17] bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px]"
        }`}
        style={{ minHeight: "750px" }}
      >
        {/* Toast Notification Banner */}
        {toastMessage && (
          <div className="sticky top-3 left-1/2 -translate-x-1/2 z-50 max-w-sm w-fit mx-auto px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-black text-xs shadow-xl flex items-center gap-2 animate-fade-in border border-amber-300 pointer-events-none">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}
        {filteredNotes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-500 pointer-events-none">
            <div className="w-16 h-16 rounded-full bg-slate-800/60 border border-slate-700 flex items-center justify-center text-amber-400 mb-3 shadow-lg">
              <StickyIcon className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-slate-300 mb-1">
              付箋がまだありません
            </h3>
            <p className="text-xs text-slate-400 max-w-sm">
              右上の「新規付箋を貼る」ボタンを押して、文字情報・WEBリンク・画像を含む付箋を作成してください。
            </p>
          </div>
        ) : (
          filteredNotes.map((note) => {
            const scheme = COLOR_SCHEMES[note.color] || COLOR_SCHEMES.yellow;
            const isDragging = draggingNoteId === note.id;

            return (
              <div
                key={note.id}
                onMouseDown={() => handleBringToFront(note.id)}
                onTouchStart={() => handleBringToFront(note.id)}
                className={`absolute rounded-2xl border-2 flex flex-col ${scheme.bg} ${scheme.border} ${scheme.text} ${scheme.shadow} transition-shadow duration-150 ${
                  isDragging ? "ring-4 ring-sky-500/50 scale-[1.02] shadow-2xl z-50 cursor-grabbing" : ""
                }`}
                style={{
                  left: `${note.x}px`,
                  top: `${note.y}px`,
                  width: `${note.width || 320}px`,
                  zIndex: note.zIndex || 1,
                }}
              >
                {/* Drag Handle Top Bar */}
                <div
                  onMouseDown={(e) => handleMouseDown(e, note)}
                  onTouchStart={(e) => handleMouseDown(e, note)}
                  className={`px-3 py-2 rounded-t-[14px] flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing ${scheme.headerBg}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Move className="w-3.5 h-3.5 text-slate-400 shrink-0 opacity-70" />
                    <span className="font-extrabold text-xs truncate">
                      {note.title || "無題の付箋"}
                    </span>
                  </div>

                  {/* Actions on Sticky Note Bar */}
                  <div className="flex items-center gap-1 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNote(note);
                        setIsModalOpen(true);
                      }}
                      className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-slate-600 dark:text-slate-300"
                      title="付箋を編集"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("この付箋を削除しますか？")) {
                          handleDeleteNote(note.id);
                        }
                      }}
                      className="p-1 rounded hover:bg-rose-500/20 text-slate-600 hover:text-rose-500 transition-colors"
                      title="付箋を削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sticky Note Content Body */}
                <div className="p-3.5 flex flex-col gap-3 text-xs leading-relaxed overflow-hidden">
                  {/* Body Text (文字情報) */}
                  {note.content && (
                    <div className="whitespace-pre-wrap font-medium break-words leading-relaxed text-[12px]">
                      {renderFormattedContent(note.content)}
                    </div>
                  )}

                  {/* Attached Image (画像の貼付) */}
                  {note.imageUrl && (
                    <div className="relative group rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/5">
                      <img
                        src={note.imageUrl}
                        alt="付箋画像"
                        className="w-full h-auto max-h-48 object-cover cursor-zoom-in rounded-xl transition-transform duration-200 group-hover:scale-105"
                        onClick={() => setPreviewImageUrl(note.imageUrl || null)}
                      />
                      <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-bold pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Maximize2 className="w-3 h-3" /> 拡大
                      </div>
                    </div>
                  )}

                  {/* WEB Links List (WEBリンク情報) */}
                  {note.links && note.links.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1 border-t border-black/10 dark:border-white/10">
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <ChainIcon className="w-3 h-3 text-sky-500" /> 関連リンク ({note.links.length})
                      </span>
                      <div className="flex flex-col gap-1">
                        {note.links.map((link) => (
                          <a
                            key={link.id || link.url}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                            className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-black/40 hover:bg-white dark:hover:bg-black/60 border border-black/5 dark:border-white/10 text-sky-700 dark:text-sky-300 font-bold transition-all group"
                          >
                            <span className="truncate text-[11px] group-hover:underline">
                              {link.title || link.url}
                            </span>
                            <LinkIcon className="w-3 h-3 shrink-0 text-sky-500 group-hover:translate-x-0.5 transition-transform" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer metadata: Author & Timestamp */}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 pt-2 border-t border-black/5 dark:border-white/5">
                    <span className="flex items-center gap-1 font-bold truncate">
                      <User className="w-3 h-3 opacity-70" />
                      {note.createdByName || note.createdBy}
                    </span>
                    <span className="flex items-center gap-1 shrink-0 font-mono">
                      <Clock className="w-3 h-3 opacity-70" />
                      {new Date(note.updatedAt || note.createdAt).toLocaleDateString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sticky Note Create / Edit Modal */}
      {isModalOpen && editingNote && (
        <StickyNoteEditorModal
          isOpen={isModalOpen}
          note={editingNote}
          currentUser={currentUser}
          onClose={() => {
            setIsModalOpen(false);
            setEditingNote(null);
          }}
          onSave={(saved) => {
            handleSaveNote(saved);
            setIsModalOpen(false);
            setEditingNote(null);
          }}
          onDelete={(id) => {
            handleDeleteNote(id);
            setIsModalOpen(false);
            setEditingNote(null);
          }}
        />
      )}

      {/* Fullscreen Image Preview Lightbox */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl border border-white/20">
            <img
              src={previewImageUrl}
              alt="プレビュー拡大"
              className="w-full h-full object-contain"
            />
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/70 text-white hover:bg-black transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Internal Sticky Note Editor Modal Component
interface StickyNoteEditorModalProps {
  isOpen: boolean;
  note: StickyNote;
  currentUser: UserProfile;
  onClose: () => void;
  onSave: (note: StickyNote) => void;
  onDelete: (id: string) => void;
}

const StickyNoteEditorModal: React.FC<StickyNoteEditorModalProps> = ({
  isOpen,
  note,
  currentUser,
  onClose,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [color, setColor] = useState<StickyNoteColor>(note.color);
  const [imageUrl, setImageUrl] = useState(note.imageUrl || "");
  const [links, setLinks] = useState<StickyNoteLink[]>(note.links || []);

  // Temporary new link fields
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  if (!isOpen) return null;

  const handleAddLink = () => {
    if (!newLinkUrl.trim()) return;
    const formattedUrl = newLinkUrl.startsWith("http")
      ? newLinkUrl.trim()
      : `https://${newLinkUrl.trim()}`;

    const newLink: StickyNoteLink = {
      id: `link-${Date.now()}`,
      title: newLinkTitle.trim() || formattedUrl,
      url: formattedUrl,
    };

    setLinks([...links, newLink]);
    setNewLinkTitle("");
    setNewLinkUrl("");
  };

  const handleRemoveLink = (linkId: string) => {
    setLinks(links.filter((l) => l.id !== linkId));
  };

  // Image File Upload Reader
  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("画像サイズが大きすぎます (5MB以下をアップロードしてください)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setImageUrl(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !content.trim()) {
      alert("タイトルまたは本文を入力してください");
      return;
    }

    const nowIso = new Date().toISOString();
    const updated: StickyNote = {
      ...note,
      title: title.trim() || "無題の付箋",
      content: content.trim(),
      color,
      imageUrl: imageUrl.trim() || undefined,
      links,
      updatedAt: nowIso,
    };

    onSave(updated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 text-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col my-8">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <StickyIcon className="w-5 h-5 text-amber-400" />
            <h3 className="font-extrabold text-base">付箋の編集・作成</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 text-xs">
          {/* Color Selection */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-2">
              付箋カラー
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {(Object.keys(COLOR_SCHEMES) as StickyNoteColor[]).map((c) => {
                const conf = COLOR_SCHEMES[c];
                const isSelected = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                      isSelected
                        ? "ring-2 ring-sky-500 scale-105 border-white"
                        : "opacity-70 hover:opacity-100 border-slate-700"
                    } ${conf.badgeBg}`}
                  >
                    <span className={`w-3 h-3 rounded-full ${conf.dotBg}`} />
                    <span>{conf.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">
              タイトル (必須)
            </label>
            <input
              type="text"
              placeholder="例: ⚓ SIN向け緊急パーツ注意事項"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Content Body Text */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 mb-1">
              本文 (文字情報・メモ)
            </label>
            <textarea
              rows={4}
              placeholder="連絡事項、手続きフロー、メモなど自由に入力してください。URLが含まれる場合は自動でリンク化されます。"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-sans leading-relaxed"
            />
          </div>

          {/* WEB Links Manager */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col gap-2">
            <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
              <ChainIcon className="w-3.5 h-3.5 text-sky-400" />
              WEBのリンク情報
            </label>

            {/* List of existing links */}
            {links.length > 0 && (
              <div className="flex flex-col gap-1.5 my-1">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200"
                  >
                    <div className="truncate flex-1">
                      <span className="font-bold text-sky-400 mr-2">{link.title}</span>
                      <span className="text-slate-400 text-[10px] truncate">{link.url}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(link.id)}
                      className="text-slate-400 hover:text-rose-400 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input row for adding new link */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
              <input
                type="text"
                placeholder="リンクタイトル (例: 代理店サイト)"
                value={newLinkTitle}
                onChange={(e) => setNewLinkTitle(e.target.value)}
                className="sm:col-span-2 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs placeholder-slate-500"
              />
              <input
                type="text"
                placeholder="URL (例: https://example.com)"
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                className="sm:col-span-2 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs placeholder-slate-500"
              />
              <button
                type="button"
                onClick={handleAddLink}
                className="sm:col-span-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-xs transition-colors"
              >
                + 追加
              </button>
            </div>
          </div>

          {/* Image Attachment (画像の貼付) */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col gap-2">
            <label className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                画像の貼付 (URL指定 または 画像ファイル選択)
              </span>
            </label>

            {/* Image Preview if exists */}
            {imageUrl && (
              <div className="relative rounded-lg overflow-hidden border border-slate-700 max-h-40 bg-black/40 flex items-center justify-center">
                <img src={imageUrl} alt="貼付プレビュー" className="max-h-36 object-contain" />
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-500"
                  title="画像を削除"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                placeholder="画像URL (https://...)"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs placeholder-slate-500"
              />

              <label className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer transition-colors font-bold shrink-0">
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                <span>ファイル選択</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
            {note.id && notesExist(note.id) ? (
              <button
                type="button"
                onClick={() => onDelete(note.id)}
                className="px-3 py-2 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-xl font-bold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> 削除
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5"
              >
                <Check className="w-4 h-4 stroke-[3]" /> 保存する
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

function notesExist(noteId: string): boolean {
  return noteId.startsWith("note-");
}
