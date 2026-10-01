import ExcelJS from 'exceljs';
import { Shipment } from '../types';

/**
 * Format Date to YYYY/MM/DD HH:mm for issue timestamp
 */
function getFormattedCurrentTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

/**
 * Helper to extract numeric values from pieces/weight strings like "100 CTN" or "1250.5 kg"
 */
function parseNumericValue(valStr: string | null | undefined): number {
  if (!valStr) return 0;
  // Extract digits and optional decimal point
  const match = valStr.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return 0;
}

/**
 * Generates and downloads a stylish, business-ready Excel file (.xlsx) for the selected date shipment schedule.
 * Uses a cool dark-blue header theme with sharp black borders, perfect for warehouse FAX printouts.
 */
export async function exportShipmentsToExcel(selectedDateLabel: string, selectedDateKey: string, shipments: Shipment[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '輸出入進捗管理システム';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('輸出一覧情報', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    views: [{ showGridLines: true }],
  });

  // Calculate totals
  const totalCount = shipments.length;
  let totalPiecesNum = 0;
  let totalWeightNum = 0;

  shipments.forEach((s) => {
    totalPiecesNum += parseNumericValue(s.pieces);
    totalWeightNum += parseNumericValue(s.grossWeight);
  });

  const nowFormatted = getFormattedCurrentTimestamp();

  // Column Width Definitions
  worksheet.columns = [
    { key: 'no', width: 6 }, // A: No.
    { key: 'mawb', width: 18 }, // B: MAWB番号
    { key: 'hawb', width: 18 }, // C: HAWB番号
    { key: 'shipper', width: 28 }, // D: SHIPPER名
    { key: 'consignee', width: 28 }, // E: CONSIGNEE名
    { key: 'destination', width: 22 }, // F: 向地 (フライト/ルート)
    { key: 'pcsWeight', width: 22 }, // G: 個数・重量
    { key: 'memo', width: 24 }, // H: メモ欄 (手書き用)
  ];

  // Colors
  const NAVY_HEADER_BG = '1E3A8A'; // Deep Navy Blue
  const SUB_HEADER_BG = '2563EB'; // Royal Blue
  const METRIC_BG = 'EFF6FF'; // Soft Light Blue
  const ZEBLA_BG = 'F8FAFC'; // Light Slate Tint
  const BLACK_BORDER_COLOR = '000000';

  const blackThinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
    left: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
    bottom: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
    right: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
  };

  const blackMediumBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'medium', color: { argb: BLACK_BORDER_COLOR } },
    left: { style: 'medium', color: { argb: BLACK_BORDER_COLOR } },
    bottom: { style: 'medium', color: { argb: BLACK_BORDER_COLOR } },
    right: { style: 'medium', color: { argb: BLACK_BORDER_COLOR } },
  };

  // Row 1: Top spacing
  worksheet.addRow([]);

  // Row 2: Header Title & Issue Timestamp
  worksheet.mergeCells('A2:F2');
  const titleCell = worksheet.getCell('A2');
  titleCell.value = `【出荷・入庫予定】${selectedDateLabel} 輸出一覧情報`;
  titleCell.font = { name: 'Meiryo', size: 16, bold: true, color: { argb: 'FFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: NAVY_HEADER_BG },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  worksheet.mergeCells('G2:H2');
  const issueCell = worksheet.getCell('G2');
  issueCell.value = `発行日時: ${nowFormatted}`;
  issueCell.font = { name: 'Meiryo', size: 10, bold: true, color: { argb: 'FFFFFF' } };
  issueCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: NAVY_HEADER_BG },
  };
  issueCell.alignment = { vertical: 'middle', horizontal: 'right' };

  worksheet.getRow(2).height = 36;

  // Apply borders to title bar
  ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2'].forEach((cellRef) => {
    worksheet.getCell(cellRef).border = blackMediumBorder;
  });

  // Row 3: Spacing
  worksheet.addRow([]);

  // Row 4-5: Executive Metric Summary Box
  worksheet.mergeCells('A4:B4');
  const m1Header = worksheet.getCell('A4');
  m1Header.value = '総件数 (TOTAL SHIPMENTS)';
  m1Header.font = { name: 'Meiryo', size: 9, bold: true, color: { argb: 'FFFFFF' } };
  m1Header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_HEADER_BG } };
  m1Header.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.mergeCells('C4:E4');
  const m2Header = worksheet.getCell('C4');
  m2Header.value = '総個数 (TOTAL PIECES)';
  m2Header.font = { name: 'Meiryo', size: 9, bold: true, color: { argb: 'FFFFFF' } };
  m2Header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_HEADER_BG } };
  m2Header.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.mergeCells('F4:H4');
  const m3Header = worksheet.getCell('F4');
  m3Header.value = '総重量 (TOTAL GROSS WEIGHT)';
  m3Header.font = { name: 'Meiryo', size: 9, bold: true, color: { argb: 'FFFFFF' } };
  m3Header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_HEADER_BG } };
  m3Header.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.getRow(4).height = 20;

  worksheet.mergeCells('A5:B5');
  const m1Val = worksheet.getCell('A5');
  m1Val.value = `${totalCount} 件`;
  m1Val.font = { name: 'Meiryo', size: 14, bold: true, color: { argb: '1E3A8A' } };
  m1Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: METRIC_BG } };
  m1Val.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.mergeCells('C5:E5');
  const m2Val = worksheet.getCell('C5');
  m2Val.value = totalPiecesNum > 0 ? `${totalPiecesNum.toLocaleString()} pcs` : '-';
  m2Val.font = { name: 'Meiryo', size: 14, bold: true, color: { argb: '1E3A8A' } };
  m2Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: METRIC_BG } };
  m2Val.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.mergeCells('F5:H5');
  const m3Val = worksheet.getCell('F5');
  m3Val.value = totalWeightNum > 0 ? `${totalWeightNum.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg` : '-';
  m3Val.font = { name: 'Meiryo', size: 14, bold: true, color: { argb: '1E3A8A' } };
  m3Val.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: METRIC_BG } };
  m3Val.alignment = { vertical: 'middle', horizontal: 'center' };

  worksheet.getRow(5).height = 28;

  // Metric borders
  ['A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5'].forEach((ref) => {
    worksheet.getCell(ref).border = blackThinBorder;
  });

  // Row 6: Spacing
  worksheet.addRow([]);

  // Row 7: Main Table Header Row
  const headers = [
    'No.',
    'MAWB番号',
    'HAWB番号',
    'SHIPPER名 (出荷元)',
    'CONSIGNEE名 (納入先)',
    '積地・向地(DEST)',
    '個数・重量',
    'メモ欄 (倉庫現場用)',
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 26;

  headerRow.eachCell((cell) => {
    cell.font = { name: 'Meiryo', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_HEADER_BG } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = blackThinBorder;
  });

  // Data Rows (Starting Row 8)
  shipments.forEach((shipment, index) => {
    const isEven = index % 2 === 1;
    const rowBgColor = isEven ? ZEBLA_BG : 'FFFFFF';

    const pcsWeightStr =
      shipment.pieces || shipment.grossWeight
        ? `${shipment.pieces || '-'} / ${shipment.grossWeight || '-'}`
        : '未設定';

    const routeStr = `${shipment.portOfLoading || 'NRT'} → ${shipment.destination || shipment.consignee || 'DEST'}`;

    const rowData = [
      index + 1,
      shipment.mawbNumber || '',
      shipment.hawbNumber || '',
      shipment.shipper || '',
      shipment.consignee || '',
      routeStr,
      pcsWeightStr,
      '', // Blank for handwriting notes on warehouse printout
    ];

    const row = worksheet.addRow(rowData);
    row.height = 24;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Meiryo', size: 9.5, color: { argb: '000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgColor } };
      cell.border = blackThinBorder;

      // Alignments
      if (colNumber === 1) {
        // No.
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Meiryo', size: 9.5, bold: true };
      } else if (colNumber === 2 || colNumber === 3) {
        // MAWB / HAWB
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (colNumber === 4 || colNumber === 5 || colNumber === 6) {
        // Shipper / Consignee / Flight
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      } else if (colNumber === 7) {
        // Pieces / Weight
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Meiryo', size: 9.5, bold: true, color: { argb: '1E3A8A' } };
      } else if (colNumber === 8) {
        // Memo
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    });
  });

  // Total Summary Footer Row
  const totalRowIndex = 8 + shipments.length;
  worksheet.mergeCells(`A${totalRowIndex}:F${totalRowIndex}`);
  const totalLabelCell = worksheet.getCell(`A${totalRowIndex}`);
  totalLabelCell.value = '合計 (TOTAL)';
  totalLabelCell.font = { name: 'Meiryo', size: 10, bold: true, color: { argb: '000000' } };
  totalLabelCell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
  totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

  const totalPcsWeightCell = worksheet.getCell(`G${totalRowIndex}`);
  totalPcsWeightCell.value = `${totalPiecesNum > 0 ? totalPiecesNum.toLocaleString() + ' pcs' : '-'} / ${
    totalWeightNum > 0 ? totalWeightNum.toLocaleString(undefined, { minimumFractionDigits: 1 }) + ' kg' : '-'
  }`;
  totalPcsWeightCell.font = { name: 'Meiryo', size: 10, bold: true, color: { argb: '1E3A8A' } };
  totalPcsWeightCell.alignment = { vertical: 'middle', horizontal: 'center' };
  totalPcsWeightCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

  const totalMemoCell = worksheet.getCell(`H${totalRowIndex}`);
  totalMemoCell.value = '';
  totalMemoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

  worksheet.getRow(totalRowIndex).height = 24;

  // Double border for total row
  const doubleBottomBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
    left: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
    bottom: { style: 'double', color: { argb: BLACK_BORDER_COLOR } },
    right: { style: 'thin', color: { argb: BLACK_BORDER_COLOR } },
  };

  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((col) => {
    worksheet.getCell(`${col}${totalRowIndex}`).border = doubleBottomBorder;
  });

  // Generate buffer and trigger browser download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileNameDate = selectedDateKey.replace(/-/g, '');
  a.download = `輸出一覧情報_${fileNameDate}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
