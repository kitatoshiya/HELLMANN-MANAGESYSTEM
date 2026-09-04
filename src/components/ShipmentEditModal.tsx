import React, { useState, useEffect } from 'react';
import { Shipment, Operator } from '../types';
import { updateShipmentFields } from '../lib/storageManager';
import { fetchAllOperators } from '../lib/operatorService';
import {
  X,
  Edit3,
  Save,
  Plane,
  Calendar,
  UserCheck,
  Package,
  Scale,
  FileText,
  User as UserIcon,
  Building2,
  CheckCircle2,
  Clock,
  Flag,
} from 'lucide-react';

interface ShipmentEditModalProps {
  shipment: Shipment;
  isOpen: boolean;
  onClose: () => void;
  onShipmentUpdated: (updated: Shipment) => void;
}

export const ShipmentEditModal: React.FC<ShipmentEditModalProps> = ({
  shipment,
  isOpen,
  onClose,
  onShipmentUpdated,
}) => {
  const [mawbNumber, setMawbNumber] = useState(shipment.mawbNumber || '');
  const [hawbNumber, setHawbNumber] = useState(shipment.hawbNumber || '');
  const [pieces, setPieces] = useState(shipment.pieces || '');
  const [grossWeight, setGrossWeight] = useState(shipment.grossWeight || '');
  const [shipper, setShipper] = useState(shipment.shipper || '');
  const [consignee, setConsignee] = useState(shipment.consignee || '');
  const [portOfLoading, setPortOfLoading] = useState(shipment.portOfLoading || '');
  const [destination, setDestination] = useState(shipment.destination || '');
  const [flag, setFlag] = useState(shipment.flag || '');
  const [flightRoute, setFlightRoute] = useState(shipment.flightRoute || '');
  const [cutTime, setCutTime] = useState(shipment.cutTime || '');
  const [customsClearanceDate, setCustomsClearanceDate] = useState(shipment.customsClearanceDate || '');

  const [operators, setOperators] = useState<Operator[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>(
    shipment.assignedOperator ? shipment.assignedOperator.id || shipment.assignedOperator.email : ''
  );
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMawbNumber(shipment.mawbNumber || '');
      setHawbNumber(shipment.hawbNumber || '');
      setPieces(shipment.pieces || '');
      setGrossWeight(shipment.grossWeight || '');
      setShipper(shipment.shipper || '');
      setConsignee(shipment.consignee || '');
      setPortOfLoading(shipment.portOfLoading || '');
      setDestination(shipment.destination || '');
      setFlag(shipment.flag || '');
      setFlightRoute(shipment.flightRoute || '');
      setCutTime(shipment.cutTime || '');
      setCustomsClearanceDate(shipment.customsClearanceDate || '');
      setSelectedOperatorId(
        shipment.assignedOperator ? shipment.assignedOperator.id || shipment.assignedOperator.email : ''
      );

      fetchAllOperators().then((ops) => {
        if (ops && ops.length > 0) {
          setOperators(ops);
        }
      });
    }
  }, [isOpen, shipment]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!mawbNumber.trim()) {
      alert('MAWB番号は必須項目です。');
      return;
    }

    // Find selected operator
    let assignedOp: Operator | null = null;
    if (selectedOperatorId) {
      const foundOp = operators.find((op) => op.id === selectedOperatorId || op.email === selectedOperatorId);
      if (foundOp) {
        assignedOp = foundOp;
      }
    }

    const updated = updateShipmentFields(shipment.id, {
      mawbNumber: mawbNumber.trim(),
      hawbNumber: hawbNumber.trim() ? hawbNumber.trim() : null,
      pieces: pieces.trim() ? pieces.trim() : null,
      grossWeight: grossWeight.trim() ? grossWeight.trim() : null,
      shipper: shipper.trim(),
      consignee: consignee.trim(),
      portOfLoading: portOfLoading.trim() ? portOfLoading.trim() : null,
      destination: destination.trim() ? destination.trim() : null,
      flag: flag.trim() ? flag.trim() : null,
      flightRoute: flightRoute.trim(),
      cutTime: cutTime.trim() ? cutTime.trim() : null,
      customsClearanceDate: customsClearanceDate.trim(),
      assignedOperator: assignedOp,
    });

    if (updated) {
      onShipmentUpdated(updated);
      setIsSaved(true);
      setTimeout(() => {
        setIsSaved(false);
        onClose();
      }, 700);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full text-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/90">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-2xl bg-blue-600/30 text-blue-400 border border-blue-500/40 flex items-center justify-center">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                案件基本情報の編集・更新
                <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-md border border-blue-500/30">
                  ID: {shipment.id}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                MAWB/HAWB番号、荷主、フライト、通関予定日、担当者等の登録データを変更します。
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* 1. MAWB & HAWB番号 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-800/60 p-4 rounded-2xl border border-slate-700/80">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>MAWB番号 <span className="text-rose-400">*</span></span>
              </label>
              <input
                type="text"
                required
                placeholder="例: 131-88492014"
                value={mawbNumber}
                onChange={(e) => setMawbNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span>HAWB番号 (混載ハウス)</span>
              </label>
              <input
                type="text"
                placeholder="例: HWB-882049 (直載時は空欄)"
                value={hawbNumber}
                onChange={(e) => setHawbNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 2. 個数 & 重量 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-800/60 p-4 rounded-2xl border border-slate-700/80">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-blue-400" />
                <span>個数 (Pieces)</span>
              </label>
              <input
                type="text"
                placeholder="例: 12 CTNS"
                value={pieces}
                onChange={(e) => setPieces(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-amber-400" />
                <span>重量 (Gross Weight)</span>
              </label>
              <input
                type="text"
                placeholder="例: 480.0 KGS"
                value={grossWeight}
                onChange={(e) => setGrossWeight(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 3. SHIPPER & CONSIGNEE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-800/60 p-4 rounded-2xl border border-slate-700/80">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                <span>SHIPPER (輸出荷主)</span>
              </label>
              <input
                type="text"
                placeholder="例: TOKYO PRECISION TECH CO., LTD."
                value={shipper}
                onChange={(e) => setShipper(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>CONSIGNEE (輸入荷受人)</span>
              </label>
              <input
                type="text"
                placeholder="例: GLOBAL LOGISTICS GERMANY GMBH"
                value={consignee}
                onChange={(e) => setConsignee(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 3.5 積地 & 向地(DEST) & FLAG (船籍) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-800/60 p-4 rounded-2xl border border-slate-700/80">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-blue-400" />
                <span>積地 (Port of Loading)</span>
              </label>
              <input
                type="text"
                placeholder="例: NRT (成田) / KIX (関空)"
                value={portOfLoading}
                onChange={(e) => setPortOfLoading(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-indigo-400 rotate-45" />
                <span>向地(DEST)</span>
              </label>
              <input
                type="text"
                placeholder="例: LAX (ロサンゼルス) / FRA"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5 text-emerald-400" />
                <span>FLAG (船籍)</span>
              </label>
              <input
                type="text"
                placeholder="例: JP / PA / LR"
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 4. フライト, カット時間, 通関予定日, 担当者 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-800/60 p-4 rounded-2xl border border-slate-700/80">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-blue-400" />
                <span>フライト名/便名</span>
              </label>
              <input
                type="text"
                placeholder="例: NH203 / NRT-FRA"
                value={flightRoute}
                onChange={(e) => setFlightRoute(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-rose-400" />
                <span>カット時間</span>
              </label>
              <input
                type="text"
                placeholder="例: 17:00 (空白で指定なし)"
                value={cutTime}
                onChange={(e) => setCutTime(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>通関予定日</span>
              </label>
              <input
                type="text"
                placeholder="YYYY-MM-DD または YYYY/MM/DD"
                value={customsClearanceDate}
                onChange={(e) => setCustomsClearanceDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>担当者 (通関担当)</span>
              </label>
              <select
                value={selectedOperatorId}
                onChange={(e) => setSelectedOperatorId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">-- 担当者未割り当て --</option>
                {operators.map((op) => (
                  <option key={op.id || op.email} value={op.id || op.email}>
                    {op.name} ({op.department || '通関部'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer controls */}
          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className={`px-5 py-2 rounded-xl font-bold flex items-center space-x-2 shadow-lg transition-all cursor-pointer ${
                isSaved
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white active:scale-95'
              }`}
            >
              {isSaved ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>保存完了！</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>更新内容を保存</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
