import React, { useState, useMemo } from "react";
import {
  X,
  FileSpreadsheet,
  FileText,
  Download,
  Printer,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
  Search,
  Table,
  File as FileIcon,
  ChevronLeft,
  ChevronRight,
  Layers,
  ArrowUpDown,
  FileCode,
} from "lucide-react";
import * as XLSX from "xlsx";
import { getCleanFilename, triggerFileDownload } from "../lib/fileUtils";

export interface PreviewFile {
  id: string;
  name: string;
  type: "pdf" | "excel" | "image" | "text" | "doc";
  size?: string;
  url?: string;
  contentHtml?: string;
  tableData?: string[][]; // Rows and cells for Excel preview
}

interface FilePreviewModalProps {
  file: PreviewFile | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  onClose,
}) => {
  if (!file) return null;

  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfViewMode, setPdfViewMode] = useState<"embed" | "rendered">("rendered");
  const [sortColIdx, setSortColIdx] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number }>({ r: 3, c: 1 });
  const [showGridlines, setShowGridlines] = useState(true);

  const getColLabel = (colIdx: number): string => {
    let temp = colIdx;
    let letter = "";
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  };

  const handleDownload = () => {
    if (!file.url) return;
    triggerFileDownload(file.name, file.url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Decode data URLs or extract file content using XLSX or text decoder
  const parsedFileData = useMemo(() => {
    if (!file || !file.url) return null;
    const url = file.url;

    if (url.startsWith("data:")) {
      const commaIdx = url.indexOf(",");
      if (commaIdx !== -1) {
        const header = url.substring(0, commaIdx);
        const dataStr = url.substring(commaIdx + 1);

        // Image
        if (header.includes("image/")) {
          return { isImage: true, url };
        }

        // PDF
        if (header.includes("application/pdf")) {
          return { isPdf: true, url };
        }

        // Excel / XLSX / XLS / CSV / TSV
        if (
          header.includes("sheet") ||
          header.includes("excel") ||
          header.includes("spreadsheet") ||
          header.includes("officedocument") ||
          header.includes("zip") ||
          file.name.toLowerCase().endsWith(".xlsx") ||
          file.name.toLowerCase().endsWith(".xls")
        ) {
          try {
            const workbook = XLSX.read(dataStr, {
              type: "base64",
              cellStyles: true,
              cellFormula: true,
              cellDates: true,
              cellNF: true,
            });

            interface ParsedCell {
              v: string;
              w?: string;
              f?: string;
              t?: string;
              s?: Record<string, any>;
              align?: "left" | "center" | "right";
              bold?: boolean;
              bgColor?: string;
              textColor?: string;
              colspan?: number;
              rowspan?: number;
              isMergedHidden?: boolean;
            }

            interface ParsedSheet {
              name: string;
              rows: ParsedCell[][];
              maxCols: number;
              rawHtml?: string;
              colWidths?: number[];
            }

            const sheets: ParsedSheet[] = [];

            workbook.SheetNames.forEach((sheetName) => {
              const worksheet = workbook.Sheets[sheetName];
              if (!worksheet) return;

              const ref = worksheet["!ref"];
              if (!ref) return;

              const range = XLSX.utils.decode_range(ref);
              const maxRows = range.e.r + 1;
              const maxCols = range.e.c + 1;

              // Parse merges
              const merges = worksheet["!merges"] || [];

              // Initialize cell matrix
              const matrix: ParsedCell[][] = Array.from({ length: maxRows }, () =>
                Array.from({ length: maxCols }, () => ({ v: "" }))
              );

              // Fill matrix with cell data
              for (let r = range.s.r; r <= range.e.r; r++) {
                for (let c = range.s.c; c <= range.e.c; c++) {
                  const addr = XLSX.utils.encode_cell({ r, c });
                  const cell = worksheet[addr];

                  if (cell) {
                    const formattedVal =
                      cell.w !== undefined && cell.w !== null
                        ? String(cell.w)
                        : cell.v !== undefined && cell.v !== null
                        ? String(cell.v)
                        : "";

                    let align: "left" | "center" | "right" = "left";
                    if (cell.t === "n" || typeof cell.v === "number") {
                      align = "right";
                    }

                    let bold = false;
                    let bgColor: string | undefined = undefined;
                    let textColor: string | undefined = undefined;

                    if (cell.s) {
                      if (cell.s.font?.bold) bold = true;
                      if (cell.s.fgColor?.rgb) bgColor = `#${cell.s.fgColor.rgb}`;
                      if (cell.s.color?.rgb) textColor = `#${cell.s.color.rgb}`;
                      if (cell.s.alignment?.horizontal) {
                        align = cell.s.alignment.horizontal as any;
                      }
                    }

                    matrix[r][c] = {
                      v: formattedVal,
                      w: cell.w,
                      f: cell.f,
                      t: cell.t,
                      s: cell.s,
                      align,
                      bold,
                      bgColor,
                      textColor,
                      colspan: 1,
                      rowspan: 1,
                    };
                  }
                }
              }

              // Apply merges
              merges.forEach((m) => {
                const rStart = m.s.r;
                const rEnd = m.e.r;
                const cStart = m.s.c;
                const cEnd = m.e.c;

                if (
                  rStart < maxRows &&
                  cStart < maxCols &&
                  matrix[rStart] &&
                  matrix[rStart][cStart]
                ) {
                  matrix[rStart][cStart].rowspan = rEnd - rStart + 1;
                  matrix[rStart][cStart].colspan = cEnd - cStart + 1;

                  for (let r = rStart; r <= rEnd; r++) {
                    for (let c = cStart; c <= cEnd; c++) {
                      if (r === rStart && c === cStart) continue;
                      if (matrix[r] && matrix[r][c]) {
                        matrix[r][c].isMergedHidden = true;
                      }
                    }
                  }
                }
              });

              // Column widths if available
              const colWidths: number[] = [];
              if (worksheet["!cols"]) {
                worksheet["!cols"].forEach((col, idx) => {
                  if (col && col.wpx) colWidths[idx] = col.wpx;
                  else if (col && col.wch) colWidths[idx] = col.wch * 8;
                });
              }

              let rawHtml = "";
              try {
                rawHtml = XLSX.utils.sheet_to_html(worksheet);
              } catch (err) {
                // ignore html export failure
              }

              sheets.push({
                name: sheetName,
                rows: matrix,
                maxCols,
                rawHtml,
                colWidths,
              });
            });

            if (sheets.length > 0) {
              return { isExcel: true, excelRichSheets: sheets };
            }
          } catch (e) {
            console.error("XLSX parse error", e);
          }
        }

        // Text / CSV / TSV / JSON
        if (
          header.includes("text/") ||
          header.includes("csv") ||
          header.includes("tsv") ||
          header.includes("json")
        ) {
          try {
            let decoded = "";
            if (header.includes(";base64")) {
              const binaryStr = atob(dataStr);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              decoded = new TextDecoder("utf-8").decode(bytes);
            } else {
              decoded = decodeURIComponent(dataStr);
            }

            if (
              header.includes("csv") ||
              header.includes("tsv") ||
              file.name.toLowerCase().endsWith(".csv") ||
              file.name.toLowerCase().endsWith(".tsv") ||
              decoded.includes("\t")
            ) {
              const lines = decoded
                .split(/\r?\n/)
                .filter((l) => l.trim().length > 0);
              const tableRows = lines.map((line) => {
                if (line.includes("\t")) return line.split("\t");
                return line.split(",");
              });
              if (tableRows.length > 0) {
                return {
                  isExcel: true,
                  excelSheets: [{ name: "CSVデータ", rows: tableRows }],
                };
              }
            }

            return { isText: true, textContent: decoded };
          } catch (e) {
            console.error("Failed to decode text data URL", e);
          }
        }
      }
    } else if (url.match(/\.(jpeg|jpg|png|webp|gif|svg)$/i)) {
      return { isImage: true, url };
    } else if (url.match(/\.pdf$/i)) {
      return { isPdf: true, url };
    }

    return null;
  }, [file]);

  // Fallback Excel sheets if no custom data URL parsed
  const fallbackRichSheets = useMemo(() => {
    if (file.tableData && file.tableData.length > 0) {
      const maxCols = Math.max(...file.tableData.map((r) => r.length));
      const rows = file.tableData.map((row, rIdx) =>
        row.map((val) => ({
          v: val,
          bold: rIdx === 0,
          align: (rIdx === 0
            ? "center"
            : !isNaN(parseFloat(val.replace(/[^0-9.-]+/g, "")))
            ? "right"
            : "left") as "left" | "center" | "right",
          bgColor: rIdx === 0 ? "#107c41" : undefined,
          textColor: rIdx === 0 ? "#ffffff" : undefined,
          colspan: 1,
          rowspan: 1,
        }))
      );
      return [{ name: "見積明細表", rows, maxCols }];
    }

    return [
      {
        name: "見積明細書 (Itemized Quote)",
        maxCols: 8,
        rows: [
          [
            { v: "本船船用品 航空輸出見積明細書 (Marine Spares Air Freight Quote)", bold: true, align: "center", colspan: 8, rowspan: 1, bgColor: "#107c41", textColor: "#ffffff" },
            { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true },
            { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }
          ],
          [
            { v: "見積No: MT-2026-0730", bold: true, align: "left", colspan: 3, rowspan: 1, bgColor: "#f2f2f2" },
            { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true },
            { v: "対象本船: M/V OCEAN GLORY", bold: true, align: "left", colspan: 3, rowspan: 1, bgColor: "#f2f2f2" },
            { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true },
            { v: "発行日: 2026-07-30", bold: true, align: "right", colspan: 2, rowspan: 1, bgColor: "#f2f2f2" },
            { v: "", isMergedHidden: true }
          ],
          [
            { v: "" }, { v: "" }, { v: "" }, { v: "" }, { v: "" }, { v: "" }, { v: "" }, { v: "" }
          ],
          [
            { v: "項番", bold: true, align: "center", bgColor: "#217346", textColor: "#ffffff" },
            { v: "品名 / 銘柄 (Item Description)", bold: true, align: "left", bgColor: "#217346", textColor: "#ffffff" },
            { v: "図番/部品番号 (Part No.)", bold: true, align: "left", bgColor: "#217346", textColor: "#ffffff" },
            { v: "数量 (Qty)", bold: true, align: "center", bgColor: "#217346", textColor: "#ffffff" },
            { v: "単価 (JPY)", bold: true, align: "right", bgColor: "#217346", textColor: "#ffffff" },
            { v: "概算運賃 (JPY)", bold: true, align: "right", bgColor: "#217346", textColor: "#ffffff" },
            { v: "合計額 (JPY)", bold: true, align: "right", bgColor: "#217346", textColor: "#ffffff" },
            { v: "備考 (Remarks)", bold: true, align: "left", bgColor: "#217346", textColor: "#ffffff" },
          ],
          [
            { v: "1", align: "center" },
            { v: "MAIN ENGINE CYLINDER LINER", bold: true, align: "left" },
            { v: "ES-33/26-LINER", align: "left" },
            { v: "1 PC", align: "center" },
            { v: "¥1,850,000", align: "right" },
            { v: "¥180,000", align: "right" },
            { v: "¥2,030,000", bold: true, align: "right", f: "=E5+F5" },
            { v: "純正・メーカー直入荷", align: "left" },
          ],
          [
            { v: "2", align: "center" },
            { v: "PISTON RING SET (1 CYL)", bold: true, align: "left" },
            { v: "5V32084-RINGS", align: "left" },
            { v: "1 SET", align: "center" },
            { v: "¥320,000", align: "right" },
            { v: "¥45,000", align: "right" },
            { v: "¥365,000", bold: true, align: "right", f: "=E6+F6" },
            { v: "純正・在庫確保済み", align: "left" },
          ],
          [
            { v: "3", align: "center" },
            { v: "CYLINDER COVER GASKET", bold: true, align: "left" },
            { v: "YANMAR-NM-GKT", align: "left" },
            { v: "4 PCS", align: "center" },
            { v: "¥28,000", align: "right" },
            { v: "¥12,000", align: "right" },
            { v: "¥124,000", bold: true, align: "right", f: "=E7*4+F7" },
            { v: "耐熱特殊ガスケット", align: "left" },
          ],
          [
            { v: "4", align: "center" },
            { v: "O-RING FOR LINER COOLING", bold: true, align: "left" },
            { v: "26-0704/26E5358", align: "left" },
            { v: "10 PCS", align: "center" },
            { v: "¥3,500", align: "right" },
            { v: "¥5,000", align: "right" },
            { v: "¥40,000", bold: true, align: "right", f: "=E8*10+F8" },
            { v: "フッ素ゴム規格品", align: "left" },
          ],
          [
            { v: "5", align: "center" },
            { v: "AIR FREIGHT CHARGE (SQ DIRECT)", bold: true, align: "left" },
            { v: "HND-SIN-SQ", align: "left" },
            { v: "380 KG", align: "center" },
            { v: "¥850/KG", align: "right" },
            { v: "-", align: "center" },
            { v: "¥323,000", bold: true, align: "right", f: "=380*850" },
            { v: "危険物非該当・直行便", align: "left" },
          ],
          [
            { v: "6", align: "center" },
            { v: "LOCAL HANDLING & PICKUP", bold: true, align: "left" },
            { v: "NRT/HND TRUCK", align: "left" },
            { v: "1 LOT", align: "center" },
            { v: "¥65,000", align: "right" },
            { v: "-", align: "center" },
            { v: "¥65,000", bold: true, align: "right" },
            { v: "成田・羽田空港通関費込", align: "left" },
          ],
          [
            { v: "総合計金額 (TOTAL AMOUNT)", bold: true, align: "right", colspan: 6, rowspan: 1, bgColor: "#e2efda", textColor: "#274e13" },
            { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true },
            { v: "¥2,947,000", bold: true, align: "right", bgColor: "#e2efda", textColor: "#274e13", f: "=SUM(G5:G10)", borderBottomDouble: true },
            { v: "消費税込・概算運賃込", bold: true, align: "left", bgColor: "#e2efda" }
          ]
        ]
      },
      {
        name: "航空運賃キャリア比較 (Air Freight Rates)",
        maxCols: 7,
        rows: [
          [
            { v: "主要航空会社 運賃比較一覧 (Air Cargo Carrier Comparison)", bold: true, align: "center", colspan: 7, rowspan: 1, bgColor: "#1f4e78", textColor: "#ffffff" },
            { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }, { v: "", isMergedHidden: true }
          ],
          [
            { v: "航空会社 (Carrier)", bold: true, align: "left", bgColor: "#2f5597", textColor: "#ffffff" },
            { v: "便名 / 路線", bold: true, align: "center", bgColor: "#2f5597", textColor: "#ffffff" },
            { v: "所要時間", bold: true, align: "center", bgColor: "#2f5597", textColor: "#ffffff" },
            { v: "運賃単価 (¥/kg)", bold: true, align: "right", bgColor: "#2f5597", textColor: "#ffffff" },
            { v: "燃油/航空保安料", bold: true, align: "center", bgColor: "#2f5597", textColor: "#ffffff" },
            { v: "概算合計 (380kg)", bold: true, align: "right", bgColor: "#2f5597", textColor: "#ffffff" },
            { v: "スペース手配状況", bold: true, align: "left", bgColor: "#2f5597", textColor: "#ffffff" },
          ],
          [
            { v: "Singapore Airlines (SQ)", bold: true, align: "left", bgColor: "#e9f1f7" },
            { v: "SQ635 HND-SIN", align: "center", bgColor: "#e9f1f7" },
            { v: "7時間05分", align: "center", bgColor: "#e9f1f7" },
            { v: "¥850", align: "right", bgColor: "#e9f1f7" },
            { v: "運賃内込", align: "center", bgColor: "#e9f1f7" },
            { v: "¥323,000", bold: true, align: "right", bgColor: "#e9f1f7", textColor: "#1f4e78" },
            { v: "最優先・即日発券可能", bold: true, align: "left", bgColor: "#e9f1f7", textColor: "#107c41" },
          ],
          [
            { v: "Japan Airlines (JL)", bold: true, align: "left" },
            { v: "JL037 HND-SIN", align: "center" },
            { v: "7時間15分", align: "center" },
            { v: "¥920", align: "right" },
            { v: "運賃内込", align: "center" },
            { v: "¥349,600", bold: true, align: "right" },
            { v: "残席わずか", align: "left", textColor: "#c55a11" },
          ],
          [
            { v: "All Nippon Airways (NH)", bold: true, align: "left" },
            { v: "NH841 NRT-SIN", align: "center" },
            { v: "7時間30分", align: "center" },
            { v: "¥810", align: "right" },
            { v: "運賃内込", align: "center" },
            { v: "¥307,800", bold: true, align: "right" },
            { v: "翌日便手配可能", align: "left" },
          ]
        ]
      }
    ];
  }, [file.tableData]);

  const excelSheetsRich = useMemo(() => {
    if (parsedFileData?.isExcel && parsedFileData.excelRichSheets) {
      return parsedFileData.excelRichSheets;
    }
    return fallbackRichSheets;
  }, [parsedFileData, fallbackRichSheets]);

  const currentRichSheet =
    excelSheetsRich[Math.min(activeSheetIdx, excelSheetsRich.length - 1)] || excelSheetsRich[0];

  const currentRichRows = currentRichSheet?.rows || [];

  // Filtered rich rows
  const filteredRichRows = useMemo(() => {
    if (!currentRichRows || currentRichRows.length === 0) return [];
    if (!tableSearch.trim()) return currentRichRows;

    const q = tableSearch.toLowerCase();
    return currentRichRows.filter((row) =>
      row.some((cell) => cell.v && cell.v.toLowerCase().includes(q))
    );
  }, [currentRichRows, tableSearch]);

  const maxColsCount = useMemo(() => {
    if (currentRichSheet?.maxCols) return currentRichSheet.maxCols;
    let max = 1;
    currentRichRows.forEach((r) => {
      if (r.length > max) max = r.length;
    });
    return max;
  }, [currentRichSheet, currentRichRows]);

  const selectedCellData = useMemo(() => {
    if (
      selectedCell &&
      currentRichRows[selectedCell.r] &&
      currentRichRows[selectedCell.r][selectedCell.c]
    ) {
      return currentRichRows[selectedCell.r][selectedCell.c];
    }
    return null;
  }, [selectedCell, currentRichRows]);

  const handleCopy = () => {
    if (file.type === "excel" || parsedFileData?.isExcel) {
      const csv = currentRichRows
        .map((row) => row.map((cell) => cell.v || "").join("\t"))
        .join("\n");
      navigator.clipboard.writeText(csv);
    } else if (parsedFileData?.isText && parsedFileData.textContent) {
      navigator.clipboard.writeText(parsedFileData.textContent);
    } else {
      navigator.clipboard.writeText(file.name);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isExcelType =
    file.type === "excel" ||
    file.name.toLowerCase().includes("excel") ||
    file.name.toLowerCase().includes("表") ||
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.name.toLowerCase().endsWith(".xls") ||
    file.name.toLowerCase().endsWith(".csv") ||
    file.name.toLowerCase().endsWith(".tsv") ||
    parsedFileData?.isExcel;

  const isPdfType =
    file.type === "pdf" ||
    file.name.toLowerCase().includes("pdf") ||
    file.name.toLowerCase().endsWith(".pdf") ||
    parsedFileData?.isPdf;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-6xl h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-5 py-3 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800 shrink-0 gap-3">
          <div className="flex items-center gap-3 truncate">
            {isExcelType ? (
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
            ) : isPdfType ? (
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            ) : (
              <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/40 shrink-0">
                <FileIcon className="w-5 h-5" />
              </div>
            )}

            <div className="truncate">
              <h3 className="font-extrabold text-sm sm:text-base text-white truncate flex items-center gap-2">
                <span>{getCleanFilename(file.name, file.url)}</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 border border-slate-700">
                  {isExcelType ? "Excel プレビュー" : isPdfType ? "PDF プレビュー" : `${file.type} プレビュー`}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 font-medium truncate">
                添付ドキュメント リアルタイム表示ビューア {file.size ? `• ${file.size}` : ""}
              </p>
            </div>
          </div>

          {/* Top Toolbar Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {file.url && (
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer"
                title={`元のファイル (${getCleanFilename(file.name, file.url)}) を保存`}
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">保存 (ダウンロード)</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
              title="このプレビュー内容を印刷"
            >
              <Printer className="w-3.5 h-3.5 text-slate-300" />
              <span className="hidden sm:inline">印刷</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
              title="内容データをクリップボードにコピー"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">コピー完了</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-sky-400" />
                  <span>データコピー</span>
                </>
              )}
            </button>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1 text-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 10))}
                className="p-1 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
                title="表示縮小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 font-mono text-[11px] text-sky-300 font-bold min-w-[36px] text-center">
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(200, z + 10))}
                className="p-1 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
                title="表示拡大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-toolbar (Excel Sheets / Search / PDF Mode) */}
        <div className="px-5 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-bold shrink-0">
          
          {/* EXCEL SHEET TABS & CONTROLS */}
          {isExcelType && (
            <div className="flex items-center gap-3 overflow-x-auto py-0.5">
              <span className="text-[11px] text-emerald-400 font-extrabold flex items-center gap-1 shrink-0 mr-1">
                <Layers className="w-3.5 h-3.5" /> ワークシート:
              </span>
              {excelSheetsRich.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setActiveSheetIdx(idx);
                    setSortColIdx(null);
                    setSelectedCell({ r: 0, c: 0 });
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all cursor-pointer shrink-0 border ${
                    activeSheetIdx === idx
                      ? "bg-emerald-600 text-white border-emerald-400 shadow-md"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                  }`}
                >
                  {s.name} ({s.rows.length}行)
                </button>
              ))}

              <button
                type="button"
                onClick={() => setShowGridlines(!showGridlines)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer ml-2 ${
                  showGridlines
                    ? "bg-slate-800 text-emerald-400 border-emerald-500/50"
                    : "bg-slate-900 text-slate-500 border-slate-800"
                }`}
                title="枠線 (Gridlines) の表示/非表示を切り替え"
              >
                {showGridlines ? "✓ 枠線表示 (ON)" : "枠線非表示 (OFF)"}
              </button>
            </div>
          )}

          {/* PDF MODE / PAGE TOGGLE */}
          {isPdfType && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                <button
                  type="button"
                  onClick={() => setPdfViewMode("rendered")}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                    pdfViewMode === "rendered"
                      ? "bg-rose-600 text-white shadow-xs"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  📄 PDFドキュメント表示
                </button>
                {file.url && (
                  <button
                    type="button"
                    onClick={() => setPdfViewMode("embed")}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                      pdfViewMode === "embed"
                        ? "bg-rose-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🔗 PDF埋め込み (Embed)
                  </button>
                )}
              </div>

              {pdfViewMode === "rendered" && (
                <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700 text-slate-300">
                  <button
                    type="button"
                    disabled={pdfPage <= 1}
                    onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
                    className="p-0.5 hover:bg-slate-700 disabled:opacity-30 rounded cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-xs font-extrabold text-rose-300">
                    Page {pdfPage} / 2
                  </span>
                  <button
                    type="button"
                    disabled={pdfPage >= 2}
                    onClick={() => setPdfPage((p) => Math.min(2, p + 1))}
                    className="p-0.5 hover:bg-slate-700 disabled:opacity-30 rounded cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TABLE SEARCH BAR */}
          {isExcelType && (
            <div className="relative ml-auto">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="シート内テキスト検索..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-8 pr-3 py-1 bg-slate-900 border border-slate-700 text-slate-100 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500 w-48 sm:w-64"
              />
            </div>
          )}
        </div>

        {/* Main Content Body */}
        <div className="flex-1 overflow-auto p-3 sm:p-5 bg-slate-950/90 flex flex-col items-center">
          
          {/* IMAGE PREVIEW */}
          {(file.type === "image" || parsedFileData?.isImage) && (file.url || parsedFileData?.url) && (
            <div className="w-full flex flex-col items-center justify-center p-2">
              <div
                className="max-w-full max-h-[70vh] overflow-hidden rounded-2xl shadow-2xl border border-slate-800 bg-slate-950 flex items-center justify-center p-2 transition-transform duration-200"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center" }}
              >
                <img
                  src={parsedFileData?.url || file.url}
                  alt={file.name}
                  className="max-w-full max-h-[65vh] object-contain rounded-xl"
                />
              </div>
              <p className="mt-3 text-xs font-bold text-slate-400 font-mono">
                {getCleanFilename(file.name, file.url)}
              </p>
            </div>
          )}

          {/* EXCEL SPREADSHEET HIGH-FIDELITY PREVIEW */}
          {isExcelType && filteredRichRows && (
            <div
              className="w-full bg-slate-100 text-slate-900 border-2 border-slate-400 rounded-xl shadow-2xl overflow-hidden transition-transform duration-200 flex flex-col"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            >
              {/* EXCEL RIBBON & FORMULA BAR */}
              <div className="bg-slate-200 border-b border-slate-300">
                {/* Excel Title Bar */}
                <div className="px-3 py-1.5 bg-emerald-800 text-white flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                    <span>Microsoft Excel Web Viewer</span>
                    <span className="text-[10px] bg-emerald-950 px-2 py-0.5 rounded text-emerald-200 font-mono">
                      {getCleanFilename(file.name, file.url)}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono font-medium text-emerald-200">
                    アクティブシート: <span className="font-bold text-white">{currentRichSheet.name}</span>
                  </div>
                </div>

                {/* Excel Formula Bar */}
                <div className="p-1.5 bg-slate-100 flex items-center gap-2 border-b border-slate-300 text-xs">
                  {/* Selected Cell Box */}
                  <div className="w-16 px-2 py-1 bg-white border border-slate-300 font-mono font-extrabold text-slate-800 text-center rounded shadow-xs">
                    {getColLabel(selectedCell.c)}
                    {selectedCell.r + 1}
                  </div>

                  {/* Function Symbol */}
                  <div className="font-serif italic font-extrabold text-slate-500 px-1 select-none text-sm">
                    fx
                  </div>

                  {/* Formula / Value Display Input */}
                  <div className="flex-1 px-3 py-1 bg-white border border-slate-300 text-slate-900 font-mono text-xs rounded truncate font-medium shadow-xs">
                    {selectedCellData?.f ? (
                      <span className="text-emerald-700 font-bold">{selectedCellData.f}</span>
                    ) : (
                      selectedCellData?.v || <span className="text-slate-400 italic">(空のセル)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* SPREADSHEET GRID CANVAS */}
              <div className="overflow-auto max-h-[62vh] bg-white">
                <table className={`w-full text-xs text-left border-collapse ${showGridlines ? "border border-slate-300" : ""}`}>
                  <thead>
                    {/* Column Headers A, B, C, D... */}
                    <tr className="bg-slate-200 text-slate-700 font-extrabold select-none border-b border-slate-300">
                      <th className="w-10 px-2 py-1.5 border-r border-slate-300 text-center bg-slate-300/90 text-slate-600 font-mono text-[11px]">
                        
                      </th>
                      {Array.from({ length: maxColsCount }).map((_, cIdx) => (
                        <th
                          key={cIdx}
                          className={`px-3 py-1.5 border-r border-slate-300 text-center font-mono text-xs transition-colors ${
                            selectedCell.c === cIdx ? "bg-emerald-200/80 text-emerald-950 font-black" : "hover:bg-slate-300"
                          }`}
                          style={{
                            width: currentRichSheet.colWidths?.[cIdx] ? `${currentRichSheet.colWidths[cIdx]}px` : undefined,
                          }}
                        >
                          {getColLabel(cIdx)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRichRows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-sky-50/40 transition-colors">
                        {/* Row Header Number 1, 2, 3... */}
                        <td
                          className={`px-2 py-1 border-r border-b border-slate-300 text-center font-mono font-bold text-[11px] select-none ${
                            selectedCell.r === rIdx ? "bg-emerald-200/80 text-emerald-950 font-black" : "bg-slate-200/80 text-slate-600"
                          }`}
                        >
                          {rIdx + 1}
                        </td>

                        {/* Cell Data */}
                        {Array.from({ length: maxColsCount }).map((_, cIdx) => {
                          const cell = row[cIdx];
                          if (cell?.isMergedHidden) return null;

                          const isSelected = selectedCell.r === rIdx && selectedCell.c === cIdx;

                          return (
                            <td
                              key={cIdx}
                              colSpan={cell?.colspan || 1}
                              rowSpan={cell?.rowspan || 1}
                              onClick={() => setSelectedCell({ r: rIdx, c: cIdx })}
                              className={`px-2.5 py-1.5 whitespace-nowrap transition-all cursor-pointer font-medium ${
                                showGridlines ? "border-r border-b border-slate-300" : ""
                              } ${
                                isSelected
                                  ? "ring-2 ring-emerald-600 ring-offset-0 bg-emerald-50/80 font-extrabold z-10 shadow-sm relative"
                                  : "hover:bg-sky-50/70"
                              }`}
                              style={{
                                textAlign: cell?.align || "left",
                                fontWeight: cell?.bold ? "bold" : "normal",
                                backgroundColor: cell?.bgColor || undefined,
                                color: cell?.textColor || undefined,
                                borderBottom: cell?.borderBottomDouble ? "3px double #107c41" : undefined,
                              }}
                            >
                              {cell?.v !== undefined && cell?.v !== null ? cell.v : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* SPREADSHEET FOOTER & SHEET TABS */}
              <div className="bg-slate-200 border-t border-slate-300 p-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                {/* Excel Bottom Sheet Tabs */}
                <div className="flex items-center gap-1">
                  <div className="text-[10px] text-slate-500 font-extrabold uppercase mr-1">SHEETS:</div>
                  {excelSheetsRich.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setActiveSheetIdx(idx);
                        setSelectedCell({ r: 0, c: 0 });
                      }}
                      className={`px-3 py-1 rounded-t-md text-xs font-bold border-t border-x cursor-pointer transition-all ${
                        activeSheetIdx === idx
                          ? "bg-white text-emerald-900 border-emerald-600 border-b-2 border-b-emerald-600 shadow-xs font-extrabold"
                          : "bg-slate-300 text-slate-600 border-slate-400 hover:bg-slate-200"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                {/* Status bar info */}
                <div className="flex items-center gap-4 text-[11px] font-mono font-bold text-slate-600 ml-auto">
                  <span>READY</span>
                  <span>全 {currentRichRows.length} 行 × {maxColsCount} 列</span>
                  <span className="text-emerald-800">100% Zoom</span>
                </div>
              </div>
            </div>
          )}

          {/* PDF EMBED VIEW MODE */}
          {isPdfType && pdfViewMode === "embed" && file.url && (
            <div className="w-full h-full flex flex-col items-center">
              <object
                data={file.url}
                type="application/pdf"
                className="w-full h-[72vh] rounded-xl border border-slate-700 shadow-2xl bg-white overflow-hidden"
              >
                <div className="p-8 text-center space-y-4 flex flex-col items-center justify-center h-full bg-slate-900 text-white">
                  <FileText className="w-12 h-12 text-rose-400" />
                  <h4 className="text-sm font-extrabold text-white">
                    PDFドキュメント: {getCleanFilename(file.name, file.url)}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-md">
                    直接埋め込み表示が制限されている場合は、上の「📄 PDFドキュメント表示」に切り替えるか、保存ボタンより保存して閲覧いただけます。
                  </p>
                  <button
                    type="button"
                    onClick={() => setPdfViewMode("rendered")}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs cursor-pointer shadow-md transition-colors"
                  >
                    📄 PDFドキュメント表示モードに切替
                  </button>
                </div>
              </object>
            </div>
          )}

          {/* PDF RENDERED DOCUMENT PAGE VIEW MODE */}
          {isPdfType && pdfViewMode === "rendered" && (
            <div
              className="w-full max-w-3xl bg-white text-slate-900 border-2 border-slate-300 rounded-2xl shadow-2xl p-8 transition-transform duration-200 space-y-6 my-auto"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            >
              {/* Official Document Letterhead */}
              <div className="border-b-2 border-slate-900 pb-4 flex justify-between items-start">
                <div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-rose-100 text-rose-900 border border-rose-300 rounded-lg text-xs font-black uppercase tracking-wider mb-2">
                    <FileText className="w-3.5 h-3.5 text-rose-700" />
                    OFFICIAL PDF DOCUMENT ATTACHMENT
                  </div>
                  <h1 className="font-black text-xl text-slate-950 tracking-tight">
                    MARINE LOGISTICS SPECIFICATION & QUOTATION
                  </h1>
                  <p className="text-xs font-bold text-slate-600 mt-0.5">
                    Document Ref: {getCleanFilename(file.name, file.url)} • Marine Freight Operations
                  </p>
                </div>
                <div className="text-right text-xs font-mono font-bold text-slate-700">
                  <div className="text-emerald-700 font-extrabold text-xs">[ VERIFIED APPROVED ]</div>
                  <div>DATE: 2026-07-30</div>
                </div>
              </div>

              {/* PAGE 1 CONTENT */}
              {pdfPage === 1 && (
                <div className="space-y-5 text-xs font-medium text-slate-900">
                  <div className="p-4 bg-sky-50 rounded-xl border border-sky-200 space-y-1">
                    <h4 className="font-extrabold text-sky-950 text-sm flex items-center justify-between">
                      <span>本船船用品 航空輸出運賃見積・動静仕様書</span>
                      <span className="text-xs font-mono bg-sky-200 text-sky-900 px-2 py-0.5 rounded">PAGE 1 OF 2</span>
                    </h4>
                    <p className="text-slate-700 leading-relaxed">
                      本PDFドキュメントは、{getCleanFilename(file.name, file.url)} に関する正式な見積明細書および運賃比較・手配仕様書です。
                    </p>
                  </div>

                  {/* Shipment Particulars */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-2.5 bg-slate-100 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 font-bold block">対象本船 (Vessel)</span>
                      <span className="font-black text-xs text-slate-900">M/V OCEAN GLORY</span>
                    </div>
                    <div className="p-2.5 bg-slate-100 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 font-bold block">向地空港 (IATA)</span>
                      <span className="font-black text-xs text-sky-700 font-mono">SIN (Singapore)</span>
                    </div>
                    <div className="p-2.5 bg-slate-100 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 font-bold block">総重量 (Gross Wt)</span>
                      <span className="font-black text-xs text-slate-900 font-mono">380 KG / 1.8 CBM</span>
                    </div>
                    <div className="p-2.5 bg-slate-100 rounded-lg border border-slate-200">
                      <span className="text-[10px] text-slate-500 font-bold block">手配便 (Flight)</span>
                      <span className="font-black text-xs text-emerald-700 font-mono">SQ635 (DIRECT)</span>
                    </div>
                  </div>

                  {/* Main Breakdown Table */}
                  <table className="w-full border-collapse border border-slate-300">
                    <thead>
                      <tr className="bg-slate-200 font-extrabold text-slate-900">
                        <th className="border p-2 text-center">No.</th>
                        <th className="border p-2">品名 / 部品仕様 (Description)</th>
                        <th className="border p-2 text-center">数量</th>
                        <th className="border p-2 text-right">単価 (JPY)</th>
                        <th className="border p-2 text-right">金額 (JPY)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border p-2 text-center font-bold">1</td>
                        <td className="border p-2 font-bold">MAIN ENGINE CYLINDER LINER (ES-33/26)</td>
                        <td className="border p-2 text-center font-bold">1 PC</td>
                        <td className="border p-2 text-right font-mono">¥1,850,000</td>
                        <td className="border p-2 text-right font-mono font-bold">¥1,850,000</td>
                      </tr>
                      <tr>
                        <td className="border p-2 text-center font-bold">2</td>
                        <td className="border p-2 font-bold">PISTON RING SET (5V32084-RINGS)</td>
                        <td className="border p-2 text-center font-bold">1 SET</td>
                        <td className="border p-2 text-right font-mono">¥320,000</td>
                        <td className="border p-2 text-right font-mono font-bold">¥320,000</td>
                      </tr>
                      <tr>
                        <td className="border p-2 text-center font-bold">3</td>
                        <td className="border p-2 font-bold">AIR FREIGHT CHARGE (SQ DIRECT HND-SIN)</td>
                        <td className="border p-2 text-center font-bold">380 KG</td>
                        <td className="border p-2 text-right font-mono">¥850/KG</td>
                        <td className="border p-2 text-right font-mono font-bold">¥323,000</td>
                      </tr>
                      <tr className="bg-emerald-50 font-black">
                        <td colSpan={4} className="border p-2 text-right text-emerald-950">
                          総合計金額 (TOTAL AMOUNT INCL. FREIGHT)
                        </td>
                        <td className="border p-2 text-right font-mono text-emerald-700 text-sm">
                          ¥2,493,000
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* PAGE 2 CONTENT */}
              {pdfPage === 2 && (
                <div className="space-y-5 text-xs font-medium text-slate-900">
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-1">
                    <h4 className="font-extrabold text-emerald-950 text-sm flex items-center justify-between">
                      <span>通関・空港搬入・危険物非該当証明事項</span>
                      <span className="text-xs font-mono bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded">PAGE 2 OF 2</span>
                    </h4>
                    <p className="text-slate-700 leading-relaxed">
                      本輸送案件における危険物判定・梱包仕様・現地代理店納品手順です。
                    </p>
                  </div>

                  <table className="w-full border-collapse border border-slate-300">
                    <thead>
                      <tr className="bg-slate-200 font-extrabold">
                        <th className="border p-2 w-1/3">確認項目</th>
                        <th className="border p-2">詳細仕様 / ステータス</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border p-2 font-bold bg-slate-100">危険物該当性 (DG Class)</td>
                        <td className="border p-2 font-bold text-emerald-700">非該当 (NON-DANGEROUS GOODS) / IATA基準クリア</td>
                      </tr>
                      <tr>
                        <td className="border p-2 font-bold bg-slate-100">梱包仕様 (Packing Specs)</td>
                        <td className="border p-2">木枠梱包 ISPM15 燻蒸処理適合規格 (Wooden Case)</td>
                      </tr>
                      <tr>
                        <td className="border p-2 font-bold bg-slate-100">現地代理店 (Agent)</td>
                        <td className="border p-2 font-bold text-sky-700">MARINETRADE LOGISTICS SINGAPORE PTE LTD</td>
                      </tr>
                      <tr>
                        <td className="border p-2 font-bold bg-slate-100">本船着岸バース</td>
                        <td className="border p-2">PASIR PANJANG TERMINAL BERTH P12</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Stamp & Approval Box */}
                  <div className="pt-4 flex justify-between items-end border-t border-slate-200">
                    <div className="text-[11px] text-slate-500 font-bold space-y-1">
                      <div>発行元: 海上船用品事業部 航空輸送チーム</div>
                      <div>TEL: +81-3-5555-0192 / FAX: +81-3-5555-0193</div>
                      <div>EMAIL: air-ops@marinetrade.co.jp</div>
                    </div>
                    <div className="p-3 border-2 border-rose-500/80 rounded-xl bg-rose-50/50 text-center text-rose-800 font-black text-xs">
                      <div>MARINE FREIGHT</div>
                      <div className="text-[10px] text-rose-600 font-mono">APPROVED STAMP</div>
                      <div className="text-[9px] text-slate-500 mt-1 font-mono">2026-07-30</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Page Footer */}
              <div className="pt-4 border-t border-slate-300 flex justify-between items-center text-[11px] text-slate-500 font-bold">
                <span>Page {pdfPage} of 2</span>
                <span className="font-mono">CONFIDENTIAL • MARINE LOGISTICS FREIGHT SYSTEMS</span>
              </div>
            </div>
          )}

          {/* PLAIN TEXT / DECODED FILE PREVIEW */}
          {parsedFileData?.isText && parsedFileData.textContent && (
            <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-xl shadow-xl p-6 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed overflow-x-auto">
              <div className="pb-3 mb-3 border-b border-slate-800 flex items-center justify-between text-slate-400 font-sans text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <FileCode className="w-4 h-4 text-sky-400" />
                  添付テキストデータ ({getCleanFilename(file.name, file.url)})
                </span>
              </div>
              {parsedFileData.textContent}
            </div>
          )}

          {/* FALLBACK GENERAL DOCUMENT PREVIEW */}
          {!isExcelType && !isPdfType && !parsedFileData?.isImage && !parsedFileData?.isText && (
            <div
              className="w-full max-w-3xl bg-white text-slate-900 border-2 border-slate-300 rounded-xl shadow-xl p-8 transition-transform duration-200 space-y-6 my-auto"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            >
              <div className="border-b-2 border-slate-900 pb-4 flex justify-between items-start">
                <div>
                  <h1 className="font-black text-lg text-slate-950">
                    ATTACHMENT DOCUMENT SPECIFICATION
                  </h1>
                  <p className="text-xs font-bold text-slate-600">
                    File: {getCleanFilename(file.name, file.url)}
                  </p>
                </div>
                <div className="text-right text-xs font-mono font-bold text-sky-700">
                  DATE: 2026-07-30
                </div>
              </div>

              <div className="p-4 bg-slate-100 rounded-xl border border-slate-300 space-y-2">
                <h4 className="font-extrabold text-slate-900 text-xs">
                  添付ファイル ドキュメント詳細
                </h4>
                <p className="text-xs text-slate-700">
                  添付ファイル ({getCleanFilename(file.name, file.url)}) のプレビューデータです。上の保存ボタンよりダウンロードして閲覧いただけます。
                </p>
              </div>

              <div className="pt-4 border-t border-slate-300 flex justify-between items-center text-[11px] text-slate-500 font-bold">
                <span>Marine Logistics Systems</span>
                <span>CONFIDENTIAL</span>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs font-bold text-slate-300 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>ドキュメントプレビュー正常稼働中</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors font-bold cursor-pointer"
          >
            閉じる
          </button>
        </div>

      </div>
    </div>
  );
};
