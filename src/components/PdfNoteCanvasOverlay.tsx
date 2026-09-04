import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { PdfAnnotationNote, Point, savePdfNote, deletePdfNote } from '../lib/pdfNoteService';
import {
  Trash2,
  MessageSquare,
  Check,
  X,
  Move,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Palette,
  Type,
  Edit3,
  Square,
  Squircle,
  Circle,
  Sparkles,
  Maximize2,
  GripHorizontal
} from 'lucide-react';

export const TEXT_COLOR_PRESETS = [
  { label: '白', value: '#ffffff' },
  { label: '黒', value: '#0f172a' },
  { label: '赤', value: '#ef4444' },
  { label: '青', value: '#2563eb' },
  { label: '緑', value: '#10b981' },
  { label: '橙', value: '#f59e0b' },
  { label: '紫', value: '#8b5cf6' },
];

export const BG_COLOR_PRESETS = [
  { label: 'ダーク', value: '#0f172a', previewBg: '#0f172a' },
  { label: '白', value: '#ffffff', previewBg: '#ffffff' },
  { label: '付箋黄', value: '#fef08a', previewBg: '#fef08a' },
  { label: '薄青', value: '#dbeafe', previewBg: '#dbeafe' },
  { label: '薄赤', value: '#fee2e2', previewBg: '#fee2e2' },
  { label: '薄緑', value: '#d1fae5', previewBg: '#d1fae5' },
  { label: '透明', value: 'transparent', previewBg: 'repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 8px 8px' },
];

export const BORDER_COLOR_PRESETS = [
  { label: '透明(なし)', value: 'transparent' },
  { label: 'グレー', value: '#94a3b8' },
  { label: '黒', value: '#0f172a' },
  { label: '白', value: '#ffffff' },
  { label: '青', value: '#2563eb' },
  { label: '赤', value: '#ef4444' },
  { label: '緑', value: '#10b981' },
  { label: '黄', value: '#f59e0b' },
];

export const RECT_FILL_COLOR_PRESETS = [
  { label: '枠線と同色', value: 'auto' },
  { label: '白', value: '#ffffff' },
  { label: '黄色', value: '#fef08a' },
  { label: '赤', value: '#ef4444' },
  { label: '青', value: '#2563eb' },
  { label: '緑', value: '#10b981' },
  { label: '黒', value: '#0f172a' },
];

export const FONT_SIZE_PRESETS = [
  { label: '小 (11px)', value: 11 },
  { label: '標準 (13px)', value: 13 },
  { label: '中 (16px)', value: 16 },
  { label: '大 (20px)', value: 20 },
  { label: '特大 (26px)', value: 26 },
];

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface HandleInfo {
  handle: ResizeHandle;
  x: number;
  y: number;
  cursor: string;
}

interface PdfNoteCanvasOverlayProps {
  shipmentId: string;
  pageNumber: number;
  notes: PdfAnnotationNote[];
  activeTool: 'view' | 'pen' | 'line' | 'text' | 'rect' | 'eraser';
  activeColor: string;
  lineWidth: number;
  width: number;
  height: number;
  rectShape?: 'rectangle' | 'rounded' | 'circle';
  rectFillMode?: 'transparent' | 'tint' | 'solid';
  rectFillColor?: string;
  authorName?: string;
  onNoteAdded: (note: PdfAnnotationNote) => void;
  onNoteDeleted: (noteId: string) => void;
}

// Canonical reference width for scale invariant math
const REF_WIDTH = 800;

function hexToRgba(hex: string, opacity: number = 1): string {
  if (!hex || hex === 'transparent') return 'transparent';
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Canvas helper for cross-browser rounded rectangle
function drawCanvasRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
}

export const PdfNoteCanvasOverlay: React.FC<PdfNoteCanvasOverlayProps> = ({
  shipmentId,
  pageNumber,
  notes,
  activeTool,
  activeColor,
  lineWidth,
  width,
  height,
  rectShape = 'rectangle' as 'rectangle' | 'rounded' | 'circle',
  rectFillMode = 'tint',
  rectFillColor = 'auto',
  authorName = '担当者',
  onNoteAdded,
  onNoteDeleted,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scaleRatio = width / REF_WIDTH;

  // Drawing in progress states
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [lineStart, setLineStart] = useState<Point | null>(null);
  const [currentLine, setCurrentLine] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  // Object Dragging / Moving States
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isDraggingObject, setIsDraggingObject] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<{ relX: number; relY: number } | null>(null);
  const [dragOriginNote, setDragOriginNote] = useState<PdfAnnotationNote | null>(null);
  const [draggedNote, setDraggedNote] = useState<PdfAnnotationNote | null>(null);

  // Object Resizing States
  const [isResizingObject, setIsResizingObject] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle | null>(null);
  const [resizeOriginBounds, setResizeOriginBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState<{ pixelX: number; pixelY: number } | null>(null);
  const [resizeOriginNote, setResizeOriginNote] = useState<PdfAnnotationNote | null>(null);

  // Text input popup state
  const [textInputPos, setTextInputPos] = useState<{ relX: number; relY: number; pixelX: number; pixelY: number } | null>(null);
  const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const modalDragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const [inputText, setInputText] = useState('');
  const [selectedTextColor, setSelectedTextColor] = useState<string>('#ffffff');
  const [selectedBgColor, setSelectedBgColor] = useState<string>('#0f172a');
  const [selectedBorderColor, setSelectedBorderColor] = useState<string>('#94a3b8');
  const [selectedFontSize, setSelectedFontSize] = useState<number>(13);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // Safe position calculation to ensure modal never overflows canvas boundaries
  const calculateSafeModalPos = useCallback((pixelX: number, pixelY: number) => {
    const modalW = 320;
    const modalH = 430;
    let safeX = Math.max(12, Math.min(pixelX, width - modalW - 12));
    let safeY = pixelY;
    if (safeY + modalH > height - 12) {
      safeY = Math.max(12, height - modalH - 12);
    }
    safeY = Math.max(12, safeY);
    return { x: safeX, y: safeY };
  }, [width, height]);

  // Handle modal dragging
  const handleModalDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!modalPos) return;
    setIsDraggingModal(true);
    modalDragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: modalPos.x,
      startY: modalPos.y,
    };
  };

  useEffect(() => {
    if (!isDraggingModal) return;

    const handleMouseMoveWindow = (e: MouseEvent) => {
      if (!modalDragStartRef.current) return;
      const dx = e.clientX - modalDragStartRef.current.mouseX;
      const dy = e.clientY - modalDragStartRef.current.mouseY;
      const modalW = 320;
      const modalH = 380;
      const newX = Math.max(0, Math.min(modalDragStartRef.current.startX + dx, Math.max(0, width - modalW)));
      const newY = Math.max(0, Math.min(modalDragStartRef.current.startY + dy, Math.max(0, height - 100)));
      setModalPos({ x: newX, y: newY });
    };

    const handleMouseUpWindow = () => {
      setIsDraggingModal(false);
      modalDragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMoveWindow);
    window.addEventListener('mouseup', handleMouseUpWindow);
    return () => {
      window.removeEventListener('mousemove', handleMouseMoveWindow);
      window.removeEventListener('mouseup', handleMouseUpWindow);
    };
  }, [isDraggingModal, width, height]);

  // Hover states
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<ResizeHandle | null>(null);

  const pageNotes = useMemo(() => notes.filter((n) => n.pageNumber === pageNumber), [notes, pageNumber]);

  // Helper to calculate segment distance
  const pointToSegmentDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  };

  // Helper to get pixel bounding box for any note
  const getNoteBounds = useCallback((note: PdfAnnotationNote): { x: number; y: number; w: number; h: number } => {
    const currentScaleRatio = width / REF_WIDTH;

    if (note.type === 'text' && note.x !== undefined && note.y !== undefined) {
      if (note.width !== undefined && note.height !== undefined) {
        return {
          x: note.x * width,
          y: note.y * height,
          w: note.width * width,
          h: note.height * height,
        };
      }
      const fontSize = Math.max(10, Math.round((note.fontSize || 13) * currentScaleRatio));
      const textLen = (note.text || '').length;
      const defaultPaddingX = 8 * currentScaleRatio;
      const defaultPaddingY = 4 * currentScaleRatio;
      const approxCharW = fontSize * 0.65;
      const boxW = Math.max(textLen * approxCharW + defaultPaddingX * 2, 40);
      const boxH = fontSize + defaultPaddingY * 2;
      const boxX = note.x * width;
      const boxY = note.y * height - (fontSize * 0.85);
      return { x: boxX, y: boxY, w: boxW, h: boxH };
    } else if (note.type === 'rect' && note.x !== undefined && note.y !== undefined && note.width !== undefined && note.height !== undefined) {
      return {
        x: note.x * width,
        y: note.y * height,
        w: note.width * width,
        h: note.height * height,
      };
    } else if (note.type === 'line') {
      const sx = (note.startX !== undefined ? note.startX : note.points?.[0]?.x || 0) * width;
      const sy = (note.startY !== undefined ? note.startY : note.points?.[0]?.y || 0) * height;
      const ex = (note.endX !== undefined ? note.endX : note.points?.[1]?.x || 0) * width;
      const ey = (note.endY !== undefined ? note.endY : note.points?.[1]?.y || 0) * height;
      const minX = Math.min(sx, ex);
      const minY = Math.min(sy, ey);
      const maxX = Math.max(sx, ex);
      const maxY = Math.max(sy, ey);
      return {
        x: minX - 6,
        y: minY - 6,
        w: Math.max(maxX - minX + 12, 16),
        h: Math.max(maxY - minY + 12, 16),
      };
    } else if (note.type === 'stroke' && note.points && note.points.length > 0) {
      const xs = note.points.map((p) => p.x * width);
      const ys = note.points.map((p) => p.y * height);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        x: minX - 6,
        y: minY - 6,
        w: Math.max(maxX - minX + 12, 16),
        h: Math.max(maxY - minY + 12, 16),
      };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }, [width, height]);

  // Non-overlapping position calculation for selected object property panel
  const calculateNonOverlappingControlPos = useCallback(
    (bounds: { x: number; y: number; w: number; h: number }) => {
      const panelW = 330;
      const panelH = 220;
      const gap = 16;

      // 1. Try placing to the right of the object
      if (bounds.x + bounds.w + gap + panelW <= width - 10) {
        const safeY = Math.max(10, Math.min(bounds.y, height - panelH - 10));
        return { x: bounds.x + bounds.w + gap, y: safeY };
      }

      // 2. Try placing to the left of the object
      if (bounds.x - gap - panelW >= 10) {
        const safeY = Math.max(10, Math.min(bounds.y, height - panelH - 10));
        return { x: bounds.x - gap - panelW, y: safeY };
      }

      // 3. Try placing below the object
      if (bounds.y + bounds.h + gap + panelH <= height - 10) {
        const safeX = Math.max(10, Math.min(bounds.x, width - panelW - 10));
        return { x: safeX, y: bounds.y + bounds.h + gap };
      }

      // 4. Try placing above the object
      if (bounds.y - gap - panelH >= 10) {
        const safeX = Math.max(10, Math.min(bounds.x, width - panelW - 10));
        return { x: safeX, y: bounds.y - gap - panelH };
      }

      // 5. Fallback: clamp within canvas bounds without covering center
      const safeX = Math.max(10, Math.min(bounds.x + bounds.w + gap, width - panelW - 10));
      const safeY = Math.max(10, Math.min(bounds.y, height - panelH - 10));
      return { x: safeX, y: safeY };
    },
    [width, height]
  );

  // Property panel position & dragging state
  const [controlPanelPos, setControlPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingControlPanel, setIsDraggingControlPanel] = useState(false);
  const controlPanelDragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const hasUserDraggedControlPanelRef = useRef<boolean>(false);
  const lastSelectedNoteIdRef = useRef<string | null>(null);

  // Position control panel when a note is selected or note moves (if not manually moved)
  useEffect(() => {
    if (!selectedNoteId) {
      setControlPanelPos((prev) => (prev === null ? prev : null));
      lastSelectedNoteIdRef.current = null;
      hasUserDraggedControlPanelRef.current = false;
      return;
    }

    // If newly selected a different note, reset manual position flag
    if (lastSelectedNoteIdRef.current !== selectedNoteId) {
      hasUserDraggedControlPanelRef.current = false;
      lastSelectedNoteIdRef.current = selectedNoteId;
    }

    const note = pageNotes.find((n) => n.id === selectedNoteId);
    if (note && !hasUserDraggedControlPanelRef.current) {
      const bounds = getNoteBounds(note);
      const nextPos = calculateNonOverlappingControlPos(bounds);
      setControlPanelPos((prev) => {
        if (prev && prev.x === nextPos.x && prev.y === nextPos.y) return prev;
        return nextPos;
      });
    }
  }, [selectedNoteId, pageNotes, getNoteBounds, calculateNonOverlappingControlPos]);

  // Handle control panel dragging
  const handleControlPanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!controlPanelPos) return;
    setIsDraggingControlPanel(true);
    hasUserDraggedControlPanelRef.current = true;
    controlPanelDragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: controlPanelPos.x,
      startY: controlPanelPos.y,
    };
  };

  useEffect(() => {
    if (!isDraggingControlPanel) return;

    const handleMouseMoveWindow = (e: MouseEvent) => {
      if (!controlPanelDragStartRef.current) return;
      const dx = e.clientX - controlPanelDragStartRef.current.mouseX;
      const dy = e.clientY - controlPanelDragStartRef.current.mouseY;
      const panelW = 330;
      const panelH = 220;
      const newX = Math.max(0, Math.min(controlPanelDragStartRef.current.startX + dx, Math.max(0, width - panelW)));
      const newY = Math.max(0, Math.min(controlPanelDragStartRef.current.startY + dy, Math.max(0, height - panelH)));
      setControlPanelPos({ x: newX, y: newY });
    };

    const handleMouseUpWindow = () => {
      setIsDraggingControlPanel(false);
      controlPanelDragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMoveWindow);
    window.addEventListener('mouseup', handleMouseUpWindow);
    return () => {
      window.removeEventListener('mousemove', handleMouseMoveWindow);
      window.removeEventListener('mouseup', handleMouseUpWindow);
    };
  }, [isDraggingControlPanel, width, height]);

  // Helper to generate the 8 resize handles for a bounding box
  const getHandles = useCallback((bounds: { x: number; y: number; w: number; h: number }): HandleInfo[] => {
    const { x, y, w, h } = bounds;
    return [
      { handle: 'nw', x: x, y: y, cursor: 'nwse-resize' },
      { handle: 'n', x: x + w / 2, y: y, cursor: 'ns-resize' },
      { handle: 'ne', x: x + w, y: y, cursor: 'nesw-resize' },
      { handle: 'e', x: x + w, y: y + h / 2, cursor: 'ew-resize' },
      { handle: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
      { handle: 's', x: x + w / 2, y: y + h, cursor: 'ns-resize' },
      { handle: 'sw', x: x, y: y + h, cursor: 'nesw-resize' },
      { handle: 'w', x: x, y: y + h / 2, cursor: 'ew-resize' },
    ];
  }, []);

  // Helper to translate note coordinates
  const translateNote = (orig: PdfAnnotationNote, dx: number, dy: number): PdfAnnotationNote => {
    const updated: PdfAnnotationNote = { ...orig };
    if (orig.type === 'stroke' && orig.points) {
      updated.points = orig.points.map((pt) => ({
        x: Math.max(0, Math.min(1, pt.x + dx)),
        y: Math.max(0, Math.min(1, pt.y + dy)),
      }));
    } else if (orig.type === 'line') {
      const sx = (orig.startX !== undefined ? orig.startX : orig.points?.[0]?.x || 0) + dx;
      const sy = (orig.startY !== undefined ? orig.startY : orig.points?.[0]?.y || 0) + dy;
      const ex = (orig.endX !== undefined ? orig.endX : orig.points?.[1]?.x || 0) + dx;
      const ey = (orig.endY !== undefined ? orig.endY : orig.points?.[1]?.y || 0) + dy;
      updated.startX = Math.max(0, Math.min(1, sx));
      updated.startY = Math.max(0, Math.min(1, sy));
      updated.endX = Math.max(0, Math.min(1, ex));
      updated.endY = Math.max(0, Math.min(1, ey));
      if (orig.points && orig.points.length >= 2) {
        updated.points = [
          { x: updated.startX, y: updated.startY },
          { x: updated.endX, y: updated.endY },
        ];
      }
    } else if (orig.type === 'rect' && orig.x !== undefined && orig.y !== undefined) {
      const w = orig.width || 0.05;
      const h = orig.height || 0.05;
      updated.x = Math.max(0, Math.min(1 - w, orig.x + dx));
      updated.y = Math.max(0, Math.min(1 - h, orig.y + dy));
      updated.width = orig.width;
      updated.height = orig.height;
    } else if (orig.type === 'text' && orig.x !== undefined && orig.y !== undefined) {
      const w = orig.width || 0.05;
      const h = orig.height || 0.03;
      updated.x = Math.max(0, Math.min(1 - w, orig.x + dx));
      updated.y = Math.max(0, Math.min(1 - h, orig.y + dy));
    }
    return updated;
  };

  // Find note under pointer
  const findNoteAtPixel = useCallback((pixelX: number, pixelY: number): PdfAnnotationNote | null => {
    for (let i = pageNotes.length - 1; i >= 0; i--) {
      const note = pageNotes[i];
      const bounds = getNoteBounds(note);

      if (note.type === 'text' || note.type === 'rect') {
        if (
          pixelX >= bounds.x - 6 &&
          pixelX <= bounds.x + bounds.w + 6 &&
          pixelY >= bounds.y - 6 &&
          pixelY <= bounds.y + bounds.h + 6
        ) {
          return note;
        }
      } else if (note.type === 'line') {
        const sx = (note.startX !== undefined ? note.startX : note.points?.[0]?.x || 0) * width;
        const sy = (note.startY !== undefined ? note.startY : note.points?.[0]?.y || 0) * height;
        const ex = (note.endX !== undefined ? note.endX : note.points?.[1]?.x || 0) * width;
        const ey = (note.endY !== undefined ? note.endY : note.points?.[1]?.y || 0) * height;
        if (pointToSegmentDistance(pixelX, pixelY, sx, sy, ex, ey) <= 12) {
          return note;
        }
      } else if (note.type === 'stroke' && note.points) {
        for (let j = 0; j < note.points.length; j++) {
          const pt = note.points[j];
          const px = pt.x * width;
          const py = pt.y * height;
          if (Math.hypot(pixelX - px, pixelY - py) <= 14) {
            return note;
          }
          if (j > 0) {
            const prev = note.points[j - 1];
            if (pointToSegmentDistance(pixelX, pixelY, prev.x * width, prev.y * height, px, py) <= 12) {
              return note;
            }
          }
        }
      }
    }
    return null;
  }, [pageNotes, getNoteBounds, width, height]);

  // Main canvas redraw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const renderNotes = pageNotes.map((n) => (draggedNote && draggedNote.id === n.id ? draggedNote : n));

    renderNotes.forEach((note) => {
      const isSelected = selectedNoteId === note.id;
      const isHovered = hoveredNoteId === note.id && !isSelected;

      if (note.type === 'stroke' && note.points && note.points.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = isSelected ? '#2563eb' : isHovered ? '#3b82f6' : note.color;
        ctx.lineWidth = (note.lineWidth || 3) * scaleRatio * (isSelected ? 1.3 : 1);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const p0 = note.points[0];
        ctx.moveTo(p0.x * width, p0.y * height);

        for (let i = 1; i < note.points.length; i++) {
          const pt = note.points[i];
          ctx.lineTo(pt.x * width, pt.y * height);
        }
        ctx.stroke();
      } else if (note.type === 'line') {
        const sx = (note.startX !== undefined ? note.startX : note.points?.[0]?.x || 0) * width;
        const sy = (note.startY !== undefined ? note.startY : note.points?.[0]?.y || 0) * height;
        const ex = (note.endX !== undefined ? note.endX : note.points?.[1]?.x || 0) * width;
        const ey = (note.endY !== undefined ? note.endY : note.points?.[1]?.y || 0) * height;

        ctx.beginPath();
        ctx.strokeStyle = isSelected ? '#2563eb' : isHovered ? '#3b82f6' : note.color;
        ctx.lineWidth = (note.lineWidth || 3) * scaleRatio * (isSelected ? 1.3 : 1);
        ctx.lineCap = 'round';
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      } else if (note.type === 'rect' && note.x !== undefined && note.y !== undefined && note.width !== undefined && note.height !== undefined) {
        const rx = note.x * width;
        const ry = note.y * height;
        const rw = note.width * width;
        const rh = note.height * height;

        // Fill background
        const fillColor = note.fillColor !== undefined ? note.fillColor : (note.bgColor !== undefined ? note.bgColor : note.color);
        const fillOpacity = note.fillOpacity !== undefined ? note.fillOpacity : (fillColor === 'transparent' ? 0 : 0.15);
        const shape = note.rectShape || 'rectangle';
        const strokeColor = isSelected ? '#2563eb' : isHovered ? '#3b82f6' : note.color;
        const strokeWidth = (note.lineWidth || 2) * scaleRatio * (isSelected ? 1.4 : 1);

        if (shape === 'circle') {
          const cx = rx + rw / 2;
          const cy = ry + rh / 2;
          const radiusX = Math.max(0.1, Math.abs(rw / 2));
          const radiusY = Math.max(0.1, Math.abs(rh / 2));

          if (fillColor !== 'transparent' && fillOpacity > 0) {
            ctx.beginPath();
            ctx.fillStyle = hexToRgba(fillColor, fillOpacity);
            ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.beginPath();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (shape === 'rounded') {
          const radius = Math.min(10 * scaleRatio, Math.min(Math.abs(rw), Math.abs(rh)) / 4);

          if (fillColor !== 'transparent' && fillOpacity > 0) {
            ctx.beginPath();
            ctx.fillStyle = hexToRgba(fillColor, fillOpacity);
            drawCanvasRoundRect(ctx, rx, ry, rw, rh, radius);
            ctx.fill();
          }

          ctx.beginPath();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          drawCanvasRoundRect(ctx, rx, ry, rw, rh, radius);
          ctx.stroke();
        } else {
          if (fillColor !== 'transparent' && fillOpacity > 0) {
            ctx.fillStyle = hexToRgba(fillColor, fillOpacity);
            ctx.fillRect(rx, ry, rw, rh);
          }

          // Outline
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.strokeRect(rx, ry, rw, rh);
        }
      } else if (note.type === 'text' && note.x !== undefined && note.y !== undefined && note.text) {
        const fontSize = Math.max(10, Math.round((note.fontSize || 13) * scaleRatio));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(note.text);
        const defaultPaddingX = 8 * scaleRatio;
        const defaultPaddingY = 4 * scaleRatio;
        const autoBoxW = textMetrics.width + defaultPaddingX * 2;
        const autoBoxH = fontSize + defaultPaddingY * 2;

        let boxX: number;
        let boxY: number;
        let boxW: number;
        let boxH: number;

        if (note.width !== undefined && note.height !== undefined) {
          boxX = note.x * width;
          boxY = note.y * height;
          boxW = note.width * width;
          boxH = note.height * height;
        } else {
          boxX = note.x * width;
          boxY = note.y * height - (fontSize * 0.85);
          boxW = autoBoxW;
          boxH = autoBoxH;
        }

        const effectiveBgColor = note.bgColor !== undefined ? note.bgColor : 'rgba(15, 23, 42, 0.88)';
        const effectiveTextColor = note.textColor || note.color || '#ffffff';
        const effectiveBorderColor = note.borderColor !== undefined
          ? note.borderColor
          : (effectiveBgColor === '#ffffff' || effectiveBgColor.startsWith('#f') || effectiveBgColor.startsWith('#d')
            ? '#94a3b8'
            : effectiveTextColor);

        // Draw note background if not transparent
        if (effectiveBgColor !== 'transparent') {
          ctx.beginPath();
          const radius = Math.min(6 * scaleRatio, boxH / 2);
          if (ctx.roundRect) {
            ctx.roundRect(boxX, boxY, boxW, boxH, radius);
          } else {
            ctx.rect(boxX, boxY, boxW, boxH);
          }
          ctx.fillStyle = isSelected && effectiveBgColor === '#0f172a'
            ? '#1e3a8a'
            : isHovered
            ? (effectiveBgColor === '#0f172a' ? '#1e293b' : effectiveBgColor)
            : effectiveBgColor;
          ctx.fill();

          // Border outline
          if (effectiveBorderColor !== 'transparent' || isSelected || isHovered) {
            ctx.strokeStyle = isSelected
              ? '#3b82f6'
              : isHovered
              ? '#60a5fa'
              : effectiveBorderColor;
            ctx.lineWidth = Math.max(1, (note.borderWidth || (isSelected ? 2 : 1)) * scaleRatio);
            ctx.stroke();
          }
        } else {
          // Transparent background: Draw outline on hover or selection for clarity
          if (isSelected || isHovered) {
            ctx.strokeStyle = isSelected ? '#3b82f6' : '#94a3b8';
            ctx.lineWidth = 1 * scaleRatio;
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(boxX, boxY, boxW, boxH);
            ctx.setLineDash([]);
          }
        }

        // Draw Note text centered / padded in box
        ctx.fillStyle = effectiveTextColor;
        const textY = boxY + (boxH + fontSize * 0.72) / 2;
        const textX = boxX + Math.max(defaultPaddingX, (boxW - textMetrics.width) / 2);

        ctx.save();
        ctx.beginPath();
        ctx.rect(boxX, boxY, boxW, boxH);
        ctx.clip();
        ctx.fillText(note.text, textX, textY);
        ctx.restore();
      }

      // If selected in view mode, draw bounding box & 8 interactive resize handles
      if (isSelected && activeTool === 'view') {
        const bounds = getNoteBounds(note);
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bounds.x - 3, bounds.y - 3, bounds.w + 6, bounds.h + 6);
        ctx.setLineDash([]);

        if (note.type === 'rect' || note.type === 'text') {
          const handles = getHandles(bounds);
          handles.forEach((h) => {
            const isHov = hoveredHandle === h.handle;
            const size = isHov ? 9 : 7;
            ctx.fillStyle = isHov ? '#1d4ed8' : '#ffffff';
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1.5;
            ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
            ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
          });
        }
        ctx.restore();
      }
    });

    // Active stroke in progress
    if (isDrawing && currentPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = lineWidth * scaleRatio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.moveTo(currentPoints[0].x * width, currentPoints[0].y * height);
      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i].x * width, currentPoints[i].y * height);
      }
      ctx.stroke();
    }

    // Active line in progress
    if (isDrawing && currentLine) {
      ctx.beginPath();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = lineWidth * scaleRatio;
      ctx.lineCap = 'round';
      ctx.moveTo(currentLine.startX, currentLine.startY);
      ctx.lineTo(currentLine.endX, currentLine.endY);
      ctx.stroke();
    }

    // Active rectangle in progress
    if (currentRect) {
      const activeFillColor = rectFillColor === 'auto' ? activeColor : rectFillColor;
      const activeOpacity = rectFillMode === 'transparent' ? 0 : rectFillMode === 'solid' ? 1.0 : 0.18;
      const rx = currentRect.x;
      const ry = currentRect.y;
      const rw = currentRect.w;
      const rh = currentRect.h;
      const shape = rectShape || 'rectangle';

      if (shape === 'circle') {
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        const radiusX = Math.max(0.1, Math.abs(rw / 2));
        const radiusY = Math.max(0.1, Math.abs(rh / 2));

        if (activeFillColor !== 'transparent' && activeOpacity > 0) {
          ctx.beginPath();
          ctx.fillStyle = hexToRgba(activeFillColor, activeOpacity);
          ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = lineWidth * scaleRatio;
        ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape === 'rounded') {
        const radius = Math.min(10 * scaleRatio, Math.min(Math.abs(rw), Math.abs(rh)) / 4);

        if (activeFillColor !== 'transparent' && activeOpacity > 0) {
          ctx.beginPath();
          ctx.fillStyle = hexToRgba(activeFillColor, activeOpacity);
          drawCanvasRoundRect(ctx, rx, ry, rw, rh, radius);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = lineWidth * scaleRatio;
        drawCanvasRoundRect(ctx, rx, ry, rw, rh, radius);
        ctx.stroke();
      } else {
        if (activeFillColor !== 'transparent' && activeOpacity > 0) {
          ctx.fillStyle = hexToRgba(activeFillColor, activeOpacity);
          ctx.fillRect(rx, ry, rw, rh);
        }

        ctx.strokeStyle = activeColor;
        ctx.lineWidth = lineWidth * scaleRatio;
        ctx.strokeRect(rx, ry, rw, rh);
      }
    }
  }, [
    notes,
    pageNotes,
    currentPoints,
    currentLine,
    currentRect,
    isDrawing,
    width,
    height,
    activeColor,
    lineWidth,
    hoveredNoteId,
    hoveredHandle,
    selectedNoteId,
    draggedNote,
    getNoteBounds,
    getHandles,
    activeTool,
    scaleRatio,
    rectShape,
    rectFillMode,
    rectFillColor,
  ]);

  // Keyboard navigation & fine-tuning
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!selectedNoteId) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      const targetNote = pageNotes.find((n) => n.id === selectedNoteId);
      if (!targetNote) return;

      let dx = 0;
      let dy = 0;
      const step = e.shiftKey ? 0.02 : 0.005;

      if (e.key === 'ArrowLeft') {
        dx = -step;
      } else if (e.key === 'ArrowRight') {
        dx = step;
      } else if (e.key === 'ArrowUp') {
        dy = -step;
      } else if (e.key === 'ArrowDown') {
        dy = step;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        await deletePdfNote(selectedNoteId);
        onNoteDeleted(selectedNoteId);
        setSelectedNoteId(null);
        return;
      } else if (e.key === 'Escape') {
        setSelectedNoteId(null);
        return;
      } else {
        return;
      }

      e.preventDefault();
      const updated = translateNote(targetNote, dx, dy);
      await savePdfNote(updated);
      onNoteAdded(updated);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedNoteId, pageNotes, onNoteAdded, onNoteDeleted]);

  // Calculate mouse position relative to canvas
  const getRelativePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { relX: 0, relY: 0, pixelX: 0, pixelY: 0 };
    const rect = canvas.getBoundingClientRect();
    const pixelX = Math.max(0, Math.min(width, e.clientX - rect.left));
    const pixelY = Math.max(0, Math.min(height, e.clientY - rect.top));
    const relX = pixelX / width;
    const relY = pixelY / height;
    return { relX, relY, pixelX, pixelY };
  };

  // Check if pointer hits a resize handle of selected note
  const findHandleAtPixel = useCallback((pixelX: number, pixelY: number): HandleInfo | null => {
    if (!selectedNoteId || activeTool !== 'view') return null;
    const selected = pageNotes.find((n) => n.id === selectedNoteId);
    if (!selected || (selected.type !== 'rect' && selected.type !== 'text')) return null;

    const bounds = getNoteBounds(selected);
    const handles = getHandles(bounds);
    const HIT_RADIUS = 9;

    for (const h of handles) {
      if (Math.hypot(pixelX - h.x, pixelY - h.y) <= HIT_RADIUS) {
        return h;
      }
    }
    return null;
  }, [selectedNoteId, activeTool, pageNotes, getNoteBounds, getHandles]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { relX, relY, pixelX, pixelY } = getRelativePos(e);

    // 1. If in 'view' mode:
    if (activeTool === 'view') {
      // Check if clicking on an active resize handle
      const hitHandle = findHandleAtPixel(pixelX, pixelY);
      if (hitHandle && selectedNoteId) {
        const selected = pageNotes.find((n) => n.id === selectedNoteId);
        if (selected) {
          setIsResizingObject(true);
          setActiveResizeHandle(hitHandle.handle);
          setResizeOriginNote(selected);
          setResizeOriginBounds(getNoteBounds(selected));
          setResizeStartPos({ pixelX, pixelY });
          setDraggedNote(selected);
          return;
        }
      }

      // Check if clicking an existing note body
      const hit = findNoteAtPixel(pixelX, pixelY);
      if (hit) {
        setSelectedNoteId(hit.id);
        setIsDraggingObject(true);
        setDragStartPos({ relX, relY });
        setDragOriginNote(hit);
        setDraggedNote(hit);
      } else {
        setSelectedNoteId(null);
      }
      return;
    }

    if (activeTool === 'pen') {
      setIsDrawing(true);
      setCurrentPoints([{ x: relX, y: relY }]);
    } else if (activeTool === 'line') {
      setIsDrawing(true);
      setLineStart({ x: relX, y: relY });
      setCurrentLine({ startX: pixelX, startY: pixelY, endX: pixelX, endY: pixelY });
    } else if (activeTool === 'rect') {
      setIsDrawing(true);
      setRectStart({ x: relX, y: relY });
      setCurrentRect({ x: pixelX, y: pixelY, w: 0, h: 0 });
    } else if (activeTool === 'text') {
      setTextInputPos({ relX, relY, pixelX, pixelY });
      setModalPos(calculateSafeModalPos(pixelX, pixelY));
      setInputText('');
      setEditingNoteId(null);
      setSelectedTextColor(activeColor === '#0f172a' ? '#ffffff' : activeColor);
      setSelectedBgColor('#0f172a');
      setSelectedBorderColor('#94a3b8');
      setSelectedFontSize(13);
    } else if (activeTool === 'eraser') {
      const hit = findNoteAtPixel(pixelX, pixelY);
      if (hit) {
        deletePdfNote(hit.id);
        onNoteDeleted(hit.id);
        if (selectedNoteId === hit.id) setSelectedNoteId(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { relX, relY, pixelX, pixelY } = getRelativePos(e);

    // 1. Handle Active Resizing
    if (isResizingObject && resizeOriginBounds && resizeStartPos && resizeOriginNote && activeResizeHandle) {
      const dx = pixelX - resizeStartPos.pixelX;
      const dy = pixelY - resizeStartPos.pixelY;

      let newX = resizeOriginBounds.x;
      let newY = resizeOriginBounds.y;
      let newW = resizeOriginBounds.w;
      let newH = resizeOriginBounds.h;

      const MIN_W = 24;
      const MIN_H = 16;

      switch (activeResizeHandle) {
        case 'se':
          newW = Math.max(MIN_W, resizeOriginBounds.w + dx);
          newH = Math.max(MIN_H, resizeOriginBounds.h + dy);
          break;
        case 'e':
          newW = Math.max(MIN_W, resizeOriginBounds.w + dx);
          break;
        case 's':
          newH = Math.max(MIN_H, resizeOriginBounds.h + dy);
          break;
        case 'nw': {
          const maxDx = resizeOriginBounds.w - MIN_W;
          const effDx = Math.min(dx, maxDx);
          const maxDy = resizeOriginBounds.h - MIN_H;
          const effDy = Math.min(dy, maxDy);
          newX = resizeOriginBounds.x + effDx;
          newY = resizeOriginBounds.y + effDy;
          newW = resizeOriginBounds.w - effDx;
          newH = resizeOriginBounds.h - effDy;
          break;
        }
        case 'n': {
          const maxDy = resizeOriginBounds.h - MIN_H;
          const effDy = Math.min(dy, maxDy);
          newY = resizeOriginBounds.y + effDy;
          newH = resizeOriginBounds.h - effDy;
          break;
        }
        case 'w': {
          const maxDx = resizeOriginBounds.w - MIN_W;
          const effDx = Math.min(dx, maxDx);
          newX = resizeOriginBounds.x + effDx;
          newW = resizeOriginBounds.w - effDx;
          break;
        }
        case 'ne': {
          const maxDy = resizeOriginBounds.h - MIN_H;
          const effDy = Math.min(dy, maxDy);
          newY = resizeOriginBounds.y + effDy;
          newW = Math.max(MIN_W, resizeOriginBounds.w + dx);
          newH = resizeOriginBounds.h - effDy;
          break;
        }
        case 'sw': {
          const maxDx = resizeOriginBounds.w - MIN_W;
          const effDx = Math.min(dx, maxDx);
          newX = resizeOriginBounds.x + effDx;
          newW = resizeOriginBounds.w - effDx;
          newH = Math.max(MIN_H, resizeOriginBounds.h + dy);
          break;
        }
      }

      const relXNorm = Math.max(0, Math.min(0.99, newX / width));
      const relYNorm = Math.max(0, Math.min(0.99, newY / height));
      const relWNorm = Math.max(0.01, Math.min(1 - relXNorm, newW / width));
      const relHNorm = Math.max(0.01, Math.min(1 - relYNorm, newH / height));

      setDraggedNote({
        ...resizeOriginNote,
        x: relXNorm,
        y: relYNorm,
        width: relWNorm,
        height: relHNorm,
      });
      return;
    }

    // 2. Handle Active Object Drag Moving
    if (isDraggingObject && dragOriginNote && dragStartPos) {
      const dx = relX - dragStartPos.relX;
      const dy = relY - dragStartPos.relY;
      const moved = translateNote(dragOriginNote, dx, dy);
      setDraggedNote(moved);
      return;
    }

    // 3. Handle Active Drawing
    if (isDrawing && activeTool === 'pen') {
      setCurrentPoints((prev) => [...prev, { x: relX, y: relY }]);
    } else if (isDrawing && activeTool === 'line' && lineStart) {
      setCurrentLine({
        startX: lineStart.x * width,
        startY: lineStart.y * height,
        endX: pixelX,
        endY: pixelY,
      });
    } else if (isDrawing && activeTool === 'rect' && rectStart) {
      const rx = Math.min(rectStart.x * width, pixelX);
      const ry = Math.min(rectStart.y * height, pixelY);
      const rw = Math.abs(pixelX - rectStart.x * width);
      const rh = Math.abs(pixelY - rectStart.y * height);
      setCurrentRect({ x: rx, y: ry, w: rw, h: rh });
    } else if (activeTool === 'view') {
      const hitHandle = findHandleAtPixel(pixelX, pixelY);
      setHoveredHandle(hitHandle ? hitHandle.handle : null);

      if (!hitHandle) {
        const hit = findNoteAtPixel(pixelX, pixelY);
        setHoveredNoteId(hit ? hit.id : null);
      } else {
        setHoveredNoteId(null);
      }
    } else if (activeTool === 'eraser') {
      const hit = findNoteAtPixel(pixelX, pixelY);
      setHoveredNoteId(hit ? hit.id : null);
    }
  };

  const handleMouseUp = async () => {
    // 1. Finalize Object Resize
    if (isResizingObject && draggedNote) {
      setIsResizingObject(false);
      setActiveResizeHandle(null);
      setResizeOriginBounds(null);
      setResizeStartPos(null);
      setResizeOriginNote(null);
      await savePdfNote(draggedNote);
      onNoteAdded(draggedNote);
      setDraggedNote(null);
      return;
    }

    // 2. Finalize Object Drag Move
    if (isDraggingObject && draggedNote) {
      setIsDraggingObject(false);
      setDragStartPos(null);
      setDragOriginNote(null);
      await savePdfNote(draggedNote);
      onNoteAdded(draggedNote);
      setDraggedNote(null);
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    if (activeTool === 'pen' && currentPoints.length > 1) {
      const newNote: PdfAnnotationNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        shipmentId,
        pageNumber,
        type: 'stroke',
        points: currentPoints,
        color: activeColor,
        lineWidth,
        authorName,
        createdAt: new Date().toISOString(),
      };
      await savePdfNote(newNote);
      onNoteAdded(newNote);
      setSelectedNoteId(newNote.id);
      setCurrentPoints([]);
    } else if (activeTool === 'line' && lineStart && currentLine) {
      const dist = Math.hypot(currentLine.endX - currentLine.startX, currentLine.endY - currentLine.startY);
      if (dist > 4) {
        const newNote: PdfAnnotationNote = {
          id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          shipmentId,
          pageNumber,
          type: 'line',
          startX: lineStart.x,
          startY: lineStart.y,
          endX: currentLine.endX / width,
          endY: currentLine.endY / height,
          points: [
            { x: lineStart.x, y: lineStart.y },
            { x: currentLine.endX / width, y: currentLine.endY / height },
          ],
          color: activeColor,
          lineWidth,
          authorName,
          createdAt: new Date().toISOString(),
        };
        await savePdfNote(newNote);
        onNoteAdded(newNote);
        setSelectedNoteId(newNote.id);
      }
      setLineStart(null);
      setCurrentLine(null);
    } else if (activeTool === 'rect' && rectStart && currentRect) {
      if (currentRect.w > 5 && currentRect.h > 5) {
        const finalFillColor = rectFillColor === 'auto' ? activeColor : rectFillColor;
        const finalFillOpacity = rectFillMode === 'transparent' ? 0 : rectFillMode === 'solid' ? 1.0 : 0.18;

        const newNote: PdfAnnotationNote = {
          id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          shipmentId,
          pageNumber,
          type: 'rect',
          rectShape,
          x: currentRect.x / width,
          y: currentRect.y / height,
          width: currentRect.w / width,
          height: currentRect.h / height,
          color: activeColor,
          fillColor: finalFillColor,
          fillOpacity: finalFillOpacity,
          lineWidth,
          authorName,
          createdAt: new Date().toISOString(),
        };
        await savePdfNote(newNote);
        onNoteAdded(newNote);
        setSelectedNoteId(newNote.id);
      }
      setRectStart(null);
      setCurrentRect(null);
    }
  };

  const handleAddTextNote = async () => {
    if (!textInputPos || !inputText.trim()) {
      setTextInputPos(null);
      setModalPos(null);
      setEditingNoteId(null);
      return;
    }

    if (editingNoteId) {
      const existing = pageNotes.find((n) => n.id === editingNoteId);
      if (existing) {
        const updated: PdfAnnotationNote = {
          ...existing,
          text: inputText.trim(),
          color: selectedTextColor,
          textColor: selectedTextColor,
          bgColor: selectedBgColor,
          borderColor: selectedBorderColor,
          fontSize: selectedFontSize,
        };
        await savePdfNote(updated);
        onNoteAdded(updated);
        setSelectedNoteId(updated.id);
      }
    } else {
      // Calculate initial auto width and height based on font size and length
      const currentScaleRatio = width / REF_WIDTH;
      const fontSizePx = Math.max(10, Math.round(selectedFontSize * currentScaleRatio));
      const approxW = Math.max(inputText.trim().length * fontSizePx * 0.65 + 16 * currentScaleRatio, 40);
      const approxH = fontSizePx + 8 * currentScaleRatio;

      const newNote: PdfAnnotationNote = {
        id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        shipmentId,
        pageNumber,
        type: 'text',
        x: textInputPos.relX,
        y: textInputPos.relY,
        width: approxW / width,
        height: approxH / height,
        text: inputText.trim(),
        color: selectedTextColor,
        textColor: selectedTextColor,
        bgColor: selectedBgColor,
        borderColor: selectedBorderColor,
        borderWidth: 1,
        fontSize: selectedFontSize,
        authorName,
        createdAt: new Date().toISOString(),
      };

      await savePdfNote(newNote);
      onNoteAdded(newNote);
      setSelectedNoteId(newNote.id);
    }

    setTextInputPos(null);
    setModalPos(null);
    setInputText('');
    setEditingNoteId(null);
  };

  // Nudge button handler
  const handleNudge = async (direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedNoteId) return;
    const targetNote = pageNotes.find((n) => n.id === selectedNoteId);
    if (!targetNote) return;

    const step = 0.005;
    let dx = 0;
    let dy = 0;
    if (direction === 'up') dy = -step;
    if (direction === 'down') dy = step;
    if (direction === 'left') dx = -step;
    if (direction === 'right') dx = step;

    const updated = translateNote(targetNote, dx, dy);
    await savePdfNote(updated);
    onNoteAdded(updated);
  };

  // Quick update note properties
  const handleQuickUpdateNote = async (patch: Partial<PdfAnnotationNote>) => {
    if (!selectedNoteId) return;
    const target = pageNotes.find((n) => n.id === selectedNoteId);
    if (!target) return;

    const updated: PdfAnnotationNote = {
      ...target,
      ...patch,
    };
    await savePdfNote(updated);
    onNoteAdded(updated);
  };

  // Reset text box to auto-size
  const handleResetTextSize = async () => {
    if (!selectedNoteId) return;
    const target = pageNotes.find((n) => n.id === selectedNoteId);
    if (!target || target.type !== 'text') return;

    const currentScaleRatio = width / REF_WIDTH;
    const fontSizePx = Math.max(10, Math.round((target.fontSize || 13) * currentScaleRatio));
    const approxW = Math.max((target.text || '').length * fontSizePx * 0.65 + 16 * currentScaleRatio, 40);
    const approxH = fontSizePx + 8 * currentScaleRatio;

    const updated: PdfAnnotationNote = {
      ...target,
      width: approxW / width,
      height: approxH / height,
    };
    await savePdfNote(updated);
    onNoteAdded(updated);
  };

  // Open edit modal for text note
  const handleOpenEditSelectedTextNote = () => {
    if (!selectedNoteId) return;
    const target = pageNotes.find((n) => n.id === selectedNoteId);
    if (!target || target.type !== 'text' || !target.text || target.x === undefined || target.y === undefined) return;

    const pxX = target.x * width;
    const pxY = target.y * height;
    setTextInputPos({
      relX: target.x,
      relY: target.y,
      pixelX: pxX,
      pixelY: pxY,
    });
    setModalPos(calculateSafeModalPos(pxX, pxY));
    setInputText(target.text);
    setSelectedTextColor(target.textColor || target.color || '#ffffff');
    setSelectedBgColor(target.bgColor !== undefined ? target.bgColor : '#0f172a');
    setSelectedBorderColor(target.borderColor !== undefined ? target.borderColor : '#94a3b8');
    setSelectedFontSize(target.fontSize || 13);
    setEditingNoteId(target.id);
  };

  const selectedNote = pageNotes.find((n) => n.id === selectedNoteId);
  const selectedBounds = selectedNote ? getNoteBounds(selectedNote) : null;

  // Determine cursor based on hover
  let cursorClass = 'cursor-default';
  if (isResizingObject) {
    cursorClass = 'cursor-nwse-resize';
  } else if (isDraggingObject) {
    cursorClass = 'cursor-grabbing';
  } else if (activeTool === 'view') {
    if (hoveredHandle) {
      const hObj = getHandles({ x: 0, y: 0, w: 100, h: 100 }).find((h) => h.handle === hoveredHandle);
      cursorClass = hObj?.cursor ? `cursor-${hObj.cursor}` : 'cursor-pointer';
    } else if (hoveredNoteId) {
      cursorClass = 'cursor-grab';
    }
  } else if (activeTool === 'pen' || activeTool === 'line' || activeTool === 'rect') {
    cursorClass = 'cursor-crosshair';
  } else if (activeTool === 'text') {
    cursorClass = 'cursor-text';
  } else if (activeTool === 'eraser') {
    cursorClass = 'cursor-pointer';
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-20 pointer-events-auto select-none"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`block w-full h-full pointer-events-auto ${cursorClass}`}
      />

      {/* Floating Control Box for Selected Object */}
      {selectedNote && selectedBounds && !isDraggingObject && !isResizingObject && (
        <div
          className="absolute z-40 pointer-events-auto bg-slate-900/98 backdrop-blur-md border border-blue-500/80 p-2.5 rounded-2xl shadow-2xl flex flex-col space-y-2 text-white animate-fade-in text-[11px]"
          style={{
            left: `${controlPanelPos?.x ?? Math.max(10, Math.min(selectedBounds.x + selectedBounds.w + 16, width - 340))}px`,
            top: `${controlPanelPos?.y ?? Math.max(10, Math.min(selectedBounds.y, height - 240))}px`,
            width: '325px',
          }}
        >
          {/* Draggable Header */}
          <div
            onMouseDown={handleControlPanelDragStart}
            className="flex items-center justify-between border-b border-slate-800 pb-1.5 cursor-move select-none active:cursor-grabbing hover:text-white"
            title="ドラッグしてメニューを自由に移動"
          >
            <div className="flex items-center space-x-1.5 text-blue-400 font-bold">
              <GripHorizontal className="w-4 h-4 text-slate-400 hover:text-blue-300 shrink-0" />
              <Move className="w-3.5 h-3.5" />
              <span className="text-[10.5px]">
                {selectedNote.type === 'text'
                  ? '文字注記プロパティ'
                  : selectedNote.type === 'rect'
                  ? '囲み枠プロパティ'
                  : 'オブジェクト微調整'}
              </span>
            </div>

            <div className="flex items-center space-x-1" onMouseDown={(e) => e.stopPropagation()}>
              <span className="text-[9px] text-slate-500 font-normal select-none mr-1">ドラッグ移動可</span>
              {selectedNote.type === 'text' && (
                <button
                  type="button"
                  onClick={handleOpenEditSelectedTextNote}
                  className="px-2 py-0.5 bg-blue-600/30 hover:bg-blue-600/60 text-blue-300 hover:text-white rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="テキスト内容を変更"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>編集</span>
                </button>
              )}

              {/* Delete selected object */}
              <button
                type="button"
                onClick={async () => {
                  if (selectedNoteId) {
                    await deletePdfNote(selectedNoteId);
                    onNoteDeleted(selectedNoteId);
                    setSelectedNoteId(null);
                  }
                }}
                className="p-1 bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 hover:text-rose-100 rounded-lg text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                title="削除 (Deleteキー)"
              >
                <Trash2 className="w-3 h-3" />
              </button>

              {/* Close button */}
              <button
                type="button"
                onClick={() => setSelectedNoteId(null)}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                title="選択解除 (ESC)"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Controls for Text Note */}
          {selectedNote.type === 'text' && (
            <div className="space-y-1.5 bg-slate-800/60 p-2 rounded-xl border border-slate-700/60 text-[10px]">
              {/* Text Color */}
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1 font-semibold text-slate-400">
                  <Type className="w-3 h-3 text-blue-400" />
                  <span>文字色:</span>
                </span>
                <div className="flex items-center space-x-1">
                  {TEXT_COLOR_PRESETS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => handleQuickUpdateNote({ color: c.value, textColor: c.value })}
                      className={`w-4 h-4 rounded-full border transition-transform cursor-pointer ${
                        (selectedNote.textColor || selectedNote.color) === c.value
                          ? 'scale-125 ring-2 ring-blue-400 border-white'
                          : 'border-slate-500 hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Background Color */}
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1 font-semibold text-slate-400">
                  <Palette className="w-3 h-3 text-amber-400" />
                  <span>背景色:</span>
                </span>
                <div className="flex items-center space-x-1">
                  {BG_COLOR_PRESETS.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => handleQuickUpdateNote({ bgColor: b.value })}
                      className={`w-4 h-4 rounded-md border transition-transform cursor-pointer relative ${
                        (selectedNote.bgColor || '#0f172a') === b.value
                          ? 'scale-125 ring-2 ring-blue-400 border-white'
                          : 'border-slate-600 hover:scale-110'
                      }`}
                      style={{
                        background: b.previewBg,
                      }}
                      title={b.label}
                    >
                      {b.value === 'transparent' && (
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] text-slate-400 font-bold">
                          ✕
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Frame / Border Color */}
              <div className="flex items-center justify-between text-slate-300 pt-0.5">
                <span className="flex items-center gap-1 font-semibold text-slate-400">
                  <Square className="w-3 h-3 text-emerald-400" />
                  <span>枠色:</span>
                </span>
                <div className="flex items-center space-x-1">
                  {BORDER_COLOR_PRESETS.map((bc) => (
                    <button
                      key={bc.value}
                      type="button"
                      onClick={() => handleQuickUpdateNote({ borderColor: bc.value })}
                      className={`w-4 h-4 rounded-md border transition-transform cursor-pointer relative ${
                        (selectedNote.borderColor || '#94a3b8') === bc.value
                          ? 'scale-125 ring-2 ring-emerald-400 border-white'
                          : 'border-slate-600 hover:scale-110'
                      }`}
                      style={{
                        backgroundColor: bc.value === 'transparent' ? 'transparent' : bc.value,
                      }}
                      title={bc.label}
                    >
                      {bc.value === 'transparent' && (
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] text-slate-400 font-bold">
                          ✕
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size & Auto Size Reset */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
                <div className="flex items-center space-x-1">
                  <span className="text-slate-400">文字サイズ:</span>
                  {[11, 13, 16, 20].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => handleQuickUpdateNote({ fontSize: sz })}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors ${
                        (selectedNote.fontSize || 13) === sz
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {sz}px
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleResetTextSize}
                  className="px-1.5 py-0.5 bg-slate-700/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[9px] font-bold flex items-center gap-1 cursor-pointer"
                  title="文字の長さに枠サイズを自動フィット"
                >
                  <Maximize2 className="w-2.5 h-2.5" />
                  <span>自動サイズ</span>
                </button>
              </div>
            </div>
          )}

          {/* Controls for Rectangle Note ("囲み") */}
          {selectedNote.type === 'rect' && (
            <div className="space-y-1.5 bg-slate-800/60 p-2 rounded-xl border border-slate-700/60 text-[10px]">
              {/* Shape Selector */}
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1 font-semibold text-slate-400">
                  <Square className="w-3 h-3 text-blue-400" />
                  <span>形状:</span>
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => handleQuickUpdateNote({ rectShape: 'rectangle' })}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                      (!selectedNote.rectShape || selectedNote.rectShape === 'rectangle')
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                    }`}
                    title="四角（標準の長方形）"
                  >
                    <Square className="w-2.5 h-2.5" />
                    <span>四角</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickUpdateNote({ rectShape: 'rounded' })}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                      selectedNote.rectShape === 'rounded'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                    }`}
                    title="角丸（角が丸みのある四角形）"
                  >
                    <Squircle className="w-2.5 h-2.5" />
                    <span>角丸</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickUpdateNote({ rectShape: 'circle' })}
                    className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                      selectedNote.rectShape === 'circle'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                    }`}
                    title="丸（円・楕円）"
                  >
                    <Circle className="w-2.5 h-2.5" />
                    <span>丸</span>
                  </button>
                </div>
              </div>

              {/* Border Color */}
              <div className="flex items-center justify-between text-slate-300">
                <span className="flex items-center gap-1 font-semibold text-slate-400">
                  <Palette className="w-3 h-3 text-blue-400" />
                  <span>枠線色:</span>
                </span>
                <div className="flex items-center space-x-1">
                  {['#ef4444', '#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#0f172a', '#ffffff'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleQuickUpdateNote({ color: c })}
                      className={`w-4 h-4 rounded-full border transition-transform cursor-pointer ${
                        selectedNote.color === c
                          ? 'scale-125 ring-2 ring-blue-400 border-white'
                          : 'border-slate-500 hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Line Width */}
              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">線幅:</span>
                <div className="flex items-center space-x-1">
                  {[1, 2, 3, 5].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => handleQuickUpdateNote({ lineWidth: w })}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                        (selectedNote.lineWidth || 2) === w
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Fill Mode */}
              <div className="flex items-center justify-between text-slate-300 pt-0.5">
                <span className="flex items-center gap-1 font-semibold text-slate-400">
                  <Palette className="w-3 h-3 text-amber-400" />
                  <span>塗りつぶし:</span>
                </span>
                <div className="flex items-center space-x-1">
                  {[
                    { label: '透明', opacity: 0, color: 'transparent' },
                    { label: '薄色', opacity: 0.18, color: selectedNote.color },
                    { label: '半透明', opacity: 0.5, color: selectedNote.color },
                    { label: '白塗り', opacity: 1.0, color: '#ffffff' },
                    { label: 'ベタ塗り', opacity: 1.0, color: selectedNote.color },
                  ].map((m, idx) => {
                    const isCur = (selectedNote.fillOpacity ?? (selectedNote.fillColor === 'transparent' ? 0 : 0.18)) === m.opacity &&
                      (m.color === 'transparent' || !selectedNote.fillColor || selectedNote.fillColor === m.color);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleQuickUpdateNote({ fillColor: m.color, fillOpacity: m.opacity })}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors ${
                          isCur
                            ? 'bg-amber-500 text-slate-900 shadow-xs'
                            : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Specific Fill Color Picker if not transparent */}
              {(selectedNote.fillOpacity ?? 0.15) > 0 && selectedNote.fillColor !== 'transparent' && (
                <div className="flex items-center justify-between text-slate-300 pt-0.5 border-t border-slate-700/50">
                  <span className="text-slate-400">塗りの色:</span>
                  <div className="flex items-center space-x-1">
                    {RECT_FILL_COLOR_PRESETS.map((p) => {
                      const actualColor = p.value === 'auto' ? selectedNote.color : p.value;
                      const isSel = (selectedNote.fillColor || selectedNote.color) === actualColor;
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => handleQuickUpdateNote({ fillColor: actualColor })}
                          className={`w-3.5 h-3.5 rounded-sm border cursor-pointer ${
                            isSel ? 'ring-2 ring-amber-400 border-white scale-110' : 'border-slate-600'
                          }`}
                          style={{ backgroundColor: actualColor }}
                          title={p.label}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* D-Pad Micro Adjustment Controls */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
            <span>矢印キーで微調整可:</span>
            <div className="flex items-center space-x-0.5 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => handleNudge('left')}
                className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white cursor-pointer"
                title="左へ微調整"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => handleNudge('up')}
                className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white cursor-pointer"
                title="上へ微調整"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => handleNudge('down')}
                className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white cursor-pointer"
                title="下へ微調整"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => handleNudge('right')}
                className="p-1 hover:bg-slate-700 rounded text-slate-300 hover:text-white cursor-pointer"
                title="右へ微調整"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resize / Movement active Pill Indicator */}
      {(isDraggingObject || isResizingObject) && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none bg-blue-600/95 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-xl flex items-center space-x-1.5 animate-pulse border border-blue-400">
          <Move className="w-3.5 h-3.5" />
          <span>{isResizingObject ? '枠サイズ変更中 (マウスを離して確定)' : '位置移動中 (マウスを離して確定)'}</span>
        </div>
      )}

      {/* Text note input modal popover */}
      {textInputPos && modalPos && (
        <div
          className="absolute z-50 pointer-events-auto bg-slate-900/98 backdrop-blur-md border border-blue-500/80 p-3 rounded-2xl shadow-2xl space-y-2 text-xs text-white max-h-[min(540px,calc(100%-20px))] overflow-y-auto flex flex-col"
          style={{
            left: `${modalPos.x}px`,
            top: `${modalPos.y}px`,
            width: '315px',
          }}
        >
          {/* Draggable Header */}
          <div
            onMouseDown={handleModalDragStart}
            className="flex justify-between items-center text-[11px] font-bold text-slate-300 border-b border-slate-800 pb-1.5 cursor-move select-none active:cursor-grabbing hover:text-white shrink-0"
            title="ドラッグしてメニューを自由に移動"
          >
            <span className="flex items-center gap-1.5 text-blue-400">
              <GripHorizontal className="w-4 h-4 text-slate-400 hover:text-blue-300 shrink-0" />
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{editingNoteId ? 'PDFテキスト注記の編集' : 'PDFテキスト注記の追加'}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-500 font-normal select-none">ドラッグ移動可</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTextInputPos(null);
                  setModalPos(null);
                  setEditingNoteId(null);
                }}
                className="text-slate-400 hover:text-white p-0.5 cursor-pointer rounded hover:bg-slate-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Text input */}
          <input
            type="text"
            autoFocus
            placeholder="注記テキストを入力 (例: MAWB番号, 要確認)"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTextNote();
              if (e.key === 'Escape') {
                setTextInputPos(null);
                setModalPos(null);
                setEditingNoteId(null);
              }
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
          />

          {/* Text Color */}
          <div className="space-y-1 shrink-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-slate-300 font-semibold">
                <Type className="w-3 h-3 text-blue-400" />
                <span>文字色:</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">{selectedTextColor}</span>
            </div>
            <div className="flex items-center space-x-1.5 bg-slate-800/70 p-1.5 rounded-xl border border-slate-700">
              {TEXT_COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setSelectedTextColor(c.value)}
                  className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                    selectedTextColor === c.value
                      ? 'scale-125 ring-2 ring-blue-400 border-white shadow-xs'
                      : 'border-slate-500 hover:scale-110'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
              <label className="w-5 h-5 rounded-full border border-dashed border-slate-400 hover:border-white flex items-center justify-center cursor-pointer overflow-hidden ml-auto" title="カスタム文字色">
                <input
                  type="color"
                  value={selectedTextColor.startsWith('#') ? selectedTextColor : '#ffffff'}
                  onChange={(e) => setSelectedTextColor(e.target.value)}
                  className="opacity-0 w-0 h-0 absolute"
                />
                <Palette className="w-3 h-3 text-slate-300" />
              </label>
            </div>
          </div>

          {/* Background Color */}
          <div className="space-y-1 shrink-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-slate-300 font-semibold">
                <Palette className="w-3 h-3 text-amber-400" />
                <span>背景色:</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedBgColor === 'transparent' ? '透明' : selectedBgColor}
              </span>
            </div>
            <div className="flex items-center space-x-1 bg-slate-800/70 p-1.5 rounded-xl border border-slate-700">
              {BG_COLOR_PRESETS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => setSelectedBgColor(b.value)}
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer flex items-center justify-center ${
                    selectedBgColor === b.value
                      ? 'ring-2 ring-blue-400 border-white scale-105 shadow-xs'
                      : 'border-slate-600 text-slate-300 hover:border-slate-400'
                  }`}
                  style={{
                    background: b.previewBg,
                    color: b.value === '#ffffff' || b.value.startsWith('#f') || b.value.startsWith('#d') ? '#0f172a' : '#ffffff',
                  }}
                  title={b.label}
                >
                  {b.label}
                </button>
              ))}
              <label className="p-1 rounded-lg border border-dashed border-slate-400 hover:border-white flex items-center justify-center cursor-pointer ml-auto" title="カスタム背景色">
                <input
                  type="color"
                  value={selectedBgColor.startsWith('#') ? selectedBgColor : '#0f172a'}
                  onChange={(e) => setSelectedBgColor(e.target.value)}
                  className="opacity-0 w-0 h-0 absolute"
                />
                <Palette className="w-3 h-3 text-slate-300" />
              </label>
            </div>
          </div>

          {/* Border Color */}
          <div className="space-y-1 shrink-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1 text-slate-300 font-semibold">
                <Square className="w-3 h-3 text-emerald-400" />
                <span>枠の色:</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedBorderColor === 'transparent' ? '枠線なし' : selectedBorderColor}
              </span>
            </div>
            <div className="flex items-center space-x-1 bg-slate-800/70 p-1.5 rounded-xl border border-slate-700">
              {BORDER_COLOR_PRESETS.map((bc) => (
                <button
                  key={bc.value}
                  type="button"
                  onClick={() => setSelectedBorderColor(bc.value)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border transition-all cursor-pointer ${
                    selectedBorderColor === bc.value
                      ? 'ring-2 ring-emerald-400 border-white scale-105 shadow-xs bg-slate-700 text-white'
                      : 'border-slate-600 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {bc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <div className="flex items-center justify-between text-[11px] pt-1 shrink-0">
            <span className="text-slate-400">文字サイズ:</span>
            <div className="flex items-center space-x-1">
              {FONT_SIZE_PRESETS.map((fs) => (
                <button
                  key={fs.value}
                  type="button"
                  onClick={() => setSelectedFontSize(fs.value)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold cursor-pointer ${
                    selectedFontSize === fs.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {fs.value}px
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview */}
          <div className="pt-1 shrink-0">
            <div className="text-[10px] text-slate-400 mb-1">プレビュー表示:</div>
            <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center justify-center">
              <div
                className="px-2 py-0.5 rounded-md text-xs font-bold transition-all shadow-xs border inline-block max-w-full truncate"
                style={{
                  backgroundColor: selectedBgColor === 'transparent' ? 'transparent' : selectedBgColor,
                  color: selectedTextColor,
                  borderColor: selectedBorderColor === 'transparent' ? 'transparent' : selectedBorderColor,
                  borderWidth: selectedBorderColor === 'transparent' ? '0px' : '1px',
                  borderStyle: selectedBgColor === 'transparent' && selectedBorderColor !== 'transparent' ? 'dashed' : 'solid',
                  fontSize: `${selectedFontSize}px`,
                }}
              >
                {inputText.trim() || '205-76628543'}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-1.5 pt-1.5 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => {
                setTextInputPos(null);
                setModalPos(null);
                setEditingNoteId(null);
              }}
              className="px-2.5 py-1 bg-slate-800 text-slate-300 hover:bg-slate-700 rounded-lg text-[10px] font-bold cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleAddTextNote}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-[10px] flex items-center gap-1 shadow-md shadow-blue-500/20 cursor-pointer"
            >
              <Check className="w-3 h-3" />
              <span>{editingNoteId ? '更新' : '保存'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
