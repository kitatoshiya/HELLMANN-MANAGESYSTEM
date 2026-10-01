import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Send,
  Building2,
  Ship,
  FileText,
  Calendar,
  Globe2,
  FileSpreadsheet,
  Flag,
  Users,
  Copy,
  Check,
  Sparkles,
  ExternalLink,
  Sliders,
  CheckSquare,
  Square,
  Mail,
  Table as TableIcon,
  Image as ImageIcon,
  Bold,
  Trash2,
} from "lucide-react";
import {
  Supplier,
  SupplierContact,
  SupplierInquiryTemplate,
  SharedMailMessage,
  AppTheme,
} from "../types";
import { convertTsvToHtmlTable } from "../lib/excelParser";

interface SupplierInquiryModalProps {
  isOpen: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  templates: SupplierInquiryTemplate[];
  currentTheme: AppTheme;
  initialSupplierId?: string;
  initialPattern?: number;
  initialSourceEmail?: SharedMailMessage | null;
  onOpenSupplierMaster: () => void;
  onOpenTemplateSettings: () => void;
  onApplyToCompose: (params: {
    to: string[];
    cc: string[];
    subject: string;
    bodyHtml: string;
    supplier?: Supplier;
  }) => void;
}

export const SupplierInquiryModal: React.FC<SupplierInquiryModalProps> = ({
  isOpen,
  onClose,
  suppliers,
  templates,
  currentTheme,
  initialSupplierId,
  initialPattern,
  initialSourceEmail,
  onOpenSupplierMaster,
  onOpenTemplateSettings,
  onApplyToCompose,
}) => {
  // Selection State
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [selectedContactEmails, setSelectedContactEmails] = useState<string[]>([]);
  const [selectedPatternNumber, setSelectedPatternNumber] = useState<number>(1);

  // Form Fields for template substitution
  const [vesselName, setVesselName] = useState<string>("");
  const [orderNo, setOrderNo] = useState<string>("");
  const [invoiceNo, setInvoiceNo] = useState<string>("");
  const [destination, setDestination] = useState<string>("");
  const [customsDate, setCustomsDate] = useState<string>("");
  const [flag, setFlag] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [inquiryDetails, setInquiryDetails] = useState<string>("");
  const [additionalCc, setAdditionalCc] = useState<string>("");
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // Inquiry Details Rich Editor Ref & Image Upload
  const inquiryEditorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize or update when modal opens or initial values change
  useEffect(() => {
    if (!isOpen) return;

    // Default supplier selection
    if (initialSupplierId && suppliers.some((s) => s.id === initialSupplierId)) {
      setSelectedSupplierId(initialSupplierId);
    } else if (suppliers.length > 0) {
      setSelectedSupplierId(suppliers[0].id);
    }

    // Default pattern selection
    if (initialPattern) {
      setSelectedPatternNumber(initialPattern);
    } else {
      setSelectedPatternNumber(1);
    }

    // Check if opened with a specific source email (Detail View button) vs. Header button (no source email)
    if (initialSourceEmail) {
      const subject = initialSourceEmail.subject || "";
      const body =
        initialSourceEmail.bodyText ||
        initialSourceEmail.bodyHtml ||
        initialSourceEmail.bodyPreview ||
        "";

      // Extract vessel
      const vesselMatch =
        subject.match(/(?:本船|Vessel|M\/V|M\/T|MV|MT)\s*[:：\s]?\s*([A-Za-z0-9\s\.\-_]+?)(?=[,/；;・【\[\(\n]|$)/i) ||
        body.match(/(?:本船名|Vessel\s*Name|Vessel)\s*[:：\s]?\s*([A-Za-z0-9\s\.\-_]+?)(?=[,/；;\n<]|$)/i);
      setVesselName(vesselMatch && vesselMatch[1]?.trim() ? vesselMatch[1].trim() : "");

      // Extract order No
      const orderMatch =
        subject.match(/(?:Order\s*No|PO\s*No|オーダー|発注番号|受注番号)\s*[:：\s#]?\s*([A-Za-z0-9\-_/]+)/i) ||
        body.match(/(?:Order\s*No|PO\s*No|オーダーNo|発注No)\s*[:：\s#]?\s*([A-Za-z0-9\-_/]+)/i);
      setOrderNo(orderMatch && orderMatch[1]?.trim() ? orderMatch[1].trim() : "");

      // Extract invoice No
      const invMatch =
        subject.match(/(?:Invoice\s*No|INV\s*No|インボイス)\s*[:：\s#]?\s*([A-Za-z0-9\-_/]+)/i) ||
        body.match(/(?:Invoice\s*No|INV\s*No|インボイスNo)\s*[:：\s#]?\s*([A-Za-z0-9\-_/]+)/i);
      setInvoiceNo(invMatch && invMatch[1]?.trim() ? invMatch[1].trim() : "");

      setDestination("");
      setCustomsDate("");
      setFlag("");
      setDeliveryDate("");

      // Populate inquiry details with relevant snippet of customer email
      const snippet = body
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/g, " ")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 15)
        .join("\n");

      if (snippet) {
        const initialHtml = `<p><strong>【転記元メール (${initialSourceEmail.from.name || initialSourceEmail.from.email})】</strong></p><p>${snippet.replace(/\n/g, "<br>")}</p>`;
        setInquiryDetails(initialHtml);
        if (inquiryEditorRef.current) {
          inquiryEditorRef.current.innerHTML = initialHtml;
        }
      } else {
        setInquiryDetails("");
        if (inquiryEditorRef.current) {
          inquiryEditorRef.current.innerHTML = "";
        }
      }
    } else {
      // HEADER BUTTON CLICKED: Clear all fields, do NOT reflect any source email!
      setVesselName("");
      setOrderNo("");
      setInvoiceNo("");
      setDestination("");
      setCustomsDate("");
      setFlag("");
      setDeliveryDate("");
      setInquiryDetails("");
      if (inquiryEditorRef.current) {
        inquiryEditorRef.current.innerHTML = "";
      }
    }
  }, [isOpen, initialSupplierId, initialPattern, initialSourceEmail, suppliers]);

  // When selected supplier changes, auto-select their contacts & default pattern & default CC
  const currentSupplier = useMemo(() => {
    return suppliers.find((s) => s.id === selectedSupplierId) || suppliers[0];
  }, [suppliers, selectedSupplierId]);

  useEffect(() => {
    if (!currentSupplier) return;

    // Pick contacts
    if (currentSupplier.contacts && currentSupplier.contacts.length > 0) {
      const primary = currentSupplier.contacts.find((c) => c.isPrimary);
      if (primary && primary.email) {
        setSelectedContactEmails([primary.email]);
      } else {
        const firstWithEmail = currentSupplier.contacts.find((c) => c.email);
        if (firstWithEmail) {
          setSelectedContactEmails([firstWithEmail.email]);
        }
      }
    } else {
      setSelectedContactEmails([]);
    }

    // If supplier has default pattern, apply it if pattern wasn't explicitly set from caller
    if (!initialPattern && currentSupplier.defaultPattern) {
      setSelectedPatternNumber(currentSupplier.defaultPattern);
    }

    // Set default CC
    if (currentSupplier.defaultCcEmails && currentSupplier.defaultCcEmails.length > 0) {
      setAdditionalCc(currentSupplier.defaultCcEmails.join(", "));
    }
  }, [currentSupplier, initialPattern]);

  // Sync state to inquiryEditor innerHTML if changed externally
  useEffect(() => {
    if (inquiryEditorRef.current && inquiryEditorRef.current.innerHTML !== inquiryDetails) {
      inquiryEditorRef.current.innerHTML = inquiryDetails || "";
    }
  }, [inquiryDetails]);

  // Selected template
  const currentTemplate = useMemo(() => {
    return (
      templates.find((t) => t.patternNumber === selectedPatternNumber) ||
      templates[0] || {
        id: "fallback",
        patternNumber: 1,
        category: "quote",
        title: "見積・納期問合せ",
        description: "",
        subjectTemplate: "【見積依頼】本船: {vesselName} / オーダーNo: {orderNo}",
        bodyHtmlTemplate: "<p>{supplierName} {contactName} 様</p><p>{inquiryDetails}</p>",
        updatedAt: "",
      }
    );
  }, [templates, selectedPatternNumber]);

  // Contact name string for display
  const selectedContactNames = useMemo(() => {
    if (!currentSupplier || !currentSupplier.contacts) return "";
    const names = currentSupplier.contacts
      .filter((c) => selectedContactEmails.includes(c.email))
      .map((c) => c.name || c.email);
    return names.join("・") || "ご担当者";
  }, [currentSupplier, selectedContactEmails]);

  // Formatted Subject & HTML Body
  const generatedSubject = useMemo(() => {
    let s = currentTemplate.subjectTemplate || "【問合せ】";
    s = s.replace(/{vesselName}/g, vesselName || "（本船名未入力）");
    s = s.replace(/{orderNo}/g, orderNo || "（オーダーNo未入力）");
    s = s.replace(/{invoiceNo}/g, invoiceNo || "（インボイスNo未入力）");
    s = s.replace(/{destination}/g, destination || "（向け地未入力）");
    s = s.replace(/{customsDate}/g, customsDate || "（通関日未入力）");
    s = s.replace(/{flag}/g, flag || "（船籍未入力）");
    s = s.replace(/{deliveryDate}/g, deliveryDate || "（希望納期未入力）");
    s = s.replace(/{supplierName}/g, currentSupplier?.name || "サプライヤー");
    s = s.replace(/{contactName}/g, selectedContactNames || "ご担当者");
    return s;
  }, [
    currentTemplate,
    vesselName,
    orderNo,
    invoiceNo,
    destination,
    customsDate,
    flag,
    deliveryDate,
    currentSupplier,
    selectedContactNames,
  ]);

  const generatedBodyHtml = useMemo(() => {
    let b = currentTemplate.bodyHtmlTemplate || "";

    // Replace basic variables
    b = b.replace(/{vesselName}/g, vesselName ? `<strong>${vesselName}</strong>` : "（本船名未入力）");
    b = b.replace(/{orderNo}/g, orderNo ? `<strong>${orderNo}</strong>` : "（オーダーNo未入力）");
    b = b.replace(/{invoiceNo}/g, invoiceNo ? `<strong>${invoiceNo}</strong>` : "（インボイスNo未入力）");
    b = b.replace(/{destination}/g, destination ? `<strong>${destination}</strong>` : "（向け地未入力）");
    b = b.replace(/{customsDate}/g, customsDate ? `<strong>${customsDate}</strong>` : "（通関予定日未入力）");
    b = b.replace(/{flag}/g, flag ? `<strong>${flag}</strong>` : "（船籍未入力）");
    b = b.replace(/{deliveryDate}/g, deliveryDate ? `<strong>${deliveryDate}</strong>` : "（希望納期未入力）");
    b = b.replace(/{supplierName}/g, currentSupplier?.name || "サプライヤー御中");
    b = b.replace(/{contactName}/g, selectedContactNames || "ご担当者");

    // Format inquiry details HTML (keep table & images intact)
    const formattedDetails = inquiryDetails
      ? inquiryDetails
      : "<p style='color: #64748b;'><em>【問合せ対象品目・明細表・画像をここに入力】</em></p>";

    b = b.replace(/{inquiryDetails}/g, formattedDetails);
    return b;
  }, [
    currentTemplate,
    vesselName,
    orderNo,
    invoiceNo,
    destination,
    customsDate,
    flag,
    deliveryDate,
    currentSupplier,
    selectedContactNames,
    inquiryDetails,
  ]);

  // Handle contact toggle
  const handleToggleContact = (email: string) => {
    setSelectedContactEmails((prev) => {
      if (prev.includes(email)) {
        return prev.filter((e) => e !== email);
      } else {
        return [...prev, email];
      }
    });
  };

  const handleSelectAllContacts = () => {
    if (!currentSupplier || !currentSupplier.contacts) return;
    const allEmails = currentSupplier.contacts
      .map((c) => c.email)
      .filter(Boolean) as string[];
    setSelectedContactEmails(allEmails);
  };

  // Copy full generated email text
  const handleCopySubjectAndBody = async () => {
    const textToCopy = `件名: ${generatedSubject}\n宛先: ${selectedContactEmails.join(", ")}\nCC: ${additionalCc}\n\n${generatedBodyHtml.replace(/<br\s*[\/]?>/gi, "\n").replace(/<[^>]+>/g, "")}`;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2000);
    } catch {
      // fallback
    }
  };

  // Handle Rich Paste into Inquiry Details Editor (Excel TSV Table & Image clipboard)
  const handleEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Check for Image in clipboard (Screenshot / copy-paste image)
    const items = clipboardData.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (uploadEvent) => {
              const base64Img = uploadEvent.target?.result as string;
              if (base64Img) {
                insertHtmlAtCursor(
                  `<div style="margin: 8px 0;"><img src="${base64Img}" alt="添付画像" style="max-width: 100%; height: auto; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" /></div><br>`
                );
              }
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      }
    }

    const textData = clipboardData.getData("text/plain");
    const htmlData = clipboardData.getData("text/html");

    // 2. Check for Excel / TSV tabular copy-paste
    if (textData && textData.includes("\t")) {
      e.preventDefault();
      const tableHtml = convertTsvToHtmlTable(textData);
      insertHtmlAtCursor(tableHtml);
      return;
    }

    // 3. HTML table copy (from web / other rich tables)
    if (htmlData && (htmlData.includes("<table") || htmlData.includes("<tr"))) {
      e.preventDefault();
      // Ensure border styles on copied HTML table
      const styledHtml = htmlData
        .replace(/<table/gi, '<table class="table-styled" style="border-collapse: collapse; width: 100%; border: 1px solid #cbd5e1; margin: 8px 0;"')
        .replace(/<th/gi, '<th style="border: 1px solid #cbd5e1; padding: 6px 10px; background-color: #f1f5f9; color: #0f172a; font-weight: bold;"')
        .replace(/<td/gi, '<td style="border: 1px solid #cbd5e1; padding: 6px 10px; color: #0f172a;"');
      insertHtmlAtCursor(styledHtml);
      return;
    }

    // 4. Plain text paste (preserve line breaks)
    if (textData) {
      e.preventDefault();
      const formattedText = textData.replace(/\n/g, "<br>");
      document.execCommand("insertHTML", false, formattedText);
      if (inquiryEditorRef.current) {
        setInquiryDetails(inquiryEditorRef.current.innerHTML);
      }
    }
  };

  // Helper to insert HTML at current cursor location or append
  const insertHtmlAtCursor = (html: string) => {
    if (inquiryEditorRef.current) {
      inquiryEditorRef.current.focus();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const el = document.createElement("div");
        el.innerHTML = html;
        const frag = document.createDocumentFragment();
        let node: Node | null;
        let lastNode: Node | null = null;
        while ((node = el.firstChild)) {
          lastNode = frag.appendChild(node);
        }
        range.insertNode(frag);
        if (lastNode) {
          range.setStartAfter(lastNode);
          range.setEndAfter(lastNode);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else {
        inquiryEditorRef.current.innerHTML += html;
      }
      setInquiryDetails(inquiryEditorRef.current.innerHTML);
    }
  };

  // Insert Shipping Packing / Spec Table Template
  const handleInsertShippingTable = () => {
    const shippingTableHtml = `
      <div style="margin: 8px 0; overflow-x: auto;">
        <table style="border-collapse: collapse; width: 100%; font-size: 11px; border: 1px solid #cbd5e1; background-color: #ffffff; text-align: left;">
          <thead>
            <tr style="background-color: #e2e8f0; color: #0f172a; font-weight: bold; border-bottom: 2px solid #94a3b8;">
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">No.</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">品名 (Item Name / Part No.)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">数量</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">個数 (Packages)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">総重量 (G.W. kg)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">容積 (M3 / 梱包サイズ)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">発送元・備考</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #cbd5e1;">
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">1</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold;">FUEL INJECTION VALVE ASSY</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">2 SET</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">1 CARTON</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">24.5 KG</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">45 x 30 x 25 cm</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">東京倉庫より出荷</td>
            </tr>
            <tr style="border-bottom: 1px solid #cbd5e1; background-color: #f8fafc;">
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">2</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold;">O-RING SET (VITON)</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">5 SET</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">（同包）</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">0.8 KG</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">-</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">メーカー直送</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p><br></p>
    `;
    insertHtmlAtCursor(shippingTableHtml);
  };

  // Insert Quote Item Table Template
  const handleInsertQuoteTable = () => {
    const quoteTableHtml = `
      <div style="margin: 8px 0; overflow-x: auto;">
        <table style="border-collapse: collapse; width: 100%; font-size: 11px; border: 1px solid #cbd5e1; background-color: #ffffff; text-align: left;">
          <thead>
            <tr style="background-color: #e2e8f0; color: #0f172a; font-weight: bold; border-bottom: 2px solid #94a3b8;">
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">Item</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">品名 (Description)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">図番 / 部品番号 (Part No.)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">数量</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">見積単価 (希望)</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px;">納期回答欄</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #cbd5e1;">
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">1</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold;">CYLINDER HEAD GASKET</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">DWG: 1234-A / POS: 12</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">4 PCS</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">-</td>
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; color: #2563eb;">至急納期確認希望</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p><br></p>
    `;
    insertHtmlAtCursor(quoteTableHtml);
  };

  // Handle local image file upload
  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (base64) {
          insertHtmlAtCursor(
            `<div style="margin: 8px 0;"><img src="${base64}" alt="${file.name}" style="max-width: 100%; height: auto; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" /><p style="font-size: 10px; color: #64748b; margin-top: 2px;">📎 ${file.name}</p></div><br>`
          );
        }
      };
      reader.readAsDataURL(file);
    }
    // reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Apply to compose email
  const handleApply = () => {
    const ccList = additionalCc
      ? additionalCc
          .split(/[,;\n]/)
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

    onApplyToCompose({
      to: selectedContactEmails,
      cc: ccList,
      subject: generatedSubject,
      bodyHtml: generatedBodyHtml,
      supplier: currentSupplier,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 animate-in fade-in duration-150">
      <div
        className={`w-full max-w-6xl max-h-[94vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden transition-all ${
          currentTheme === "light"
            ? "bg-white border-slate-300 text-slate-900"
            : "bg-slate-900 border-slate-700 text-slate-100"
        }`}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-inherit flex items-center justify-between shrink-0 bg-slate-100/90 dark:bg-slate-800/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black">
                  サプライヤー問合せアシスタント
                </h3>
                {initialSourceEmail ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-600 text-white shadow-2xs flex items-center gap-1">
                    <Mail className="w-3 h-3" /> メール連動モード
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-600 text-white shadow-2xs flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> 新規問合せ（非連動）
                  </span>
                )}
              </div>
              <p className="text-[11px] opacity-75">
                {initialSourceEmail
                  ? "選択中メールの情報を取り込み、サプライヤーへの問合せひな型を構成します。"
                  : "サプライヤーと問合せパターンを選択し、Excel表や画像を貼付して素早くメールを構成します。"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSupplierMaster}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
              title="サプライヤーマスタの追加・編集"
            >
              <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>サプライヤーマスタ</span>
            </button>
            <button
              type="button"
              onClick={onOpenTemplateSettings}
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
              title="問合せパターンのひな型文章をカスタマイズ"
            >
              <Sliders className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>ひな型設定</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Layout: 2 Columns (Left: Configuration & Parameters, Right: Live Preview) */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Column: Selection & Parameters */}
          <div className="w-full lg:w-[48%] flex flex-col border-r border-inherit overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar bg-slate-50/40 dark:bg-slate-950/20 text-xs">
            {/* Step 1: Supplier & Contacts */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-extrabold text-sm text-slate-900 dark:text-white">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center">
                    1
                  </span>
                  <span>サプライヤー選択 & 宛先担当者 (最大5名)</span>
                </div>
                <button
                  type="button"
                  onClick={onOpenSupplierMaster}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-bold flex items-center gap-0.5"
                >
                  マスタ編集 <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Supplier Dropdown */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                  問合せ先サプライヤー
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border font-bold text-xs ${
                    currentTheme === "light"
                      ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white"
                      : "bg-slate-800 border-slate-700 text-white"
                  }`}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.code ? `(${s.code})` : ""} — 担当者 {s.contacts?.length || 0}名
                    </option>
                  ))}
                </select>
              </div>

              {/* Contacts Selection Chips */}
              {currentSupplier && currentSupplier.contacts && currentSupplier.contacts.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      送信先担当者を選択（複数選択可）:
                    </span>
                    {currentSupplier.contacts.length > 1 && (
                      <button
                        type="button"
                        onClick={handleSelectAllContacts}
                        className="text-[10px] text-blue-600 font-bold hover:underline"
                      >
                        全員選択 ({currentSupplier.contacts.length}名)
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {currentSupplier.contacts.map((contact, idx) => {
                      const isChecked = selectedContactEmails.includes(contact.email);
                      return (
                        <div
                          key={contact.id || idx}
                          onClick={() => handleToggleContact(contact.email)}
                          className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer transition-all ${
                            isChecked
                              ? "bg-blue-50 dark:bg-blue-950/60 border-blue-400 dark:border-blue-600 text-blue-950 dark:text-blue-100 ring-1 ring-blue-400"
                              : "bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          <div className="shrink-0 text-blue-600 dark:text-blue-400">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="font-extrabold text-xs truncate">
                                {contact.name || "（担当者名未設定）"}
                              </span>
                              {contact.isPrimary && (
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300">
                                  主担当
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono">
                              {contact.email || "メール未登録"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Supplier Notes if any */}
              {currentSupplier?.notes && (
                <div className="p-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-900 dark:text-amber-300 flex items-start gap-1.5">
                  <span className="font-bold shrink-0">📝 メモ:</span>
                  <span>{currentSupplier.notes}</span>
                </div>
              )}
            </div>

            {/* Step 2: Inquiry Pattern Selection */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-extrabold text-sm text-slate-900 dark:text-white">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center">
                    2
                  </span>
                  <span>問合せパターン選択</span>
                </div>
                <button
                  type="button"
                  onClick={onOpenTemplateSettings}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-bold flex items-center gap-0.5"
                >
                  ひな型文章変更 <Sliders className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {templates.map((tpl) => {
                  const isSelected = selectedPatternNumber === tpl.patternNumber;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedPatternNumber(tpl.patternNumber)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-400"
                          : currentTheme === "light"
                          ? "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800"
                          : "bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className={`w-4 h-4 rounded-full text-[10px] font-black flex items-center justify-center ${
                            isSelected ? "bg-white text-blue-600" : "bg-blue-600 text-white"
                          }`}
                        >
                          {tpl.patternNumber}
                        </span>
                        <span className="font-extrabold text-xs line-clamp-1">{tpl.title}</span>
                      </div>
                      <p
                        className={`text-[10px] line-clamp-2 ${
                          isSelected ? "text-blue-100" : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {tpl.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Inquiry Input Fields */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-xs">
              <div className="flex items-center gap-1.5 font-extrabold text-sm text-slate-900 dark:text-white">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center">
                  3
                </span>
                <span>問合せパラメータ（本船・オーダー・通関・向け地）</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Vessel Name */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                    <Ship className="w-3.5 h-3.5 text-blue-600" />
                    本船名 (Vessel Name)
                  </label>
                  <input
                    type="text"
                    placeholder="例: M/T PACIFIC LEADER"
                    value={vesselName}
                    onChange={(e) => setVesselName(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border font-bold text-xs ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>

                {/* Order No */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    オーダーNo (Order No)
                  </label>
                  <input
                    type="text"
                    placeholder="例: ORD-2026-0914-TK"
                    value={orderNo}
                    onChange={(e) => setOrderNo(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border font-bold text-xs ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>

                {/* Pattern 3 & 1 special: Destination */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                    <Globe2 className="w-3.5 h-3.5 text-cyan-600" />
                    向け地 (Destination)
                  </label>
                  <input
                    type="text"
                    placeholder="例: SIN (Singapore), RTM, 成田"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>

                {/* Customs Date */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                    <Calendar className="w-3.5 h-3.5 text-amber-600" />
                    通関予定日 / 納期希望日
                  </label>
                  <input
                    type="text"
                    placeholder="例: 2026-09-20 または 来週火曜"
                    value={customsDate || deliveryDate}
                    onChange={(e) => {
                      setCustomsDate(e.target.value);
                      setDeliveryDate(e.target.value);
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>

                {/* Pattern 3 special: Invoice No */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                    インボイスNo (Invoice No)
                  </label>
                  <input
                    type="text"
                    placeholder="例: INV-TAC-2026-8890"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>

                {/* Pattern 3 special: FLAG */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                    <Flag className="w-3.5 h-3.5 text-rose-600" />
                    船籍 (FLAG)
                  </label>
                  <input
                    type="text"
                    placeholder="例: Panama, Liberia, Japan"
                    value={flag}
                    onChange={(e) => setFlag(e.target.value)}
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                      currentTheme === "light"
                        ? "bg-white border-slate-300 text-slate-950"
                        : "bg-slate-800 border-slate-700 text-slate-100"
                    }`}
                  />
                </div>
              </div>

              {/* Enhanced Inquiry Details Area with Excel Tables, Images, and Rich Formatting */}
              <div className="space-y-1.5 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <label className="font-extrabold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>【対象品目・数量・図番 / お問い合わせ内容】</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                      Excel表・画像貼付対応
                    </span>
                  </label>
                  <span className="text-[10px] text-slate-500">
                    ※Excelからコピーした表や画像（Ctrl+V）を直接貼り付けできます
                  </span>
                </div>

                {/* Rich Editor Toolbar */}
                <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-t-lg border-t border-x border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80">
                  <button
                    type="button"
                    onClick={handleInsertShippingTable}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 shadow-2xs transition-colors cursor-pointer"
                    title="出荷問合せ用 梱包・重量・容積明細表を挿入"
                  >
                    <TableIcon className="w-3.5 h-3.5 text-emerald-600" />
                    <span>+ 出荷梱包表</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleInsertQuoteTable}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-[11px] font-bold text-blue-800 dark:text-blue-300 shadow-2xs transition-colors cursor-pointer"
                    title="見積・品目明細表を挿入"
                  >
                    <TableIcon className="w-3.5 h-3.5 text-blue-600" />
                    <span>+ 見積品目表</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-[11px] font-bold text-purple-800 dark:text-purple-300 shadow-2xs transition-colors cursor-pointer"
                    title="図面や写真などの画像をアップロード挿入"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-purple-600" />
                    <span>+ 画像添付</span>
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageFileUpload}
                  />

                  <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-0.5" />

                  <button
                    type="button"
                    onClick={() => document.execCommand("bold")}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors"
                    title="太字 (Bold)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (inquiryEditorRef.current) {
                        inquiryEditorRef.current.innerHTML = "";
                        setInquiryDetails("");
                      }
                    }}
                    className="ml-auto p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 transition-colors"
                    title="入力欄をクリア"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* ContentEditable Rich Area with border & shadow */}
                <div
                  ref={inquiryEditorRef}
                  contentEditable
                  onPaste={handleEditorPaste}
                  onInput={(e) => {
                    setInquiryDetails(e.currentTarget.innerHTML);
                  }}
                  className={`min-h-[140px] max-h-[260px] overflow-y-auto p-3 rounded-b-lg border-b border-x font-sans text-xs leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 transition-all custom-scrollbar ${
                    currentTheme === "light"
                      ? "bg-white border-slate-300 text-slate-900 shadow-inner"
                      : "bg-slate-800 border-slate-700 text-slate-100 shadow-inner"
                  }`}
                  style={{
                    wordBreak: "break-word",
                  }}
                />
              </div>

              {/* CC Address */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                  CCメールアドレス (カンマ区切りで複数指定可)
                </label>
                <input
                  type="text"
                  placeholder="marine-team@tac-japan.co.jp, ..."
                  value={additionalCc}
                  onChange={(e) => setAdditionalCc(e.target.value)}
                  className={`w-full px-2.5 py-1.5 rounded-lg border font-mono text-xs ${
                    currentTheme === "light"
                      ? "bg-white border-slate-300 text-slate-950"
                      : "bg-slate-800 border-slate-700 text-slate-100"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Right Column: Live Email Preview & Action Button */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white text-slate-900 border-t lg:border-t-0 lg:border-l border-slate-200 generated-email-preview">
            {/* Header info */}
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-100 text-slate-900 generated-email-preview-header">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600" />
                <span className="font-extrabold text-xs text-slate-900">
                  生成メール プレビュー
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopySubjectAndBody}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-800 transition-colors cursor-pointer shadow-2xs"
              >
                {copiedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600 font-bold">コピー完了</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-600" />
                    <span>テキストコピー</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Message Header Fields */}
            <div className="p-4 border-b border-slate-200 space-y-2 bg-slate-50 text-xs shrink-0 font-sans text-slate-900 generated-email-preview-fields">
              <div className="flex items-start gap-2">
                <span className="w-14 font-bold text-slate-600 shrink-0 text-right">宛先 (To):</span>
                <div className="flex-1 flex flex-wrap gap-1 items-center">
                  {selectedContactEmails.length === 0 ? (
                    <span className="text-rose-600 font-bold">※宛先担当者が未選択です</span>
                  ) : (
                    selectedContactEmails.map((em) => (
                      <span
                        key={em}
                        className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 font-bold font-mono text-[11px] border border-blue-200"
                      >
                        {em}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {additionalCc && (
                <div className="flex items-start gap-2">
                  <span className="w-14 font-bold text-slate-600 shrink-0 text-right">CC:</span>
                  <div className="flex-1 text-slate-700 font-mono text-[11px]">
                    {additionalCc}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 pt-1.5 border-t border-slate-200">
                <span className="w-14 font-bold text-slate-600 shrink-0 text-right">件名:</span>
                <div className="flex-1 font-extrabold text-slate-900 text-sm">
                  {generatedSubject}
                </div>
              </div>
            </div>

            {/* Live HTML Body Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar bg-white text-slate-900 generated-email-preview-body">
              <div
                className="text-xs leading-relaxed text-slate-900 preview-content space-y-2 bg-white"
                dangerouslySetInnerHTML={{ __html: generatedBodyHtml }}
              />
            </div>

            {/* Bottom Action Footer */}
            <div
              className={`p-4 border-t flex items-center justify-between shrink-0 ${
                currentTheme === "light"
                  ? "bg-slate-100 border-slate-200"
                  : "bg-slate-900 border-slate-800"
              }`}
            >
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                キャンセル
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={selectedContactEmails.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-md hover:shadow-lg transition-all active:scale-98 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>メール作成画面に反映して確認・送信</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
