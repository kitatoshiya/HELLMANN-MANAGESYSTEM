import * as XLSX from "xlsx";

export interface ExcelWarningDetail {
  fileName: string;
  sheetName: string;
  keywordCell: string;
  keywordText: string;
  valueCell: string;
  valueText: string;
}

/**
 * Checks an array of file items for Excel attachments.
 * Inspects Sheet 1 of each Excel file.
 * Returns warning details if "Detection" or "X-RAY" is found near "1500".
 */
export async function checkExcelFilesForWarnings(
  files: { name: string; url: string; rawFile?: File }[]
): Promise<ExcelWarningDetail[]> {
  const warnings: ExcelWarningDetail[] = [];

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    const isExcel =
      lowerName.endsWith(".xlsx") ||
      lowerName.endsWith(".xls") ||
      lowerName.endsWith(".xlsm") ||
      lowerName.endsWith(".csv");

    if (!isExcel) continue;

    try {
      let workbook: XLSX.WorkBook | null = null;

      if (file.rawFile) {
        const buffer = await file.rawFile.arrayBuffer();
        workbook = XLSX.read(buffer, { type: "array" });
      } else if (file.url && file.url.startsWith("data:")) {
        const base64Str = file.url.split(",")[1];
        if (base64Str) {
          workbook = XLSX.read(base64Str, { type: "base64" });
        }
      }

      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        continue;
      }

      // Check Sheet 1 (first sheet)
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      if (!sheet) continue;

      // Convert sheet to 2D array matrix: header: 1 means array of arrays
      const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      // Pattern to match "Detection" or "X-RAY" / "XRAY"
      const keywordRegex = /detection|x-?ray/i;

      // Iterate through grid
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] ?? "").trim();
          if (!val) continue;

          if (keywordRegex.test(val)) {
            // Found keyword at cell (r, c). Check nearby cells within offset (dr: -3..3, dc: -3..3)
            let foundWarningInRange = false;

            for (let dr = -3; dr <= 3; dr++) {
              for (let dc = -3; dc <= 3; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr < 0 || nr >= grid.length) continue;
                const targetRow = grid[nr] || [];
                if (nc < 0 || nc >= targetRow.length) continue;

                const targetVal = String(targetRow[nc] ?? "").trim();
                // Check if targetVal contains "1500"
                if (targetVal.includes("1500")) {
                  const kwCellAddress = XLSX.utils.encode_cell({ r, c });
                  const valCellAddress = XLSX.utils.encode_cell({ r: nr, c: nc });

                  warnings.push({
                    fileName: file.name,
                    sheetName: firstSheetName,
                    keywordCell: kwCellAddress,
                    keywordText: val,
                    valueCell: valCellAddress,
                    valueText: targetVal,
                  });

                  foundWarningInRange = true;
                  break;
                }
              }
              if (foundWarningInRange) break;
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error parsing Excel file ${file.name}:`, err);
    }
  }

  return warnings;
}
