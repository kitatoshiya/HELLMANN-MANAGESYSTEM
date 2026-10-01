import React, { useState, useRef, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  FileSpreadsheet,
  Upload,
  Download,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Info,
  Layers,
  FileDown,
  Table,
  Eye,
  Trash2,
  HelpCircle,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SortAsc,
  Ship,
  Check,
  ChevronDown,
  X,
  Mail,
  Copy,
  ExternalLink,
  Settings2,
  FileText,
  Send,
} from "lucide-react";
import { AppTheme, StaffMember, UserProfile } from "../types";

interface StockExtractorViewProps {
  currentTheme: AppTheme;
  currentUser?: UserProfile | StaffMember | null;
  onBackToKanban?: () => void;
}

// Target columns to extract (0-indexed and 1-indexed mapping)
export interface TargetColumnConfig {
  colLetter: string;
  colIndex: number; // 0-indexed: B=1, C=2, D=3, E=4, F=5, N=13, O=14, P=15, Q=16, R=17
  title: string;
}

export const TARGET_COLUMNS: TargetColumnConfig[] = [
  { colLetter: "B", colIndex: 1, title: "VESSEL" },
  { colLetter: "C", colIndex: 2, title: "ORDER NUMBER" },
  { colLetter: "D", colIndex: 3, title: "DG" },
  { colLetter: "E", colIndex: 4, title: "INV NUMBER" },
  { colLetter: "F", colIndex: 5, title: "SUPPLIER" },
  { colLetter: "N", colIndex: 13, title: "CHECK IN DATE" },
  { colLetter: "O", colIndex: 14, title: "STOCK No" },
  { colLetter: "P", colIndex: 15, title: "NO OF PKGS" },
  { colLetter: "Q", colIndex: 16, title: "TTL GW" },
  { colLetter: "R", colIndex: 17, title: "M3" },
];

export interface ExtractedRow {
  originalRowNumber: number; // 1-indexed row number in the original excel (e.g. 3, 4, ...)
  data: Record<string, any>; // Key is colLetter, value is string/number
  cellDValue: any;
  cellFValue: any;
  cellQValue: number | null;
  hasCellD: boolean; // D列が空白ではないか
  isHeavyWeight: boolean; // Q列が200以上か
}

type SortField = "B" | "D" | "F" | null;
type SortOrder = "asc" | "desc";

export const StockExtractorView: React.FC<StockExtractorViewProps> = ({
  currentTheme,
  currentUser,
  onBackToKanban,
}) => {
  const [fileName, setFileName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [headerTitles, setHeaderTitles] = useState<Record<string, string>>({});
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([]);
  const [totalScannedRows, setTotalScannedRows] = useState<number>(0);
  const [shippedExcludedCount, setShippedExcludedCount] = useState<number>(0);
  const [pZeroExcludedCount, setPZeroExcludedCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterHighlight, setFilterHighlight] = useState<"all" | "yellow" | "blue">("all");
  const [selectedVessels, setSelectedVessels] = useState<string[]>([]);
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState<boolean>(false);
  const [vesselSearchText, setVesselSearchText] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("B"); // 初期状態をB列昇順に設定
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [workbookRef, setWorkbookRef] = useState<XLSX.WorkBook | null>(null);

  // Helper to format date for subject (e.g., "27 AUG 2026")
  const getSubjectDateFormatted = () => {
    const d = new Date();
    const day = d.getDate();
    const months = [
      "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
      "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
    ];
    const monthStr = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${monthStr} ${year}`;
  };

  // Helper to get normalized current user storage key
  const getUserKey = (email?: string | null) => {
    return (email || currentUser?.email || "default_user").toLowerCase().trim();
  };

  // Mail Compose Modal States (Default values per user request, persisted per user)
  const [isMailModalOpen, setIsMailModalOpen] = useState<boolean>(false);
  const [mailClient, setMailClient] = useState<"mailto" | "gmail" | "outlook">(() => {
    const userKey = getUserKey();
    try {
      const saved = localStorage.getItem(`stock_extractor_mail_client_${userKey}`);
      if (saved === "mailto" || saved === "gmail" || saved === "outlook") {
        return saved;
      }
    } catch (e) {
      console.warn("Error reading local mail client:", e);
    }
    return "gmail";
  });
  const [isSavedToastShown, setIsSavedToastShown] = useState<boolean>(false);
  const [mailTo, setMailTo] = useState<string>("operations@acetrans.gr");
  const [mailCc, setMailCc] = useState<string>("JAPAN@acetrans.gr");
  const [mailFrom, setMailFrom] = useState<string>(currentUser?.email || "kita@kit-agent.net");
  const [mailSubject, setMailSubject] = useState<string>(`STOCK LIST(${getSubjectDateFormatted()})`);
  const [mailBody, setMailBody] = useState<string>(
`Dear Sir

Stocklist attached.

Thanks and best regards.
-------------------------------------------------------------------------
TOKYO AIRCARGO CO.,LTD. (TAC)
SHIPS PARTS TEAM
osaeig1@tac-japan.co.jp
-------------------------------------------------------------------------`
  );
  const [bodyFontSize, setBodyFontSize] = useState<number>(14);
  const [copiedType, setCopiedType] = useState<"subject" | "body" | "all" | null>(null);

  // Sync sender email and load user-specific mail client preference when currentUser changes
  useEffect(() => {
    if (currentUser?.email) {
      setMailFrom(currentUser.email);
      const userKey = getUserKey(currentUser.email);

      // 1. Restore from localStorage for fast initial response
      try {
        const saved = localStorage.getItem(`stock_extractor_mail_client_${userKey}`);
        if (saved === "mailto" || saved === "gmail" || saved === "outlook") {
          setMailClient(saved);
        }
      } catch (e) {
        console.warn("Error reading local mail client:", e);
      }

      // 2. Fetch from Firestore for cross-device synchronization
      if (db) {
        getDoc(doc(db, "user_mail_prefs", userKey))
          .then((docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              if (data?.stockExtractorMailClient) {
                const client = data.stockExtractorMailClient;
                if (client === "mailto" || client === "gmail" || client === "outlook") {
                  setMailClient(client);
                  localStorage.setItem(`stock_extractor_mail_client_${userKey}`, client);
                }
              }
            }
          })
          .catch((err) => {
            console.warn("Failed to load user mail prefs from Firestore:", err);
          });
      }
    }
  }, [currentUser?.email]);

  // Handler to select and persist mail client preference per logged-in user
  const handleSelectMailClient = (client: "mailto" | "gmail" | "outlook") => {
    setMailClient(client);
    const userKey = getUserKey();

    // Persist to localStorage
    try {
      localStorage.setItem(`stock_extractor_mail_client_${userKey}`, client);
    } catch (e) {
      console.warn("Failed to save mail client to localStorage:", e);
    }

    // Persist to Firestore
    if (db && currentUser?.email) {
      setDoc(
        doc(db, "user_mail_prefs", userKey),
        {
          stockExtractorMailClient: client,
          userEmail: currentUser.email,
          userName: currentUser.name || "",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch((err) => {
        console.warn("Failed to persist user mail prefs to Firestore:", err);
      });
    }

    // Show brief saved feedback
    setIsSavedToastShown(true);
    setTimeout(() => {
      setIsSavedToastShown(false);
    }, 2000);
  };

  // Mail Compose Handlers
  const handleCopyText = (text: string, type: "subject" | "body" | "all") => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => {
      setCopiedType(null);
    }, 2000);
  };

  const handleCopyAll = () => {
    const fullText = `件名: ${mailSubject}\n\n${mailBody}`;
    navigator.clipboard.writeText(fullText);
    setCopiedType("all");
    setTimeout(() => {
      setCopiedType(null);
    }, 2000);
  };

  const handleLaunchEmailClient = () => {
    const to = encodeURIComponent(mailTo.trim());
    const cc = encodeURIComponent(mailCc.trim());
    const subject = encodeURIComponent(mailSubject.trim());
    const body = encodeURIComponent(mailBody);

    if (mailClient === "gmail") {
      // Web版 Gmail 作成画面を別タブで開く
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&cc=${cc}&su=${subject}&body=${body}`;
      window.open(gmailUrl, "_blank", "noopener,noreferrer");
    } else if (mailClient === "outlook") {
      // アプリの Outlook（PC/OSにインストールされているデスクトップアプリ）を起動
      // mailto: スキームにより、OSの既定メールアプリ（Outlook）が直接起動し、
      // 宛先・CC・件名・本文が自動挿入された新規メッセージ作成ウィンドウが開きます
      const mailtoUrl = `mailto:${mailTo.trim()}?cc=${cc}&subject=${subject}&body=${body}`;
      const tempLink = document.createElement("a");
      tempLink.href = mailtoUrl;
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
    } else {
      // 標準アプリ (mailto)
      const mailtoUrl = `mailto:${mailTo.trim()}?cc=${cc}&subject=${subject}&body=${body}`;
      const tempLink = document.createElement("a");
      tempLink.href = mailtoUrl;
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
    }
  };

  // Optional: New Outlook URI scheme launcher for users with New Outlook protocol
  const handleLaunchMsOutlookDirect = () => {
    const to = encodeURIComponent(mailTo.trim());
    const cc = encodeURIComponent(mailCc.trim());
    const subject = encodeURIComponent(mailSubject.trim());
    const body = encodeURIComponent(mailBody);
    const msOutlookUrl = `ms-outlook://compose?to=${to}&cc=${cc}&subject=${subject}&body=${body}`;
    const tempLink = document.createElement("a");
    tempLink.href = msOutlookUrl;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const vesselDropdownRef = useRef<HTMLDivElement>(null);

  // Close vessel dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (vesselDropdownRef.current && !vesselDropdownRef.current.contains(e.target as Node)) {
        setIsVesselDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Helper to parse cell value (handles formulas by returning precalculated .v or .w)
  const getCellValue = (sheet: XLSX.WorkSheet, rowIdx: number, colIdx: number): any => {
    const cellAddress = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
    const cell = sheet[cellAddress];
    if (!cell) return "";
    // If formula exists, cell.v or cell.w contains the calculated value
    if (cell.w !== undefined && cell.w !== null) {
      return cell.w;
    }
    if (cell.v !== undefined && cell.v !== null) {
      return cell.v;
    }
    return "";
  };

  // Helper to parse raw numeric weight from Q column
  const parseWeightNumber = (val: any): number | null => {
    if (val === null || val === undefined || val === "") return null;
    if (typeof val === "number") return val;
    const str = String(val).replace(/,/g, "").replace(/kg/gi, "").trim();
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
  };

  // Check if a cell is blank (empty, null, undefined, or whitespace only)
  const isCellBlank = (val: any): boolean => {
    if (val === null || val === undefined) return true;
    const str = String(val).trim();
    return str === "";
  };

  // Check if P column is 0 (0, "0", 0.0, etc.)
  const isPZero = (val: any): boolean => {
    if (val === null || val === undefined) return false;
    if (typeof val === "number" && val === 0) return true;
    const str = String(val).trim();
    if (str === "0" || str === "0.0" || str === "0.00" || str === "0.000") return true;
    const num = parseFloat(str);
    return !isNaN(num) && num === 0 && Boolean(str.match(/^[0-9.]+$/));
  };

  // Process Excel Workbook (Sheet 1)
  const processWorkbook = (wb: XLSX.WorkBook, uploadedFileName: string) => {
    setIsProcessing(true);
    try {
      setWorkbookRef(wb);
      setFileName(uploadedFileName);
      setSheetNames(wb.SheetNames);

      const targetSheetName = wb.SheetNames[0];
      setSelectedSheet(targetSheetName);
      processSheetData(wb, targetSheetName);
    } catch (error) {
      console.error("Excel解析エラー:", error);
      alert("Excelファイルの解析中にエラーが発生しました。ファイル形式をご確認ください。");
    } finally {
      setIsProcessing(false);
    }
  };

  // Process specific sheet inside workbook
  const processSheetData = (wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) {
      alert("シート内にデータが見つかりませんでした。");
      return;
    }

    const range = XLSX.utils.decode_range(sheet["!ref"]);

    // 2行目 (0-indexed: row 1) をヘッダーとして抽出
    const headers: Record<string, string> = {};
    TARGET_COLUMNS.forEach((col) => {
      const headerVal = getCellValue(sheet, 1, col.colIndex);
      headers[col.colLetter] = headerVal ? String(headerVal).trim() : `${col.colLetter}列`;
    });
    setHeaderTitles(headers);

    // 3行目以降 (0-indexed: row 2..range.e.r) をスキャン
    // セルX (0-indexed: colIndex 23) が空白の行のみ抽出
    // かつ P列 (数量) が 0 であっても、B列 (VESSEL) が空白でなければ取り込む（B列も空白の場合のみ除外）
    const B_COL_INDEX = 1; // Column B (VESSEL)
    const X_COL_INDEX = 23; // Column X (A=0, B=1, ... X=23)
    const P_COL_INDEX = 15; // Column P (数量)
    const rows: ExtractedRow[] = [];
    let scannedCount = 0;
    let shippedCount = 0;
    let pZeroCount = 0;

    for (let r = 2; r <= range.e.r; r++) {
      // Check if the entire row has at least some data
      let hasAnyDataInRow = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (!isCellBlank(getCellValue(sheet, r, c))) {
          hasAnyDataInRow = true;
          break;
        }
      }
      if (!hasAnyDataInRow) continue; // Skip completely empty trailing rows

      scannedCount++;

      // 1. X列 (出荷日) の値を確認
      const cellXVal = getCellValue(sheet, r, X_COL_INDEX);
      const isShipped = !isCellBlank(cellXVal);

      if (isShipped) {
        shippedCount++;
        continue; // セルXが入力済みのものは出荷済みのため除外
      }

      // 2. B列 (VESSEL) と P列 (数量) の値を確認
      // セルPが0であっても、セルBが空白でなければ取り込む（＝セルPが0かつセルBが空白の場合のみ除外）
      const cellBVal = getCellValue(sheet, r, B_COL_INDEX);
      const cellPVal = getCellValue(sheet, r, P_COL_INDEX);
      if (isPZero(cellPVal) && isCellBlank(cellBVal)) {
        pZeroCount++;
        continue; // P列が0かつB列が空白の行は除外
      }

      // セルXが空白（未出荷＝在庫あり）の行を抽出
      const rowData: Record<string, any> = {};
      TARGET_COLUMNS.forEach((col) => {
        const val = getCellValue(sheet, r, col.colIndex);
        rowData[col.colLetter] = val;
      });

      const cellDVal = rowData["D"];
      const hasCellD = !isCellBlank(cellDVal);

      const cellFVal = rowData["F"];

      const cellQVal = rowData["Q"];
      const numericWeight = parseWeightNumber(cellQVal);
      const isHeavy = numericWeight !== null && numericWeight >= 200;

      rows.push({
        originalRowNumber: r + 1, // 1-indexed
        data: rowData,
        cellDValue: cellDVal,
        cellFValue: cellFVal,
        cellQValue: numericWeight,
        hasCellD,
        isHeavyWeight: isHeavy,
      });
    }

    setTotalScannedRows(scannedCount);
    setShippedExcludedCount(shippedCount);
    setPZeroExcludedCount(pZeroCount);
    setExtractedRows(rows);
    setSelectedVessels([]); // Reset vessel filter on new file load
    setSortField("B"); // ファイル取り込み直後はB列で昇順ソート
    setSortOrder("asc");
  };

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readExcelFile(file);
  };

  // Read file as ArrayBuffer for SheetJS
  const readExcelFile = (file: File) => {
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, {
          type: "array",
          cellFormula: false,
          cellHTML: false,
          cellText: true,
          cellDates: true,
        });
        processWorkbook(workbook, file.name);
      } catch (err) {
        console.error("ファイル読み込みエラー:", err);
        alert("Excelファイルの読み込みに失敗しました。正しい.xlsx / .xlsmファイルであることを確認してください。");
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => {
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readExcelFile(file);
    }
  };

  // Toggle or Set Sorting on B, D, or F
  const handleToggleSort = (field: "B" | "D" | "F") => {
    if (sortField === field) {
      if (sortOrder === "asc") {
        setSortOrder("desc");
      } else {
        // Reset sort
        setSortField(null);
        setSortOrder("asc");
      }
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Unique list of VESSELs (Column B) with record count
  const vesselOptions = useMemo(() => {
    const map = new Map<string, number>();
    extractedRows.forEach((r) => {
      const v = String(r.data["B"] ?? "").trim();
      if (v) {
        map.set(v, (map.get(v) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [extractedRows]);

  // Toggle specific vessel in filter
  const handleToggleVessel = (vesselName: string) => {
    setSelectedVessels((prev) =>
      prev.includes(vesselName)
        ? prev.filter((v) => v !== vesselName)
        : [...prev, vesselName]
    );
  };

  // Select all vessels
  const handleSelectAllVessels = () => {
    setSelectedVessels(vesselOptions.map((v) => v.name));
  };

  // Clear all vessel filters
  const handleClearVesselSelection = () => {
    setSelectedVessels([]);
  };

  // Filtered vessel options for search inside dropdown
  const filteredVesselOptions = useMemo(() => {
    if (!vesselSearchText.trim()) return vesselOptions;
    const q = vesselSearchText.toLowerCase();
    return vesselOptions.filter((v) => v.name.toLowerCase().includes(q));
  }, [vesselOptions, vesselSearchText]);

  // Sorted and Filtered rows
  const sortedAndFilteredRows = useMemo(() => {
    // 1. Filter
    let rows = extractedRows.filter((row) => {
      // VESSEL multi-select filter
      if (selectedVessels.length > 0) {
        const vesselVal = String(row.data["B"] ?? "").trim();
        if (!selectedVessels.includes(vesselVal)) return false;
      }

      // Highlight filter
      if (filterHighlight === "yellow" && !row.hasCellD) return false;
      if (filterHighlight === "blue" && !row.isHeavyWeight) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match = Object.values(row.data).some((val) =>
          String(val ?? "").toLowerCase().includes(q)
        );
        if (!match) return false;
      }
      return true;
    });

    // 2. Sort
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        const valA = String(a.data[sortField] ?? "").trim();
        const valB = String(b.data[sortField] ?? "").trim();

        // Empty values always sink to the bottom
        if (!valA && valB) return 1;
        if (valA && !valB) return -1;
        if (!valA && !valB) return 0;

        const cmp = valA.localeCompare(valB, "ja", { numeric: true, sensitivity: "base" });
        return sortOrder === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [extractedRows, selectedVessels, filterHighlight, searchQuery, sortField, sortOrder]);

  // Calculate Statistics
  const yellowHighlightCount = extractedRows.filter((r) => r.hasCellD).length;
  const blueHighlightCount = extractedRows.filter((r) => r.isHeavyWeight).length;

  // Helper for current formatted date & time in English
  const getEnglishFormattedDateTime = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  };

  // Helper to compute visual display width of text (accounting for CJK / fullwidth)
  const getVisualDisplayWidth = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const str = String(val).trim();
    if (!str) return 0;
    let len = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (
        (code >= 0x3000 && code <= 0x9fff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0x4e00 && code <= 0x9fa5)
      ) {
        len += 2.0;
      } else {
        len += 1.05;
      }
    }
    return len;
  };

  // EXPORT TO EXCEL (.xlsx) - Standard SheetJS Export
  const handleDownloadExcel = () => {
    if (sortedAndFilteredRows.length === 0) {
      alert("出力対象のデータがありません。");
      return;
    }

    try {
      const exportDateTimeStr = getEnglishFormattedDateTime();
      const sheetTitle1 = "【UNSHIPPED INVENTORY LIST】";
      const sheetSubtitle = `Export Date & Time: ${exportDateTimeStr} | Total Extracted: ${sortedAndFilteredRows.length} items${sortField ? ` | Sorted by: Column ${sortField} (${sortOrder.toUpperCase()})` : ""}${selectedVessels.length > 0 ? ` | Filtered: ${selectedVessels.join(", ")}` : ""}`;

      // Column Header definitions for Row 5
      const exportHeaderRow = [
        "No",
        "VESSEL",
        "ORDER NUMBER",
        "DG",
        "INV NUMBER",
        "SUPPLIER",
        "CHECK IN DATE",
        "STOCK No",
        "NO OF PKGS",
        "TTL GW",
        "M3",
      ];

      // Data Rows starting from Row 6
      const exportDataRows = sortedAndFilteredRows.map((row, idx) => {
        return [
          idx + 1,
          row.data["B"] ?? "",
          row.data["C"] ?? "",
          row.data["D"] ?? "",
          row.data["E"] ?? "",
          row.data["F"] ?? "",
          row.data["N"] ?? "",
          row.data["O"] ?? "",
          row.data["P"] ?? "",
          row.data["Q"] ?? "",
          row.data["R"] ?? "",
        ];
      });

      // Worksheet layout:
      // Row 1: Title (A1) & Yellow Legend (D1)
      // Row 2: Blue Legend (D2)
      // Row 3: Subtitle / Meta Info (A3)
      // Row 4: Empty spacing row
      // Row 5: Table Headers (No, VESSEL, ORDER NUMBER, ...)
      // Row 6..: Detail Rows
      const wsData = [
        [sheetTitle1, "", "", "Yellow: DG Info / Remarks (Col D - Red text)", ""],
        ["", "", "", "Blue: Heavy Cargo (TTL GW >= 200kg)", ""],
        [sheetSubtitle],
        [], // Row 4 empty spacing row
        exportHeaderRow, // Row 5 Table Headers
        ...exportDataRows, // Row 6+ Data rows
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto-fit Column Widths based on 5th row header & 6th row onwards data
      const colLetterMapping = ["B", "C", "D", "E", "F", "N", "O", "P", "Q", "R"];
      const minColWidths: Record<string, number> = {
        B: 16,
        C: 16,
        D: 19,
        E: 14,
        F: 16,
        N: 15,
        O: 12,
        P: 12,
        Q: 12,
        R: 10,
      };

      const colWidths = [
        { wch: 7 }, // Col A (No)
        ...colLetterMapping.map((colKey, colIdx) => {
          if (colKey === "D") return { wch: 19 };
          const headerText = exportHeaderRow[colIdx + 1];
          let maxLen = getVisualDisplayWidth(headerText);
          sortedAndFilteredRows.forEach((r) => {
            const val = r.data[colKey];
            const valLen = getVisualDisplayWidth(val);
            if (valLen > maxLen) maxLen = valLen;
          });
          const minW = minColWidths[colKey] || 12;
          return { wch: Math.max(Math.ceil(maxLen + 3.5), minW) };
        }),
      ];
      ws["!cols"] = colWidths;

      // Create Workbook & Write
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Unshipped_Inventory");

      // Generate Clean File Name
      const baseName = fileName.replace(/\.[^/.]+$/, "");
      const dateFileStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const outputFileName = `Unshipped_Inventory_${baseName || "Stock"}_${dateFileStr}.xlsx`;

      XLSX.writeFile(wb, outputFileName);
    } catch (err) {
      console.error("Excel出力エラー:", err);
      alert("Excelファイルのダウンロード中にエラーが発生しました。");
    }
  };

  // EXPORT TO NATIVE STYLED EXCEL (.xlsx) with ExcelJS
  // Solves the "format and extension don't match" warning by generating a true OpenXML .xlsx file
  // Includes English Legends on Row 1 (D1:E1) and Row 2 (D2:E2), Row 5 Headers, and Row 6+ Data
  const handleDownloadStyledExcel = async () => {
    if (sortedAndFilteredRows.length === 0) {
      alert("出力対象のデータがありません。");
      return;
    }

    setIsProcessing(true);
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Stock Management System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Unshipped_Inventory", {
        views: [{ showGridLines: true }],
      });

      const exportDateTimeStr = getEnglishFormattedDateTime();

      // ==========================================
      // ROW 1: Title in A1, Yellow Legend in D1:E1
      // ==========================================
      const row1 = worksheet.getRow(1);
      row1.height = 26;

      // Cell A1: Title
      const cellA1 = row1.getCell(1);
      cellA1.value = "【UNSHIPPED INVENTORY LIST】";
      cellA1.font = { name: "Segoe UI", size: 13, bold: true, color: { argb: "FF0F172A" } };
      cellA1.alignment = { vertical: "middle", horizontal: "left" };

      // Format D1 & E1 for Yellow Legend
      ["D1", "E1"].forEach((addr) => {
        const c = worksheet.getCell(addr);
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF08A" },
        };
        c.border = {
          top: { style: "thin", color: { argb: "FFF59E0B" } },
          bottom: { style: "thin", color: { argb: "FFF59E0B" } },
          left: { style: "thin", color: { argb: "FFF59E0B" } },
          right: { style: "thin", color: { argb: "FFF59E0B" } },
        };
      });
      worksheet.mergeCells("D1:E1");
      const cellD1 = worksheet.getCell("D1");
      cellD1.value = "Yellow: DG Info / Remarks (Col D - Red text)";
      cellD1.font = { name: "Segoe UI", size: 9.5, bold: true, color: { argb: "FFDC2626" } };
      cellD1.alignment = { vertical: "middle", horizontal: "center" };

      // ==========================================
      // ROW 2: Blue Legend in D2:E2
      // ==========================================
      const row2 = worksheet.getRow(2);
      row2.height = 24;

      // Format D2 & E2 for Blue Legend
      ["D2", "E2"].forEach((addr) => {
        const c = worksheet.getCell(addr);
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFBAE6FD" },
        };
        c.border = {
          top: { style: "thin", color: { argb: "FF38BDF8" } },
          bottom: { style: "thin", color: { argb: "FF38BDF8" } },
          left: { style: "thin", color: { argb: "FF38BDF8" } },
          right: { style: "thin", color: { argb: "FF38BDF8" } },
        };
      });
      worksheet.mergeCells("D2:E2");
      const cellD2 = worksheet.getCell("D2");
      cellD2.value = "Blue: Heavy Cargo (TTL GW >= 200kg)";
      cellD2.font = { name: "Segoe UI", size: 9.5, bold: true, color: { argb: "FF0369A1" } };
      cellD2.alignment = { vertical: "middle", horizontal: "center" };

      // ==========================================
      // ROW 3: Export Date & Time Subtitle
      // ==========================================
      const row3 = worksheet.getRow(3);
      row3.height = 18;
      const cellA3 = row3.getCell(1);
      cellA3.value = `Export Date & Time: ${exportDateTimeStr} | Total Extracted: ${sortedAndFilteredRows.length} items${sortField ? ` | Sorted by: Column ${sortField} (${sortOrder.toUpperCase()})` : ""}${selectedVessels.length > 0 ? ` | Filtered: ${selectedVessels.join(", ")}` : ""}`;
      cellA3.font = { name: "Segoe UI", size: 9.5, italic: true, color: { argb: "FF475569" } };
      cellA3.alignment = { vertical: "middle", horizontal: "left" };

      // ==========================================
      // ROW 4: Spacing row (Empty)
      // ==========================================
      worksheet.getRow(4).height = 8;

      // ==========================================
      // ROW 5: Table Headers (5行目に配置)
      // ==========================================
      const headers = [
        "No",
        "VESSEL",
        "ORDER NUMBER",
        "DG",
        "INV NUMBER",
        "SUPPLIER",
        "CHECK IN DATE",
        "STOCK No",
        "NO OF PKGS",
        "TTL GW",
        "M3",
      ];
      const row5 = worksheet.getRow(5);
      row5.values = headers;
      row5.height = 24;

      for (let colIdx = 1; colIdx <= 11; colIdx++) {
        const cell = row5.getCell(colIdx);
        cell.font = { name: "Segoe UI", size: 10.5, bold: true, color: { argb: "FF0F172A" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF1F5F9" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          top: { style: "thin", color: { argb: "FF000000" } },
          bottom: { style: "thin", color: { argb: "FF000000" } },
          left: { style: "thin", color: { argb: "FF000000" } },
          right: { style: "thin", color: { argb: "FF000000" } },
        };
      }

      // ==========================================
      // ROW 6..N: Data Rows with Styling (6行目以降に明細を表示)
      // ==========================================
      sortedAndFilteredRows.forEach((row, idx) => {
        const rowNum = 6 + idx;
        const dataRow = worksheet.getRow(rowNum);
        const rowValues = [
          idx + 1,
          row.data["B"] ?? "",
          row.data["C"] ?? "",
          row.data["D"] ?? "",
          row.data["E"] ?? "",
          row.data["F"] ?? "",
          row.data["N"] ?? "",
          row.data["O"] ?? "",
          row.data["P"] ?? "",
          row.data["Q"] ?? "",
          row.data["R"] ?? "",
        ];
        dataRow.values = rowValues;
        dataRow.height = 20;

        // Apply Color Rules
        let fgColorArgb = "FFFFFFFF"; // White default
        let fontColorArgb = "FF000000"; // Black default
        let isBold = false;

        if (row.hasCellD) {
          // Yellow bg + Red text
          fgColorArgb = "FFFFF08A";
          fontColorArgb = "FFDC2626";
          isBold = true;
        } else if (row.isHeavyWeight) {
          // Sky Blue bg + Dark Blue text
          fgColorArgb = "FFBAE6FD";
          fontColorArgb = "FF0369A1";
          isBold = true;
        }

        for (let colIdx = 1; colIdx <= 11; colIdx++) {
          const cell = dataRow.getCell(colIdx);
          cell.font = {
            name: "Segoe UI",
            size: 10,
            bold: isBold,
            color: { argb: fontColorArgb },
          };
          if (fgColorArgb !== "FFFFFFFF") {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: fgColorArgb },
            };
          }
          cell.border = {
            top: { style: "thin", color: { argb: "FF000000" } },
            bottom: { style: "thin", color: { argb: "FF000000" } },
            left: { style: "thin", color: { argb: "FF000000" } },
            right: { style: "thin", color: { argb: "FF000000" } },
          };
          cell.alignment = {
            vertical: "middle",
            horizontal: colIdx === 1 ? "center" : "left",
          };
        }
      });

      // ==========================================
      // Auto-fit Column Widths (セルC～Kのセル幅は5行目以降の文字数を考慮して自動調整、D列は19)
      // ==========================================
      const columnConfigs = [
        { letter: "B", header: "VESSEL", minWidth: 16 },
        { letter: "C", header: "ORDER NUMBER", minWidth: 16 },
        { letter: "D", header: "DG", minWidth: 19, fixedWidth: 19 },
        { letter: "E", header: "INV NUMBER", minWidth: 14 },
        { letter: "F", header: "SUPPLIER", minWidth: 16 },
        { letter: "N", header: "CHECK IN DATE", minWidth: 15 },
        { letter: "O", header: "STOCK No", minWidth: 12 },
        { letter: "P", header: "NO OF PKGS", minWidth: 12 },
        { letter: "Q", header: "TTL GW", minWidth: 12 },
        { letter: "R", header: "M3", minWidth: 10 },
      ];

      worksheet.columns.forEach((col, idx) => {
        if (idx === 0) {
          col.width = 7; // Col A (No)
        } else if (idx === 3) {
          col.width = 19; // Col D (DG): 幅19に固定
        } else {
          const cfg = columnConfigs[idx - 1];
          if (!cfg) return;

          // 5行目のヘッダー文字数
          let maxLen = getVisualDisplayWidth(cfg.header);

          // 6行目以降の各行セルの文字数を考慮して最大幅を算出
          sortedAndFilteredRows.forEach((r) => {
            const cellVal = r.data[cfg.letter];
            const valLen = getVisualDisplayWidth(cellVal);
            if (valLen > maxLen) {
              maxLen = valLen;
            }
          });

          // 余白 (+3.5) を加えて最小幅を保証
          col.width = Math.max(Math.ceil(maxLen + 3.5), cfg.minWidth);
        }
      });

      // Write to binary buffer and download as standard .xlsx
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = fileName.replace(/\.[^/.]+$/, "");
      const dateFileStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = `Unshipped_Inventory_${baseName || "Stock"}_${dateFileStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Excel出力エラー:", err);
      alert("Excelファイルの生成中にエラーが発生しました。");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* 1. TOP CONTROL & ACTION TOOLBAR (Clean Light Header) */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 shrink-0 flex flex-wrap items-center justify-between gap-3 shadow-xs z-20">
        {/* Left: Title & File Selector */}
        <div className="flex items-center gap-3">
          {onBackToKanban && (
            <button
              type="button"
              onClick={onBackToKanban}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-xs font-bold transition-all border border-slate-300 shadow-2xs cursor-pointer"
            >
              ← カンバンへ戻る
            </button>
          )}

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 tracking-wide flex items-center gap-1.5">
                未出荷在庫データ抽出 (Excel / XLSM 解析)
              </h2>
            </div>
          </div>
        </div>

        {/* Right: Upload & Download Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer transform hover:scale-102 active:scale-98"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Excel / XLSM を選択・解析</span>
          </button>
        </div>

        {extractedRows.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMailModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-sm transition-all cursor-pointer transform hover:scale-102 active:scale-98"
              title="在庫リストの送信用メール（件名・宛先・本文）を作成・起動"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>メールで送信</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadStyledExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-sm transition-all cursor-pointer transform hover:scale-102 active:scale-98"
              title="黄色ハイライト・赤文字・水色背景・罫線等の装飾を完全に保持した警告なしのネイティブExcel形式 (.xlsx)"
            >
              <Download className="w-3.5 h-3.5 text-white" />
              <span>書式付きExcelダウンロード (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-xs font-bold transition-all border border-slate-300 shadow-2xs cursor-pointer"
              title="標準の.xlsx形式でダウンロード（シンプル表）"
            >
              <FileDown className="w-3.5 h-3.5 text-slate-600" />
              <span>標準.xlsxでダウンロード</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. STATS, MULTI-VESSEL SELECTOR, SORT & HIGHLIGHT LEGEND BAR */}
      {extractedRows.length > 0 && (
        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          {/* Left: Summary Metrics */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
              <span className="text-slate-500">解析対象:</span>
              <strong className="text-slate-800 font-mono text-xs">{fileName}</strong>
              <span className="text-slate-300">|</span>
              <span className="text-slate-500">シート:</span>
              <strong className="text-teal-700 font-bold">{selectedSheet}</strong>
            </div>

            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg">
              <span className="text-emerald-800 font-bold">未出荷・在庫抽出:</span>
              <strong className="text-emerald-700 text-sm font-black font-mono">
                {extractedRows.length} 件
              </strong>
              <span className="text-[11px] text-emerald-800">
                (総スキャン {totalScannedRows} 行 / 出荷済除外 {shippedExcludedCount} 行{pZeroExcludedCount > 0 ? ` / P列0かつB列空白除外 ${pZeroExcludedCount} 行` : ""})
              </span>
            </div>
          </div>

          {/* Center/Right: Multi-VESSEL Filter, Sort Controls, Highlight Legends & Search */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Multi-Select VESSEL Filter Dropdown */}
            <div className="relative" ref={vesselDropdownRef}>
              <button
                type="button"
                onClick={() => setIsVesselDropdownOpen(!isVesselDropdownOpen)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                  selectedVessels.length > 0
                    ? "bg-emerald-50 text-emerald-900 border-emerald-400 ring-2 ring-emerald-400/30"
                    : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                }`}
                title="VESSEL（船名・管理番号）で複数選択絞り込み"
              >
                <Ship className={`w-3.5 h-3.5 ${selectedVessels.length > 0 ? "text-emerald-600" : "text-slate-500"}`} />
                <span>VESSEL選択:</span>
                <span className={`font-black ${selectedVessels.length > 0 ? "text-emerald-700" : "text-slate-600"}`}>
                  {selectedVessels.length === 0
                    ? "すべて"
                    : `${selectedVessels.length}船 選択中`}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {/* Popover Dropdown Panel */}
              {isVesselDropdownOpen && (
                <div className="absolute left-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-300 z-50 p-2.5 text-slate-900">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-2">
                    <span className="font-extrabold text-xs text-slate-800 flex items-center gap-1.5">
                      <Ship className="w-3.5 h-3.5 text-emerald-600" />
                      VESSEL 複数選択
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsVesselDropdownOpen(false)}
                      className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Search inside VESSEL list */}
                  <div className="relative mb-2">
                    <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="VESSEL名で絞り込み..."
                      value={vesselSearchText}
                      onChange={(e) => setVesselSearchText(e.target.value)}
                      className="w-full pl-7 pr-2 py-1 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {/* Action buttons: Select All / Clear */}
                  <div className="flex items-center justify-between gap-1 mb-2 px-1 text-[11px]">
                    <button
                      type="button"
                      onClick={handleSelectAllVessels}
                      className="text-emerald-700 hover:text-emerald-900 hover:underline font-bold"
                    >
                      ✓ 全て選択 ({vesselOptions.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleClearVesselSelection}
                      className="text-slate-500 hover:text-slate-800 hover:underline"
                    >
                      選択解除
                    </button>
                  </div>

                  {/* Vessel Checklist */}
                  <div className="max-h-52 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {filteredVesselOptions.length === 0 ? (
                      <div className="text-center py-3 text-slate-400 text-xs">
                        該当するVESSELがありません
                      </div>
                    ) : (
                      filteredVesselOptions.map((v) => {
                        const isChecked = selectedVessels.includes(v.name);
                        return (
                          <label
                            key={v.name}
                            className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition-colors text-xs ${
                              isChecked
                                ? "bg-emerald-50 text-emerald-900 font-bold border border-emerald-200"
                                : "hover:bg-slate-100 text-slate-700 border border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleVessel(v.name)}
                                className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                              />
                              <span className="truncate" title={v.name}>
                                {v.name}
                              </span>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0 ml-1">
                              {v.count}件
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sort Buttons (B列 / D列 / F列) */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <span className="text-[11px] font-bold text-slate-600 px-1.5 flex items-center gap-1">
                <SortAsc className="w-3 h-3 text-slate-500" />
                ソート:
              </span>

              {/* B列 Sort Button (VESSEL) */}
              <button
                onClick={() => handleToggleSort("B")}
                className={`flex items-center gap-1 px-2 py-0.8 rounded text-xs font-bold transition-all cursor-pointer ${
                  sortField === "B"
                    ? "bg-emerald-200 text-emerald-950 font-black shadow-2xs border border-emerald-400"
                    : "text-slate-700 hover:bg-white hover:text-slate-900"
                }`}
                title="B列（VESSEL / 管理番号）でソート（昇順/降順）"
              >
                <span>B列 (VESSEL)</span>
                {sortField === "B" ? (
                  sortOrder === "asc" ? (
                    <ArrowUp className="w-3 h-3 text-emerald-800" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-emerald-800" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                )}
              </button>

              {/* D列 Sort Button */}
              <button
                onClick={() => handleToggleSort("D")}
                className={`flex items-center gap-1 px-2 py-0.8 rounded text-xs font-bold transition-all cursor-pointer ${
                  sortField === "D"
                    ? "bg-amber-200 text-red-700 font-black shadow-2xs border border-amber-400"
                    : "text-slate-700 hover:bg-white hover:text-slate-900"
                }`}
                title="D列（DG情報・特記）でソート（昇順/降順）"
              >
                <span>D列 (DG情報)</span>
                {sortField === "D" ? (
                  sortOrder === "asc" ? (
                    <ArrowUp className="w-3 h-3 text-red-600" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-red-600" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                )}
              </button>

              {/* F列 Sort Button */}
              <button
                onClick={() => handleToggleSort("F")}
                className={`flex items-center gap-1 px-2 py-0.8 rounded text-xs font-bold transition-all cursor-pointer ${
                  sortField === "F"
                    ? "bg-sky-200 text-sky-900 font-black shadow-2xs border border-sky-400"
                    : "text-slate-700 hover:bg-white hover:text-slate-900"
                }`}
                title="F列（仕向地 / SUPPLIER）でソート（昇順/降順）"
              >
                <span>F列</span>
                {sortField === "F" ? (
                  sortOrder === "asc" ? (
                    <ArrowUp className="w-3 h-3 text-sky-800" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-sky-800" />
                  )
                ) : (
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                )}
              </button>

              {sortField && (
                <button
                  onClick={() => {
                    setSortField(null);
                    setSortOrder("asc");
                  }}
                  className="px-1.5 py-0.8 text-[10px] text-slate-500 hover:text-slate-800 hover:underline"
                  title="ソート解除"
                >
                  解除
                </button>
              )}
            </div>

            {/* Rule 1 Badge: D column not blank -> Yellow bg + Red text */}
            <button
              onClick={() =>
                setFilterHighlight(filterHighlight === "yellow" ? "all" : "yellow")
              }
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-black transition-all cursor-pointer ${
                filterHighlight === "yellow"
                  ? "bg-yellow-200 text-red-700 border-red-400 ring-2 ring-yellow-400/40"
                  : "bg-yellow-50 text-red-700 border-yellow-300 hover:bg-yellow-100"
              }`}
              title="クリックでセルD入力行のみに絞り込み"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 border border-red-500 inline-block" />
              <span className="text-red-600 font-black">D列(DG情報)あり</span>
              <span className="text-[10px] font-normal text-amber-900">
                (黄背景/赤文字): {yellowHighlightCount}件
              </span>
            </button>

            {/* Rule 2 Badge: Q column >= 200kg -> Sky Blue bg */}
            <button
              onClick={() =>
                setFilterHighlight(filterHighlight === "blue" ? "all" : "blue")
              }
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-black transition-all cursor-pointer ${
                filterHighlight === "blue"
                  ? "bg-sky-200 text-sky-950 border-sky-400 ring-2 ring-sky-400/40"
                  : "bg-sky-50 text-sky-900 border-sky-300 hover:bg-sky-100"
              }`}
              title="クリックで重量200kg以上のみに絞り込み"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 border border-sky-600 inline-block" />
              <span className="text-sky-900 font-black">重量200kg以上</span>
              <span className="text-[10px] font-normal text-sky-800">
                (水色背景): {blueHighlightCount}件
              </span>
            </button>

            {(filterHighlight !== "all" || selectedVessels.length > 0) && (
              <button
                onClick={() => {
                  setFilterHighlight("all");
                  setSelectedVessels([]);
                }}
                className="px-2 py-0.5 rounded text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 border border-slate-300 font-bold cursor-pointer"
                title="全フィルターを解除"
              >
                フィルター解除
              </button>
            )}

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="抽出結果内を検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 pr-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 w-36 shadow-2xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. MAIN SPREADSHEET PREVIEW CANVAS (White Base) */}
      <div className="flex-1 overflow-hidden p-4 flex flex-col bg-slate-100">
        {extractedRows.length === 0 ? (
          // Upload Drop Zone when no file is loaded
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex-1 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-8 text-center transition-all bg-white ${
              dragOver
                ? "border-emerald-500 bg-emerald-50/50 scale-[0.99]"
                : "border-slate-300 hover:border-slate-400"
            } shadow-sm`}
          >
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-4 shadow-sm">
              <FileSpreadsheet className="w-8 h-8" />
            </div>

            <h3 className="text-base font-extrabold text-slate-900 mb-1.5">
              Excel / XLSM ファイルをここにドラッグ＆ドロップ
            </h3>
            <p className="text-xs text-slate-600 max-w-md mb-6 leading-relaxed">
              シート1の3行目以降を自動解析し、<strong>セルX（出荷日）が空白</strong>の未出荷行を抽出（P列が0でもセルBに値があれば取り込み）。
              指定列（B, C, D, E, F, N, O, P, Q, R）を白色ベースのExcelイメージで表示しダウンロードできます。
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>ファイルを選択する (.xlsx / .xlsm)</span>
              </button>
            </div>

            {/* Parsing Spec Summary Box */}
            <div className="mt-8 bg-slate-50 border border-slate-200 rounded-xl p-4 max-w-xl text-left text-xs space-y-2 text-slate-700">
              <div className="font-extrabold text-teal-800 flex items-center gap-1.5 mb-1">
                <Info className="w-4 h-4" />
                抽出＆ハイライト処理仕様:
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 text-[11px]">
                <li>
                  <strong className="text-slate-900">対象範囲:</strong> シート1（先頭シート）の2行目をタイトル、3行目以降をデータ行として解析
                </li>
                <li>
                  <strong className="text-slate-900">抽出条件:</strong> X列（出荷日）が空白のデータ（P列が0であってもB列(VESSEL)に入力があれば取り込み、P列0かつB列空白の場合のみ除外）
                </li>
                <li>
                  <strong className="text-slate-900">出力列:</strong> B, C, D, E, F, N, O, P, Q, R 列
                </li>
                <li>
                  <strong className="text-slate-900">ソート機能:</strong> B列 (VESSEL)、D列 (DG情報)、F列で昇順/降順ソート可能（Excel出力時も反映）
                </li>
                <li>
                  <strong className="text-slate-900">VESSEL絞り込み:</strong> 船名をチェックボックスで複数選択可能
                </li>
                <li>
                  <strong className="text-amber-800">ハイライト①:</strong> D列が空白ではない行 ➔ <strong>背景黄色・文字赤色</strong>
                </li>
                <li>
                  <strong className="text-sky-800">ハイライト②:</strong> Q列（重量）が200以上の行 ➔ <strong>背景水色（重たい貨物の明示）</strong>
                </li>
                <li>
                  <strong className="text-slate-900">通常行:</strong> 背景白色・文字色黒色
                </li>
              </ul>
            </div>
          </div>
        ) : (
          // SPREADSHEET TABLE GRID VIEW (Light Gray Header & Crisp High-Contrast Styling)
          <div className="flex-1 flex flex-col rounded-xl border border-slate-300 bg-white overflow-hidden shadow-sm">
            {/* Spreadsheet Table Toolbar / Header Info */}
            <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-slate-700">
                  表示中: <strong className="text-slate-950 font-black text-xs">{sortedAndFilteredRows.length}</strong> / {extractedRows.length} 件
                </span>
                {selectedVessels.length > 0 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1">
                    <Ship className="w-2.5 h-2.5 text-emerald-700" />
                    VESSEL {selectedVessels.length}船 絞込中
                  </span>
                )}
                {sortField && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-teal-100 text-teal-900 border border-teal-300 flex items-center gap-1">
                    <SortAsc className="w-2.5 h-2.5 text-teal-700" />
                    {sortField}列ソート ({sortOrder === "asc" ? "昇順 ▲" : "降順 ▼"})
                  </span>
                )}
                {filterHighlight !== "all" && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                    ハイライト絞込中
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-700 font-medium">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-yellow-200 inline-block border border-red-400" />
                  <span className="text-red-700 font-bold">D列あり (黄+赤字)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-sky-200 inline-block border border-sky-400" />
                  <span className="text-sky-900 font-bold">Q列200以上 (水色)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-white inline-block border border-slate-300" />
                  <span className="text-slate-900 font-bold">通常行 (白+黒字)</span>
                </span>
              </div>
            </div>

            {/* Scrollable Spreadsheet Table */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left border-collapse font-sans text-xs">
                {/* 1st Header: Excel Column Letters (B, C, D...) - Light Gray Background & High Contrast Bold Text */}
                <thead className="sticky top-0 z-10 shadow-xs">
                  <tr className="border-b border-slate-300 text-xs font-mono bg-slate-200">
                    <th className="p-2.5 w-12 text-center bg-slate-300/90 border-r border-slate-300 text-slate-900 font-black">
                      No
                    </th>
                    {TARGET_COLUMNS.map((col) => {
                      const isSortable = col.colLetter === "B" || col.colLetter === "D" || col.colLetter === "F";
                      const isCurrentlySorted = sortField === col.colLetter;

                      return (
                        <th
                          key={col.colLetter}
                          onClick={() => {
                            if (isSortable) handleToggleSort(col.colLetter as "B" | "D" | "F");
                          }}
                          className={`p-2.5 font-black text-center border-r border-slate-300 transition-colors ${
                            isSortable ? "cursor-pointer hover:bg-slate-300 select-none" : ""
                          } ${
                            col.colLetter === "D"
                              ? "bg-yellow-100 text-red-900"
                              : col.colLetter === "B"
                              ? "bg-emerald-100/90 text-emerald-950"
                              : col.colLetter === "F"
                              ? "bg-sky-100 text-sky-950"
                              : col.colLetter === "Q"
                              ? "bg-blue-100/90 text-blue-950"
                              : "bg-slate-200 text-slate-900"
                          }`}
                        >
                          <div className="flex items-center justify-center gap-1 text-xs">
                            <span className="font-black text-slate-900">{col.colLetter}列</span>
                            {isSortable && (
                              <span className="inline-block">
                                {isCurrentlySorted ? (
                                  sortOrder === "asc" ? (
                                    <ArrowUp className="w-3.5 h-3.5 text-slate-900 stroke-[3]" />
                                  ) : (
                                    <ArrowDown className="w-3.5 h-3.5 text-slate-900 stroke-[3]" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 text-slate-600" />
                                )}
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>

                  {/* 2nd Header: Title from 2nd row of original Excel - Light Gray, Larger Font, Bold, Dark Crisp Text */}
                  <tr className="border-b-2 border-slate-400 bg-slate-100 text-slate-950 text-[13px] font-black">
                    <th className="p-2.5 text-center bg-slate-200 border-r border-slate-300 text-slate-900 text-xs font-black">
                      #
                    </th>
                    {TARGET_COLUMNS.map((col) => {
                      const isSortable = col.colLetter === "B" || col.colLetter === "D" || col.colLetter === "F";
                      const isCurrentlySorted = sortField === col.colLetter;
                      const titleText = headerTitles[col.colLetter] || `${col.colLetter}列`;

                      return (
                        <th
                          key={col.colLetter}
                          onClick={() => {
                            if (isSortable) handleToggleSort(col.colLetter as "B" | "D" | "F");
                          }}
                          className={`p-3 border-r border-slate-300 whitespace-nowrap text-slate-950 ${
                            isSortable ? "cursor-pointer hover:bg-slate-200/90 select-none" : ""
                          } ${
                            col.colLetter === "D"
                              ? "bg-yellow-200/80 text-red-900 border-b-2 border-yellow-500"
                              : col.colLetter === "B"
                              ? "bg-emerald-100/70 text-emerald-950 border-b-2 border-emerald-400"
                              : col.colLetter === "F"
                              ? "bg-sky-200/70 text-sky-950 border-b-2 border-sky-400"
                              : col.colLetter === "Q"
                              ? "bg-blue-100 text-blue-950 border-b-2 border-blue-400"
                              : "bg-slate-100 text-slate-950"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-black tracking-tight text-slate-950">
                              {titleText}
                            </span>
                            {isSortable && (
                              <span className="text-[10px] px-1 py-0.2 rounded bg-white/80 border border-slate-300 text-slate-700 font-bold shrink-0">
                                {isCurrentlySorted ? (sortOrder === "asc" ? "昇順 ▲" : "降順 ▼") : "ソート可"}
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* Table Body (Data Rows with White Base and Conditional Styling) */}
                <tbody className="divide-y divide-slate-200">
                  {sortedAndFilteredRows.map((row, idx) => {
                    const isYellowHighlight = row.hasCellD;
                    const isBlueHighlight = row.isHeavyWeight;

                    // Row style classes:
                    // - Base is white with black text
                    // - D is not blank -> Yellow highlight, Red text
                    // - Q >= 200 -> Sky blue highlight, Dark Blue text
                    let rowBgClass = "bg-white hover:bg-slate-50 text-black";
                    let textColorClass = "text-black";

                    if (isYellowHighlight) {
                      rowBgClass = "bg-yellow-200 hover:bg-yellow-300 text-red-600 font-bold";
                      textColorClass = "text-red-600 font-bold";
                    } else if (isBlueHighlight) {
                      rowBgClass = "bg-sky-100 hover:bg-sky-200 text-sky-950 font-bold";
                      textColorClass = "text-sky-950 font-bold";
                    }

                    return (
                      <tr
                        key={idx}
                        className={`transition-colors border-b border-slate-200 ${rowBgClass}`}
                      >
                        {/* Index Number */}
                        <td
                          className={`p-2.5 text-center font-mono text-xs border-r border-slate-200 select-none ${
                            isYellowHighlight
                              ? "bg-yellow-300/80 text-red-700 font-bold"
                              : isBlueHighlight
                              ? "bg-sky-200/80 text-sky-950 font-bold"
                              : "bg-slate-50 text-slate-700 font-bold"
                          }`}
                        >
                          {idx + 1}
                        </td>

                        {/* Extracted Columns (B, C, D, E, F, N, O, P, Q, R) */}
                        {TARGET_COLUMNS.map((col) => {
                          const val = row.data[col.colLetter];
                          const displayVal =
                            val !== null && val !== undefined ? String(val) : "";

                          const isColD = col.colLetter === "D";
                          const isColQ = col.colLetter === "Q";
                          const isColB = col.colLetter === "B";

                          return (
                            <td
                              key={col.colLetter}
                              className={`p-2.5 border-r border-slate-200 font-medium ${textColorClass} ${
                                isColD && isYellowHighlight
                                  ? "bg-yellow-300 font-black underline decoration-red-500 text-red-700"
                                  : isColQ && isBlueHighlight
                                  ? "bg-sky-200 font-black text-sky-950"
                                  : isColB
                                  ? "font-bold"
                                  : ""
                              }`}
                            >
                              {displayVal || (
                                <span className="text-slate-400 italic text-[10px]">
                                  -
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 4. MAIL COMPOSE MODAL (White Base / Black Text / Editable Fields) */}
      {isMailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col text-slate-900 animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 leading-tight">
                    在庫リスト送信メール作成
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    STOCK LIST: 送信用メール下書き（宛先・CC・件名・本文は修正可能です）
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMailModalOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 flex items-center justify-center transition-colors cursor-pointer"
                title="閉じる"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content Scrollable Area */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Email Client Selector (Personal Settings) */}
              <div className="bg-slate-100/90 border border-slate-200 p-3 rounded-xl flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                    <Settings2 className="w-4 h-4 text-blue-600" />
                    <span>起動メールソフト (個人設定):</span>
                  </div>
                  {currentUser?.email && (
                    <span className="text-[10px] text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full font-mono">
                      {currentUser.name || currentUser.email}
                    </span>
                  )}
                  {isSavedToastShown && (
                    <span className="text-[10px] text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 animate-in fade-in">
                      <Check className="w-3 h-3" />
                      個人設定を保存しました
                    </span>
                  )}
                </div>
                <div className="inline-flex rounded-lg bg-slate-200 p-0.5 border border-slate-300">
                  <button
                    type="button"
                    onClick={() => handleSelectMailClient("mailto")}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                      mailClient === "mailto"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    標準アプリ (mailto)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectMailClient("gmail")}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                      mailClient === "gmail"
                        ? "bg-red-600 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Gmail
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectMailClient("outlook")}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                      mailClient === "outlook"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Outlook
                  </button>
                </div>
              </div>

              {mailClient === "outlook" && (
                <div className="bg-blue-50/70 border border-blue-200 rounded-lg px-3 py-2 text-[11px] text-blue-900 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>PCにインストールされている<strong>Outlookデスクトップアプリ</strong>を直接起動します（宛先・CC・件名・本文が自動挿入されます）。</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLaunchMsOutlookDirect}
                    className="text-[10px] text-blue-600 hover:text-blue-800 underline font-bold cursor-pointer"
                    title="Windows New Outlook専用URIスキームで開く"
                  >
                    New Outlook専用リンクで起動
                  </button>
                </div>
              )}

              {/* Sender (From) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">送信元 (From)</label>
                  <span className="text-[11px] text-slate-400">ログインユーザー / 修正可</span>
                </div>
                <input
                  type="email"
                  value={mailFrom}
                  onChange={(e) => setMailFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                  placeholder="送信元メールアドレス"
                />
              </div>

              {/* Recipient (To) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">宛先 (To)</label>
                  <span className="text-[11px] text-slate-500">手入力・修正可</span>
                </div>
                <input
                  type="text"
                  value={mailTo}
                  onChange={(e) => setMailTo(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none font-bold"
                  placeholder="operations@acetrans.gr"
                />
              </div>

              {/* CC */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">CC</label>
                  <span className="text-[11px] text-slate-500">セミコロン (;) 区切りで追加・編集可</span>
                </div>
                <input
                  type="text"
                  value={mailCc}
                  onChange={(e) => setMailCc(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                  placeholder="JAPAN@acetrans.gr"
                />
              </div>

              {/* Subject */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">件名 (Subject)</label>
                  <button
                    type="button"
                    onClick={() => handleCopyText(mailSubject, "subject")}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-bold hover:underline cursor-pointer"
                  >
                    {copiedType === "subject" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">件名をコピー完了!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>件名のみコピー</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  type="text"
                  value={mailSubject}
                  onChange={(e) => setMailSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-bold text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                  placeholder="STOCK LIST (日付)"
                />
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <label className="font-bold text-slate-700 inline-flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      <span>メール本文 (Body)</span>
                    </label>

                    {/* Font size picker */}
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      <span>文字サイズ:</span>
                      {[12, 14, 16, 18, 20].map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setBodyFontSize(sz)}
                          className={`w-6 h-5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                            bodyFontSize === sz
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyText(mailBody, "body")}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-bold hover:underline cursor-pointer"
                  >
                    {copiedType === "body" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">本文をコピー完了!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>本文のみコピー</span>
                      </>
                    )}
                  </button>
                </div>

                <textarea
                  value={mailBody}
                  onChange={(e) => setMailBody(e.target.value)}
                  style={{ fontSize: `${bodyFontSize}px` }}
                  className="w-full h-48 p-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono leading-relaxed focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none resize-y"
                  placeholder="メール本文を入力..."
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={handleCopyAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold border border-slate-300 shadow-2xs transition-all cursor-pointer"
              >
                {copiedType === "all" ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">件名+本文を一括コピーしました!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-600" />
                    <span>件名+本文を一括コピー</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMailModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-300 shadow-2xs transition-all cursor-pointer"
                >
                  閉じる
                </button>

                <button
                  type="button"
                  onClick={handleLaunchEmailClient}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-black shadow-sm transition-all cursor-pointer transform hover:scale-102 active:scale-98 ${
                    mailClient === "gmail"
                      ? "bg-red-600 hover:bg-red-700"
                      : mailClient === "outlook"
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>
                    {mailClient === "gmail"
                      ? "Gmailで開く"
                      : mailClient === "outlook"
                      ? "Outlookアプリを起動"
                      : "メールソフトを起動"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
