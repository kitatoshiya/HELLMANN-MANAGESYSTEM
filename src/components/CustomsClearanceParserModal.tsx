import React, { useState, useRef } from 'react';
import { Shipment } from '../types';
import { updateShipmentMilestones } from '../lib/storageManager';
import { motion, AnimatePresence } from 'motion/react';
import { X, UploadCloud, Search, FileText, Download, CheckSquare, Square, FileSearch, Trash2 } from 'lucide-react';

interface ParsedFile {
  id: string;
  originalFile: File;
  baseAwb: string;
  suffix: string;
  shipment: Shipment;
  selected: boolean;
}

interface CustomsClearanceParserModalProps {
  initialDate: string; // yyyy-MM-dd
  shipments: Shipment[];
  onClose: () => void;
}

export const CustomsClearanceParserModal: React.FC<CustomsClearanceParserModalProps> = ({
  initialDate,
  shipments,
  onClose,
}) => {
  const [targetDate, setTargetDate] = useState(initialDate);
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFilename = (filename: string): { baseAwb: string, suffix: string } | null => {
    // 例：「42365587560 S2601963908_20260821135854.pdf」
    // または「42365489930 32404860424-01_20260820160429.pdf」
    // ファイル名の頭から13個目から”_”直前
    if (filename.length < 13 || !filename.includes('_')) {
      return null;
    }
    const startIndex = 12; // 13番目の文字
    const endIndex = filename.indexOf('_', startIndex);
    
    if (endIndex === -1) return null;

    const extracted = filename.substring(startIndex, endIndex).trim();
    const match = extracted.match(/^(.*?)(?:-(\d{2}))?$/);
    if (match) {
      return {
        baseAwb: match[1],
        suffix: match[2] || '',
      };
    }
    return { baseAwb: extracted, suffix: '' };
  };

  const targetShipments = shipments.filter(s => 
    s.customsClearanceDate && 
    s.customsClearanceDate.replace(/\//g, '-').trim() === targetDate
  );

  const processFiles = (files: FileList | File[]) => {
    const newParsedFiles: ParsedFile[] = [];

    Array.from(files).forEach(file => {
      const parsedInfo = parseFilename(file.name);
      if (parsedInfo) {
        const { baseAwb, suffix } = parsedInfo;
        const cleanExtractedAwb = baseAwb.replace(/-/g, '');
        // 抽出した番号がMAWBまたはHAWBと一致する案件を検索
        const matchedShipment = targetShipments.find(s => {
          const cleanMawb = s.mawbNumber ? s.mawbNumber.replace(/-/g, '') : '';
          const cleanHawb = s.hawbNumber ? s.hawbNumber.replace(/-/g, '') : '';
          return cleanMawb === cleanExtractedAwb || cleanHawb === cleanExtractedAwb;
        });
        if (matchedShipment) {
          // 該当する出荷案件のマイルストーンSTEP3「許可書入手」を自動的に完了済にする
          const updated = updateShipmentMilestones(matchedShipment.id, 'customs_permit', true);
          const currentShipment = updated || matchedShipment;

          // すでに解析済みの同名ファイルがあるかチェックして重複防止
          const alreadyExists = parsedFiles.some(f => f.originalFile.name === file.name);
          if (!alreadyExists && !newParsedFiles.some(f => f.originalFile.name === file.name)) {
            newParsedFiles.push({
              id: crypto.randomUUID(),
              originalFile: file,
              baseAwb: baseAwb,
              suffix: suffix,
              shipment: currentShipment,
              selected: true,
            });
          }
        }
      }
    });

    setParsedFiles(prev => [...prev, ...newParsedFiles]);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    // 同じファイルを再度選択できるようにリセット
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownload = () => {
    const selectedFiles = parsedFiles.filter(f => f.selected);
    if (selectedFiles.length === 0) return;

    // targetDate is 'YYYY-MM-DD'
    let dateStr = 'YYMMDD';
    if (targetDate && targetDate.length >= 10) {
      dateStr = targetDate.substring(2, 4) + targetDate.substring(5, 7) + targetDate.substring(8, 10);
    }

    selectedFiles.forEach((fileInfo, index) => {
      const { originalFile, baseAwb, suffix, shipment } = fileInfo;
      const destination = shipment.destination || 'UNKNOWN';
      const awbPart = suffix ? `${baseAwb}_${suffix}` : baseAwb;
      const newFileName = `ED ${dateStr} ${awbPart} ${destination}.pdf`;

      const url = URL.createObjectURL(originalFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = newFileName;
      
      setTimeout(() => {
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, index * 300); // 300ms間隔でダウンロードをトリガー
    });
  };

  const toggleAll = () => {
    const allSelected = parsedFiles.length > 0 && parsedFiles.every(f => f.selected);
    setParsedFiles(parsedFiles.map(f => ({ ...f, selected: !allSelected })));
  };

  const toggleShipmentFiles = (shipmentId: string) => {
    const matchedFiles = parsedFiles.filter(f => f.shipment.id === shipmentId);
    const allSelected = matchedFiles.length > 0 && matchedFiles.every(f => f.selected);
    setParsedFiles(parsedFiles.map(f => f.shipment.id === shipmentId ? { ...f, selected: !allSelected } : f));
  };

  const removeShipmentFiles = (shipmentId: string) => {
    setParsedFiles(parsedFiles.filter(f => f.shipment.id !== shipmentId));
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <FileSearch className="w-5 h-5 text-indigo-700" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">許可書解析</h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">ドロップしたPDFのファイル名から対象案件を抽出し、リネームしてダウンロードします</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
            
            {/* Control Panel & Drop Zone */}
            <div className="flex items-stretch space-x-4">
              <div className="flex flex-col bg-white border border-slate-200 p-4 rounded-xl shadow-2xs justify-center shrink-0">
                <label className="text-[11px] font-bold text-slate-500 mb-1">対象通関日</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => {
                    setTargetDate(e.target.value);
                  }}
                  className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
              <div className="flex-1">
                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl h-full p-4 flex flex-row items-center justify-center space-x-4 cursor-pointer transition-all ${
                    isDragging
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-indigo-400'
                  }`}
                >
                  <input
                    type="file"
                    multiple
                    accept="application/pdf"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                  />
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                    isDragging ? 'bg-indigo-200 text-indigo-700' : 'bg-white shadow-sm text-slate-400 border border-slate-200'
                  }`}>
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-slate-700 mb-0.5">
                      許可書PDFファイルをここにドロップ
                    </p>
                    <p className="text-xs text-slate-500 font-medium">
                      またはクリックしてファイルを選択
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Results Table */}
            <div className="border border-slate-200 rounded-xl shadow-2xs overflow-hidden bg-white flex-1 flex flex-col min-h-[300px]">
              <div className="bg-slate-100/80 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700">該当通関日の出荷案件一覧 ({targetShipments.length}件)</span>
                {parsedFiles.length > 0 && (
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-100 px-2 py-1 rounded-md">
                    {parsedFiles.length}件のファイルが合致しました
                  </span>
                )}
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                      <th className="px-2 py-1.5 w-10 text-center cursor-pointer hover:bg-slate-100" onClick={toggleAll}>
                        {parsedFiles.length > 0 && parsedFiles.every(f => f.selected) ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600 mx-auto" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 mx-auto" />
                        )}
                      </th>
                      <th className="px-2 py-1.5">ステータス / AWB番号</th>
                      <th className="px-2 py-1.5">荷主 (Shipper)</th>
                      <th className="px-2 py-1.5">Consignee</th>
                      <th className="px-2 py-1.5">仕向地</th>
                      <th className="px-2 py-1.5 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {targetShipments.length > 0 ? targetShipments.map(shipment => {
                      const matchedFiles = parsedFiles.filter(pf => pf.shipment.id === shipment.id);
                      const isMatched = matchedFiles.length > 0;
                      const allSelected = isMatched && matchedFiles.every(f => f.selected);
                      const someSelected = isMatched && matchedFiles.some(f => f.selected);
                      
                      return (
                      <tr key={shipment.id} className={`transition-colors ${isMatched ? (someSelected ? 'bg-indigo-50/20' : 'bg-slate-50/50') : 'hover:bg-slate-50 opacity-90'}`}>
                        <td className="px-2 py-1 text-center">
                          {isMatched ? (
                            <div className="cursor-pointer" onClick={() => toggleShipmentFiles(shipment.id)}>
                              {allSelected ? (
                                <CheckSquare className="w-4 h-4 text-indigo-600 mx-auto" />
                              ) : someSelected ? (
                                <CheckSquare className="w-4 h-4 text-indigo-400 mx-auto opacity-50" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-300 mx-auto" />
                              )}
                            </div>
                          ) : (
                            <Square className="w-4 h-4 text-slate-200 mx-auto opacity-50" />
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center space-x-2 leading-none">
                            {isMatched ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                                ✓ 合致 (STEP3完了)
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
                                未アップロード
                              </span>
                            )}
                            <div className="flex items-center space-x-1">
                              <span className="font-mono font-bold text-slate-800 text-[11px]">
                                {shipment.hawbNumber || shipment.mawbNumber || 'AWB未定'}
                              </span>
                              {isMatched && (
                                <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold">
                                  {matchedFiles.length}
                                </span>
                              )}
                            </div>
                          </div>
                          {isMatched && (
                            <div className="mt-0.5 space-y-0.5">
                              {matchedFiles.map(f => (
                                <div key={f.id} className="text-[9px] text-slate-500 truncate max-w-[200px] leading-none" title={f.originalFile.name}>
                                  📄 {f.originalFile.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <span className="text-[11px] font-bold text-slate-700 leading-tight">{shipment.shipper}</span>
                        </td>
                        <td className="px-2 py-1">
                          <span className="text-[11px] text-slate-600 font-medium leading-tight">{shipment.consignee}</span>
                        </td>
                        <td className="px-2 py-1">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[9px] font-bold leading-none">
                            {shipment.destination}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-center">
                          {isMatched && (
                            <button 
                              onClick={() => removeShipmentFiles(shipment.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="リストから除外"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )}) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">
                          該当する通関日の案件はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="text-xs font-bold text-slate-600">
              選択中: {parsedFiles.filter(f => f.selected).length} 件
            </div>
            <button
              onClick={handleDownload}
              disabled={parsedFiles.filter(f => f.selected).length === 0}
              className={`px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 transition-all ${
                parsedFiles.filter(f => f.selected).length === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md active:scale-95 hover:shadow-lg'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>選択したファイルをダウンロード</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
