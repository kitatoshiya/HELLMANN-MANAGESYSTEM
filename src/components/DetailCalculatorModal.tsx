import React, { useState, useEffect, useRef } from 'react';
import { Shipment } from '../types';
import { Calculator, X, GripHorizontal, Check, RefreshCw } from 'lucide-react';

interface DetailCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipment?: Shipment;
  onApplyAmounts: (calcResults: Record<string, number>) => void;
}

// 1. 通関料: 3欄以下は3000円。4欄以上は5欄ごとに3000円加算
export function calcCustomsFee(ran: number): number {
  if (ran <= 0) return 0;
  if (ran <= 3) return 3000;
  return 3000 + Math.floor((ran - 4) / 5 + 1) * 3000;
}

// 2. T/C: 重量1,000kg未満は18円(最低600円)、1,000kg以上は15円
export function calcTerminalCharge(weight: number): number {
  if (weight <= 0) return 0;
  const rate = weight < 1000 ? 18 : 15;
  const raw = Math.ceil(weight * rate);
  return Math.max(600, raw);
}

// 3. X線検査料金: 個数5個までは3500円。6個以上は1個ごとに350円加算
export function calcXRayFee(pieces: number): number {
  if (pieces <= 0) return 0;
  if (pieces <= 5) return 3500;
  return 3500 + (pieces - 5) * 350;
}

// 4. ラベル作成: 個数×20円
export function calcLabelCreateFee(pieces: number): number {
  if (pieces <= 0) return 0;
  return pieces * 20;
}

// 5. ラベル貼付: 個数×20円。最低料金500円
export function calcLabelAttachFee(pieces: number): number {
  if (pieces <= 0) return 0;
  return Math.max(500, pieces * 20);
}

// 数値または数値形式の文字列から数字のみをパースするヘルパー関数
const extractNumeric = (numVal?: number, strVal?: string): number => {
  if (typeof numVal === 'number' && numVal > 0) return numVal;
  if (strVal) {
    const match = strVal.toString().replace(/,/g, '').match(/[\d.]+/);
    if (match) {
      const parsed = parseFloat(match[0]);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
};

export const DetailCalculatorModal: React.FC<DetailCalculatorModalProps> = ({
  isOpen,
  onClose,
  shipment,
  onApplyAmounts,
}) => {
  // 入力パラメータ状態
  const [ranCount, setRanCount] = useState<number>(1);
  const [pieces, setPieces] = useState<number>(() =>
    shipment ? extractNumeric((shipment as any).pkgCount, shipment.pieces) : 0
  );
  const [weight, setWeight] = useState<number>(() =>
    shipment ? extractNumeric((shipment as any).weight, shipment.grossWeight) : 0
  );

  const ranInputRef = useRef<HTMLInputElement>(null);

  // 初回表示時 / shipment変更時 / 開いた時に該当タスク（案件）の最新個数・重量を初期表示＆欄数へフォーカス
  useEffect(() => {
    if (isOpen) {
      if (shipment) {
        setWeight(extractNumeric((shipment as any).weight, shipment.grossWeight));
        setPieces(extractNumeric((shipment as any).pkgCount, shipment.pieces));
      }
      setTimeout(() => {
        if (ranInputRef.current) {
          ranInputRef.current.focus();
          ranInputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, shipment]);

  // モーダルの表示位置（x, y）
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('billing_calc_modal_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    const defaultX = typeof window !== 'undefined' ? Math.max(20, Math.floor((window.innerWidth - 460) / 2)) : 100;
    return { x: defaultX, y: 120 };
  });

  // ドラッグ操作の状態
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number }>({
    mouseX: 0,
    mouseY: 0,
    posX: 0,
    posY: 0,
  });

  // 位置の永続保存 helper
  const savePosition = (pos: { x: number; y: number }) => {
    try {
      localStorage.setItem('billing_calc_modal_pos', JSON.stringify(pos));
    } catch {
      // ignore
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;

      const newX = Math.max(10, Math.min(window.innerWidth - 400, dragStartRef.current.posX + dx));
      const newY = Math.max(10, Math.min(window.innerHeight - 200, dragStartRef.current.posY + dy));

      const newPos = { x: newX, y: newY };
      setPosition(newPos);
      savePosition(newPos);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!isOpen) return null;

  // 各金額のリアルタイム計算
  const customsFee = calcCustomsFee(ranCount);
  const terminalCharge = calcTerminalCharge(weight);
  const xRayFee = calcXRayFee(pieces);
  const labelCreateFee = calcLabelCreateFee(pieces);
  const labelAttachFee = calcLabelAttachFee(pieces);

  const tcRate = weight < 1000 ? 18 : 15;
  const tcName = `T/C @${tcRate}`;

  const calculatedItems = [
    {
      name: '輸出通関料',
      amount: customsFee,
      rule: `欄数 ${ranCount}欄 (3欄以下:3,000円, 4欄以上:5欄毎+3,000円)`,
    },
    {
      name: tcName,
      amount: terminalCharge,
      rule:
        weight < 1000
          ? `重量 ${weight}kg × 18円 (1,000kg未満 / 最低:600円)`
          : `重量 ${weight}kg × 15円 (1,000kg以上)`,
    },
    {
      name: 'X線検査料',
      amount: xRayFee,
      rule: `個数 ${pieces}個 (5個まで:3,500円, 6個以上:+350円/個)`,
    },
    {
      name: 'ラベル作成',
      amount: labelCreateFee,
      rule: `個数 ${pieces}個 × 20円`,
    },
    {
      name: 'ラベル貼付',
      amount: labelAttachFee,
      rule: `個数 ${pieces}個 × 20円 (最低:500円)`,
    },
  ];

  const handleApply = () => {
    const results: Record<string, number> = {
      '輸出通関料': customsFee,
      [tcName]: terminalCharge,
      'X線検査料': xRayFee,
      'ラベル作成': labelCreateFee,
      'ラベル貼付': labelAttachFee,
    };
    onApplyAmounts(results);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        style={{
          position: 'absolute',
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
        className="pointer-events-auto w-[460px] max-w-[95vw] bg-slate-900 border-2 border-indigo-500/60 rounded-2xl shadow-2xl overflow-hidden text-white animate-fadeIn"
      >
        {/* Draggable Header */}
        <div
          onMouseDown={handleMouseDown}
          className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-3 px-4 border-b border-slate-700/80 flex items-center justify-between cursor-move select-none"
          title="ドラッグして画面上の任意の場所に移動できます"
        >
          <div className="flex items-center space-x-2">
            <GripHorizontal className="w-4 h-4 text-indigo-400 shrink-0" />
            <Calculator className="w-4 h-4 text-indigo-300" />
            <span className="font-bold text-sm text-slate-100">明細計算 (自動計算)</span>
            <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full font-mono font-bold border border-indigo-400/30">
              F12
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input Controls */}
        <div className="p-4 space-y-3 text-xs bg-slate-900/95">
          {shipment && (
            <div className="flex items-center justify-between text-[11px] text-slate-300 bg-slate-800/90 px-3 py-1.5 rounded-xl border border-slate-700/80">
              <div className="flex items-center space-x-2 truncate">
                <span className="text-slate-400 font-medium">初期値(タスク情報):</span>
                <span className="font-mono text-indigo-300 font-bold">
                  個数 {extractNumeric((shipment as any).pkgCount, shipment.pieces)}個
                </span>
                <span className="text-slate-600">/</span>
                <span className="font-mono text-indigo-300 font-bold">
                  重量 {extractNumeric((shipment as any).weight, shipment.grossWeight)}kg
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setWeight(extractNumeric((shipment as any).weight, shipment.grossWeight));
                  setPieces(extractNumeric((shipment as any).pkgCount, shipment.pieces));
                }}
                className="ml-2 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold flex items-center shrink-0 cursor-pointer hover:underline"
                title="案件タスクの初期値で再セット"
              >
                <RefreshCw className="w-3 h-3 mr-0.5" />
                <span>初期値再セット</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5 bg-slate-800/80 p-3 rounded-xl border border-slate-700/80">
            {/* 欄数 (自動フォーカス) */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">欄数</label>
              <div className="relative">
                <input
                  ref={ranInputRef}
                  type="number"
                  min={0}
                  value={ranCount}
                  onChange={(e) => setRanCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-right text-xs font-mono font-bold text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="absolute right-2 top-1.2 text-[10px] text-slate-400 pointer-events-none">欄</span>
              </div>
            </div>

            {/* 個数 (Pieces) */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">個数 (Pieces)</label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  value={pieces}
                  onChange={(e) => setPieces(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-right text-xs font-mono font-bold text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="absolute right-2 top-1.2 text-[10px] text-slate-400 pointer-events-none">個</span>
              </div>
            </div>

            {/* 重量 (Weight) */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">重量 (Weight)</label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={weight}
                  onChange={(e) => setWeight(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-right text-xs font-mono font-bold text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="absolute right-2 top-1.2 text-[10px] text-slate-400 pointer-events-none">kg</span>
              </div>
            </div>
          </div>

          {/* Calculated Results Table */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-300 px-1 flex items-center justify-between">
              <span>自動計算結果一覧</span>
              <span className="text-[10px] text-slate-400 font-normal">※「反映」で明細項目リストへ適用</span>
            </div>

            <div className="border border-slate-700/80 rounded-xl overflow-hidden divide-y divide-slate-800 bg-slate-900/90">
              {calculatedItems.map((item) => (
                <div key={item.name} className="p-2.5 flex items-center justify-between hover:bg-slate-800/40 transition-colors">
                  <div className="space-y-0.5">
                    <div className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                      <span>{item.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{item.rule}</div>
                  </div>

                  <div className="text-right">
                    <span className="font-mono font-bold text-sm text-emerald-400">
                      {item.amount.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Footer Buttons */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-800 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs transition-colors cursor-pointer border border-slate-700"
            >
              閉じる
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-xl font-bold text-xs flex items-center space-x-1.5 shadow-md hover:shadow-indigo-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>反映</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
