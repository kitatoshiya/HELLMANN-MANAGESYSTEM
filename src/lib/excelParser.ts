/**
 * Converts TSV (Tab Separated Values from Excel copy paste) or HTML into styled HTML Table with clear borders
 */
export function convertTsvToHtmlTable(text: string): string {
  if (!text || typeof text !== "string") return "";

  // If text has no tabs and no newlines, escape and return
  if (!text.includes("\t") && !text.includes("\n")) {
    return escapeHtml(text);
  }

  const rawLines = text.split(/\r?\n/);
  if (rawLines.length === 0) return escapeHtml(text);

  // Check if at least one line contains tab
  const hasTabs = rawLines.some((line) => line.includes("\t"));
  if (!hasTabs) {
    // Return standard text formatted with paragraphs/linebreaks
    return rawLines
      .map((line) => (line.trim() === "" ? "<br>" : `<p class="my-1 text-slate-900" style="color: #0f172a; margin-top: 0.25rem; margin-bottom: 0.25rem;">${escapeHtml(line)}</p>`))
      .join("");
  }

  type Chunk = { type: "text"; lines: string[] } | { type: "table"; lines: string[] };
  const chunks: Chunk[] = [];
  let currentChunk: Chunk | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const isTableLine = line.includes("\t");

    if (isTableLine) {
      if (currentChunk && currentChunk.type === "table") {
        currentChunk.lines.push(line);
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = { type: "table", lines: [line] };
      }
    } else {
      if (currentChunk && currentChunk.type === "text") {
        currentChunk.lines.push(line);
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = { type: "text", lines: [line] };
      }
    }
  }
  if (currentChunk) chunks.push(currentChunk);

  let resultHtml = "";

  chunks.forEach((chunk) => {
    if (chunk.type === "text") {
      // Process plain text lines outside tables
      chunk.lines.forEach((line) => {
        if (line.trim() === "") {
          resultHtml += "<br>";
        } else {
          resultHtml += `<p class="my-1 text-slate-900" style="color: #0f172a; margin-top: 0.25rem; margin-bottom: 0.25rem;">${escapeHtml(line)}</p>`;
        }
      });
    } else if (chunk.type === "table") {
      // Process table block (tabbed lines) with uniform clean borders and white background (no title row shading)
      let tableHtml = `<div class="overflow-x-auto my-3 rounded-lg border border-slate-300 bg-white shadow-xs"><table class="excel-table w-full text-xs text-left border-collapse" style="border-collapse: collapse; border: 1px solid #cbd5e1; background-color: #ffffff;"><tbody>`;

      chunk.lines.forEach((line) => {
        const cells = line.split("\t");
        tableHtml += `<tr class="bg-white border-b border-slate-300" style="background-color: #ffffff;">`;

        cells.forEach((cellText) => {
          const escaped = escapeHtml(cellText.trim());
          tableHtml += `<td class="px-3 py-1.5 border border-slate-300 text-slate-900 whitespace-nowrap" style="border: 1px solid #cbd5e1; background-color: #ffffff; color: #0f172a;">${escaped || "&nbsp;"}</td>`;
        });

        tableHtml += `</tr>`;
      });

      tableHtml += `</tbody></table></div>`;
      resultHtml += tableHtml;
    }
  });

  return resultHtml;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Copy plain text or HTML content to clipboard with fallback
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    // Strips HTML tags if copying rich HTML text to plain text clipboard
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = content;
    const plainText = tempDiv.innerText || tempDiv.textContent || content;

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(plainText);
      return true;
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = plainText;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error("Copy to clipboard failed:", err);
    return false;
  }
}
