import React, { useState, useEffect } from 'react';
import { BillingItem, BillingPresetPattern, Shipment } from '../types';
import {
  calculateBillingTotals,
  fetchBillingPresets,
  subscribeBillingPresets,
  getLocalPresets,
  saveBillingPresetPattern,
  deleteBillingPresetPattern,
  setDefaultBillingPreset,
  getDefaultBillingItems,
  updateShipmentBillingItems,
  DEFAULT_INITIAL_BILLING_ITEMS,
} from '../lib/billingService';
import { DetailCalculatorModal } from './DetailCalculatorModal';
import {
  Plus,
  Trash2,
  Save,
  Bookmark,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Info,
  Layers,
  Calculator,
  Star,
} from 'lucide-react';

interface BillingOverlayEditorProps {
  shipment: Shipment;
  onShipmentUpdated: (updated: Shipment) => void;
  onClose?: () => void;
}

export const BillingOverlayEditor: React.FC<BillingOverlayEditorProps> = ({
  shipment,
  onShipmentUpdated,
  onClose,
}) => {
  // Determine if this is the first time the billing overlay editor is shown for this shipment
  const isFirstTime = !shipment.billingInitialized && (!shipment.billingItems || shipment.billingItems.length === 0);

  // Initialize presets immediately from synchronous local storage so options are populated on frame 0
  const [presets, setPresets] = useState<BillingPresetPattern[]>(() => getLocalPresets());

  // Initialize billing items from shipment (if 2nd time or already set) or from default preset (if 1st time)
  const [items, setItems] = useState<BillingItem[]>(() => {
    if (shipment.billingItems && shipment.billingItems.length > 0) {
      return shipment.billingItems;
    }
    const initialList = getLocalPresets();
    const def = initialList.find((x) => x.isDefault) || initialList[0];
    if (def && Array.isArray(def.items) && def.items.length > 0) {
      return def.items.slice(0, 14).map((it, idx) => ({
        id: `item_${Date.now()}_${idx}`,
        taxable: it.taxable,
        name: it.name,
        amount: it.amount,
      }));
    }
    return getDefaultBillingItems();
  });

  // Initialize selectedPresetId synchronously
  // 1st time: set to default preset id
  // 2nd time+: match existing items to preset if identical, else '' (do not force default preset)
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => {
    const initialList = getLocalPresets();
    const def = initialList.find((x) => x.isDefault) || initialList[0];

    if (!shipment.billingInitialized && (!shipment.billingItems || shipment.billingItems.length === 0)) {
      return def ? def.id : '';
    }

    if (shipment.billingItems && shipment.billingItems.length > 0) {
      const matched = initialList.find((pattern) => {
        if (pattern.items.length !== shipment.billingItems!.length) return false;
        return pattern.items.every((it, idx) => {
          const shipIt = shipment.billingItems![idx];
          return shipIt && shipIt.name === it.name && shipIt.taxable === it.taxable;
        });
      });
      return matched ? matched.id : '';
    }

    return '';
  });

  const [newPresetName, setNewPresetName] = useState<string>('');
  const [setAsDefaultOnSave, setSetAsDefaultOnSave] = useState<boolean>(false);
  const [showSavePresetModal, setShowSavePresetModal] = useState<boolean>(false);
  const [isSavedSuccessfully, setIsSavedSuccessfully] = useState<boolean>(false);
  const [showCalcModal, setShowCalcModal] = useState<boolean>(false);
  const [presetToDelete, setPresetToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // 1st time initial setup: on first display, set items from default pattern in local state (no PDF reload/save triggered)
  useEffect(() => {
    if (!shipment.billingInitialized && (!shipment.billingItems || shipment.billingItems.length === 0)) {
      const initialList = getLocalPresets();
      const def = initialList.find((x) => x.isDefault) || initialList[0];
      if (def && Array.isArray(def.items) && def.items.length > 0) {
        const initialItems = def.items.slice(0, 14).map((it, idx) => ({
          id: `item_${Date.now()}_${idx}`,
          taxable: it.taxable,
          name: it.name,
          amount: it.amount,
        }));
        setSelectedPresetId(def.id);
        setItems(initialItems);
      }
    }
  }, [shipment.id]);

  // Subscribe to real-time presets updates from Firestore & Server
  useEffect(() => {
    const unsubscribe = subscribeBillingPresets((p) => {
      setPresets(p);

      // Only on 1st time (uninitialized and no billing items), initialize local state with default pattern
      if (!shipment.billingInitialized && (!shipment.billingItems || shipment.billingItems.length === 0)) {
        const defaultP = p.find((x) => x.isDefault) || p[0];
        if (defaultP) {
          setSelectedPresetId((prev) => prev || defaultP.id);
          setItems((prevItems) => {
            // Never overwrite items if user has already entered data or customized items
            const hasUserData = prevItems.some(it => it.amount !== '' && it.amount !== null && it.amount !== undefined);
            if (!hasUserData && (prevItems.length === 0 || prevItems === DEFAULT_INITIAL_BILLING_ITEMS)) {
              return defaultP.items.slice(0, 14).map((it, idx) => ({
                id: `item_${Date.now()}_${idx}`,
                taxable: it.taxable,
                name: it.name,
                amount: it.amount,
              }));
            }
            return prevItems;
          });
        }
      } else {
        // 2nd time onwards: DO NOT reset items! Only update matched preset ID
        const currentList = shipment.billingItems && shipment.billingItems.length > 0 ? shipment.billingItems : items;
        const matched = p.find((pattern) => {
          if (pattern.items.length !== currentList.length) return false;
          return pattern.items.every((it, idx) => {
            const shipIt = currentList[idx];
            return shipIt && shipIt.name === it.name && shipIt.taxable === it.taxable;
          });
        });
        if (matched) {
          setSelectedPresetId(matched.id);
        }
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setShowCalcModal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shipment.id]);

  // Update local items state and matching preset ID, syncing immediately to shipment state
  const updateLocalItems = (newItems: BillingItem[], newPresetId?: string) => {
    setItems(newItems);
    if (newPresetId !== undefined) {
      setSelectedPresetId(newPresetId);
    } else {
      const matched = presets.find((pattern) => {
        if (pattern.items.length !== newItems.length) return false;
        return pattern.items.every((it, idx) => {
          const shipIt = newItems[idx];
          return shipIt && shipIt.name === it.name && shipIt.taxable === it.taxable;
        });
      });
      setSelectedPresetId(matched ? matched.id : '');
    }

    // 画面で設定した明細情報を即座にストレージと上位コンポーネントに反映
    const updated = updateShipmentBillingItems(shipment.id, newItems, false);
    if (updated && onShipmentUpdated) {
      onShipmentUpdated(updated);
    }
  };

  // Apply calculated amounts from DetailCalculatorModal
  const handleApplyCalculatedAmounts = (calcResults: Record<string, number>) => {
    const updatedItems = [...items];

    const getKeywordsForCalcKey = (key: string): string[] => {
      if (key === '輸出通関料') return ['輸出通関料', '通関料'];
      if (key.includes('T/C') || key.toLowerCase().includes('t/c')) {
        return ['t/c @18', 't/c @15', 't/c', 'ターミナル'];
      }
      if (key === 'X線検査料') return ['x線検査料', 'x線検査料金', 'x線'];
      if (key === 'ラベル作成') return ['ラベル作成', 'ラベル作成料'];
      if (key === 'ラベル貼付') return ['ラベル貼付', 'ラベル貼付料'];
      return [key.toLowerCase()];
    };

    Object.entries(calcResults).forEach(([calcName, amount]) => {
      const keywords = getKeywordsForCalcKey(calcName);

      // 1. 完全一致またはキーワード一致の既存行を探す
      let foundIndex = updatedItems.findIndex((it) => {
        const nameLower = it.name.trim().toLowerCase();
        if (!nameLower) return false;
        if (nameLower === calcName.trim().toLowerCase()) return true;
        return keywords.some((kw) => nameLower.includes(kw));
      });

      if (foundIndex !== -1) {
        // 同じ文字が存在すればその項目の金額欄に反映 (T/C @18 / T/C @15 の場合は単価表示も更新)
        const currentName = updatedItems[foundIndex].name;
        const newName =
          currentName.startsWith('T/C @') || currentName === 'T/C @18' || currentName === 'T/C @15'
            ? calcName
            : currentName;

        updatedItems[foundIndex] = {
          ...updatedItems[foundIndex],
          name: newName,
          amount: amount,
        };
      } else {
        // 同じ文字が存在しなければ、空欄行があれば埋めるか、末尾に新規追加
        const emptyIndex = updatedItems.findIndex((it) => !it.name.trim());
        if (emptyIndex !== -1) {
          updatedItems[emptyIndex] = {
            ...updatedItems[emptyIndex],
            name: calcName,
            amount: amount,
          };
        } else if (updatedItems.length < 14) {
          updatedItems.push({
            id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            taxable: true,
            name: calcName,
            amount: amount,
          });
        }
      }
    });

    updateLocalItems(updatedItems);
  };

  // Calculate totals
  const calcResult = calculateBillingTotals(items);

  // Add Row (Max 14)
  const handleAddRow = () => {
    if (items.length >= 14) {
      alert('請求明細行は最大14行までです。');
      return;
    }
    const newItem: BillingItem = {
      id: `item_${Date.now()}_${items.length}`,
      taxable: true,
      name: '',
      amount: '', // 未入力（空欄）
    };
    const updated = [...items, newItem];
    updateLocalItems(updated);
  };

  // Delete Row
  const handleDeleteRow = (index: number) => {
    if (items.length <= 1) {
      if (!confirm('全ての明細行を削除しますか？')) return;
    }
    const updated = items.filter((_, idx) => idx !== index);
    updateLocalItems(updated);
  };

  // Update Item Field
  const handleItemChange = (index: number, field: keyof BillingItem, value: any) => {
    const updated = [...items];
    const target = { ...updated[index] };

    if (field === 'taxable') {
      target.taxable = Boolean(value);
    } else if (field === 'name') {
      target.name = String(value).slice(0, 20); // 20文字まで
    } else if (field === 'amount') {
      if (value === '' || value === null || value === undefined) {
        target.amount = '';
      } else {
        const numVal = Number(value);
        target.amount = isNaN(numVal) ? '' : numVal;
      }
    }

    updated[index] = target;
    updateLocalItems(updated);
  };

  // Select Preset Pattern & Apply (Explicit user action)
  const handleApplyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) return;

    const found = presets.find((p) => p.id === presetId);
    if (found) {
      const newItems: BillingItem[] = found.items.slice(0, 14).map((it, idx) => ({
        id: `item_${Date.now()}_${idx}`,
        taxable: it.taxable,
        name: it.name,
        amount: it.amount,
      }));
      updateLocalItems(newItems, presetId);
    }
  };

  // Set Pattern as Active Default for New Tasks
  const handleSetAsDefault = async (presetId: string) => {
    if (!presetId) return;
    const updated = await setDefaultBillingPreset(presetId);
    setPresets(updated);
    const target = updated.find((p) => p.id === presetId);
    if (target) {
      alert(`「${target.name}」を新規登録タスク時の初期デフォルトパターンに設定しました。`);
    }
  };

  // Save Current Items as Pattern Preset (Max 10)
  const handleSaveAsPreset = async () => {
    if (!newPresetName.trim()) {
      alert('パターン名称を入力してください。');
      return;
    }

    if (presets.length >= 10 && !presets.some((p) => p.name === newPresetName.trim())) {
      alert('保存できるプリセットパターンは最大10パターンまでです。不要なパターンを削除してからお試しください。');
      return;
    }

    const updatedPresets = await saveBillingPresetPattern(newPresetName, items, setAsDefaultOnSave);
    setPresets(updatedPresets);
    const savedPreset = updatedPresets.find((p) => p.name === newPresetName.trim());
    if (savedPreset) {
      setSelectedPresetId(savedPreset.id);
    }
    setNewPresetName('');
    setSetAsDefaultOnSave(false);
    setShowSavePresetModal(false);
    alert(`パターン「${newPresetName.trim()}」を保存しました。(最大10パターン中 ${updatedPresets.length}件)${setAsDefaultOnSave ? ' 【初期デフォルト設定済み】' : ''}`);
  };

  // Delete Pattern Preset (Modal Trigger)
  const handleOpenDeleteModal = (presetId: string, name: string) => {
    setPresetToDelete({ id: presetId, name });
  };

  // Confirm Delete Pattern Preset
  const handleConfirmDeletePreset = async () => {
    if (!presetToDelete) return;
    setIsDeleting(true);
    try {
      const updated = await deleteBillingPresetPattern(presetToDelete.id);
      setPresets(updated);
      if (selectedPresetId === presetToDelete.id) {
        setSelectedPresetId('');
      }
      setPresetToDelete(null);
    } catch (err) {
      console.error('Failed to delete preset:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Save to Shipment (Explicit User Action with Confirmation & Activity Log)
  const handleSaveToShipment = () => {
    setIsSaving(true);
    const updatedShipment = updateShipmentBillingItems(shipment.id, items, true);
    if (updatedShipment) {
      onShipmentUpdated(updatedShipment);
      setIsSavedSuccessfully(true);
      setTimeout(() => {
        setIsSaving(false);
        setTimeout(() => setIsSavedSuccessfully(false), 2000);
      }, 150);
    } else {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white space-y-5 shadow-2xl">
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600/30 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              請求明細・オーバーレイ編集
              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-mono border border-blue-500/30">
                枠線なし印字
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              PDFプレビュー上に「枠線なし」で請求項目・金額を直接オーバーレイ描画します（最大14行）。
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShowCalcModal(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600/90 hover:bg-indigo-500 text-white flex items-center space-x-1 transition-all shadow-md cursor-pointer border border-indigo-400/30"
            title="明細項目（通関料、T/C、X線料金等）の自動計算ツールを開きます (ショートカット: F12)"
          >
            <Calculator className="w-3.5 h-3.5 mr-1" />
            <span>明細計算 (F12)</span>
          </button>

          <button
            type="button"
            onClick={handleSaveToShipment}
            disabled={isSaving}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md cursor-pointer ${
              isSavedSuccessfully
                ? 'bg-emerald-600 text-white'
                : isSaving
                ? 'bg-blue-700 text-white opacity-80'
                : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
            }`}
          >
            {isSavedSuccessfully ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>反映完了！</span>
              </>
            ) : isSaving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                <span>反映中...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>PDFへ反映</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Pattern Preset Selector (最大10パターン) */}
      <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Bookmark className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200">パターン登録・呼び出し (最大10パターン)</span>
            <span className="text-[10px] text-slate-400 font-mono">({presets.length}/10 登録中)</span>
          </div>

          <button
            type="button"
            onClick={() => setShowSavePresetModal(true)}
            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[11px] font-bold border border-amber-500/40 flex items-center space-x-1 cursor-pointer transition-colors"
          >
            <Sparkles className="w-3 h-3 mr-1" />
            <span>現在の明細をパターン保存</span>
          </button>
        </div>

        <div className="space-y-2">
          <select
            id="billing-preset-pattern-select"
            value={selectedPresetId}
            onChange={(e) => handleApplyPreset(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">-- パターンを選択して一括展開 --</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.isDefault ? '★ ' : ''}{p.name} ({p.items.length}項目)
              </option>
            ))}
          </select>

          {selectedPresetId && (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center space-x-2">
                {presets.find((p) => p.id === selectedPresetId)?.isDefault ? (
                  <span
                    className="px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-lg text-xs font-bold border border-amber-500/40 flex items-center space-x-1.5"
                    title="現在、新規タスク登録時の初期デフォルトパターンに設定されています"
                  >
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span>初期デフォルト設定中</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetAsDefault(selectedPresetId)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 rounded-lg text-xs font-bold border border-slate-700 hover:border-amber-500/40 flex items-center space-x-1.5 cursor-pointer transition-all"
                    title="このパターンを新規タスク登録時の初期デフォルトパターンに設定します"
                  >
                    <Star className="w-3.5 h-3.5 text-amber-400" />
                    <span>初期デフォルトに設定</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                id="btn-delete-billing-preset"
                onClick={() => {
                  const p = presets.find((x) => x.id === selectedPresetId);
                  if (p) handleOpenDeleteModal(p.id, p.name);
                }}
                className="px-2.5 py-1 bg-rose-500/15 text-rose-300 hover:bg-rose-500/30 hover:text-white rounded-lg text-xs font-bold border border-rose-500/30 flex items-center space-x-1 cursor-pointer transition-all active:scale-95"
                title="選択中のパターンを削除"
              >
                <Trash2 className="w-3.5 h-3.5 mr-0.5" />
                <span>パターン削除</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail Input Table (Up to 14 rows) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1">
          <span>明細項目リスト ({items.length}/14 行)</span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setShowCalcModal(true)}
              className="px-2.5 py-1 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 rounded-lg text-[11px] font-bold border border-indigo-700/80 flex items-center space-x-1 cursor-pointer transition-all"
              title="通関料・T/C・X線等の自動計算ポップアップを開く (F12)"
            >
              <Calculator className="w-3.5 h-3.5 mr-0.5" />
              <span>明細計算 (F12)</span>
            </button>
            <button
              type="button"
              onClick={handleAddRow}
              disabled={items.length >= 14}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 rounded-lg text-[11px] font-bold border border-slate-700 flex items-center space-x-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>行を追加 (最大14行)</span>
            </button>
          </div>
        </div>

        <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div
              key={item.id || idx}
              className="flex items-center space-x-1.5 bg-slate-800/60 py-1 px-2 rounded-lg border border-slate-700/60 hover:border-slate-600 transition-colors"
            >
              <span className="text-[10px] font-mono text-slate-400 w-4 text-center shrink-0">
                {idx + 1}
              </span>

              {/* Taxable Flag Checkbox */}
              <label
                className="flex items-center space-x-1 px-1.5 py-0.5 bg-slate-900/80 rounded border border-slate-700 shrink-0 cursor-pointer hover:bg-slate-900"
                title="チェックON時: 印字時に「T」を出力 (課税対象)"
              >
                <input
                  type="checkbox"
                  checked={item.taxable}
                  onChange={(e) => handleItemChange(idx, 'taxable', e.target.checked)}
                  className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer w-3 h-3"
                />
                <span className={`text-[10px] font-bold ${item.taxable ? 'text-amber-400' : 'text-slate-400'}`}>
                  {item.taxable ? 'T (課税)' : '非課税'}
                </span>
              </label>

              {/* Item Name (Max 20 chars) */}
              <input
                type="text"
                maxLength={20}
                placeholder="請求項目名 (20文字以内)"
                value={item.name}
                onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                style={{ width: '40%', maxWidth: '40%' }}
                className="shrink-0 bg-slate-900 border border-slate-700 rounded-md px-2 py-0.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />

              {/* Amount (Number or empty) - ￥マークは表示しない */}
              <div className="relative w-28 shrink-0">
                <input
                  type="number"
                  placeholder="未入力(空欄)"
                  value={item.amount === '' || item.amount === null || item.amount === undefined ? '' : item.amount}
                  onChange={(e) => handleItemChange(idx, 'amount', e.target.value)}
                  className={`w-full px-2 py-0.5 bg-slate-900 border rounded-md text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    item.amount === '' || item.amount === null
                      ? 'border-amber-500/50 text-amber-300 placeholder-amber-500/60'
                      : 'border-slate-700 text-slate-100'
                  }`}
                />
              </div>

              {/* Delete Button */}
              <button
                type="button"
                onClick={() => handleDeleteRow(idx)}
                className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-700/60 rounded transition-colors cursor-pointer"
                title="この行を削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* TAX & TTL Auto Calculation Display Box */}
      <div
        className={`p-3.5 rounded-xl border text-xs space-y-2 transition-all ${
          calcResult.isCalculated
            ? 'bg-slate-800/90 border-slate-700'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-bold flex items-center gap-1.5">
            <Info className="w-4 h-4 text-blue-400" />
            TAX (消費税) & TTL (合計) 計算状態:
          </span>

          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              calcResult.isCalculated
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            }`}
          >
            {calcResult.isCalculated ? '全金額入力済み (自動計算完了)' : '未入力項目あり (手書き用空欄)'}
          </span>
        </div>

        {calcResult.isCalculated ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-xs">
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-700">
              <div className="text-[10px] text-slate-400">課税対象小計:</div>
              <div className="font-bold text-slate-200">
                ¥{(calcResult.taxableSubtotal || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-700">
              <div className="text-[10px] text-slate-400">税抜合計:</div>
              <div className="font-bold text-slate-200">
                ¥{(calcResult.totalSubtotal || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-lg border border-amber-500/40">
              <div className="text-[10px] text-amber-400 font-bold">TAX (10%):</div>
              <div className="font-bold text-amber-300 text-sm">
                ¥{(calcResult.tax || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-blue-950/80 p-2 rounded-lg border border-blue-500/40">
              <div className="text-[10px] text-blue-300 font-bold">TTL (総合計):</div>
              <div className="font-bold text-blue-200 text-sm">
                ¥{(calcResult.ttl || 0).toLocaleString()}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1 pt-1 text-[11px] text-amber-200/90 leading-relaxed">
            <div className="flex items-start space-x-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                金額が未入力（空欄）の明細項目があるため、TAXおよびTTLの自動計算を停止し、印字欄を「手書き用スペース（空欄）」として表示します。
              </span>
            </div>
            <div className="pl-5 text-[10px] text-slate-400">
              ※翌日確定費用等に対応します。「0円」を入力した場合は入力済みとして計算されます。
            </div>
          </div>
        )}
      </div>

      {/* Modal for saving new pattern preset */}
      {showSavePresetModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <h4 className="text-sm font-bold text-white flex items-center">
              <Bookmark className="w-4 h-4 mr-2 text-amber-400" />
              現在の明細をパターン（プリセット）保存
            </h4>
            <p className="text-xs text-slate-300">
              よく使う請求項目の組み合せを保存します。全画面プレビューでいつでも一括呼び出しが可能です（最大10パターン）。
            </p>

            <input
              type="text"
              maxLength={20}
              placeholder="パターン名称 (例: 通関・X線標準パック)"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <label className="flex items-center space-x-2 text-xs text-amber-300 font-medium cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={setAsDefaultOnSave}
                onChange={(e) => setSetAsDefaultOnSave(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-400 w-3.5 h-3.5 cursor-pointer"
              />
              <span>このパターンを新規登録時のデフォルト初期パターンに設定する</span>
            </label>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSavePresetModal(false);
                  setSetAsDefaultOnSave(false);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveAsPreset}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal for confirming pattern deletion */}
      {presetToDelete && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div
            id="modal-confirm-delete-preset"
            className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-md w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white">
                  パターン削除の確認
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  パターン「<strong className="text-rose-300 font-bold">{presetToDelete.name}</strong>」を削除してもよろしいですか？
                </p>
                <p className="text-[11px] text-slate-400">
                  ※この操作は取り消せません。削除後はパターン一覧から完全に除外されます。
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                id="btn-cancel-delete-preset"
                disabled={isDeleting}
                onClick={() => setPresetToDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-50"
              >
                いいえ (キャンセル)
              </button>
              <button
                type="button"
                id="btn-confirm-delete-preset"
                disabled={isDeleting}
                onClick={handleConfirmDeletePreset}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center space-x-1.5 shadow-lg shadow-rose-950/50 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? '削除中...' : 'はい (削除する)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draggable Detail Calculator Modal */}
      <DetailCalculatorModal
        isOpen={showCalcModal}
        onClose={() => setShowCalcModal(false)}
        shipment={shipment}
        onApplyAmounts={handleApplyCalculatedAmounts}
      />
    </div>
  );
};
