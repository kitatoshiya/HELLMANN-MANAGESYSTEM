/**
 * File utility helpers for clean original file names and safe downloads
 */

/**
 * Extracts and cleans the original filename from a given title or URL,
 * removing any prefixes like "📎 添付:" and size suffixes like "(24.5 KB)".
 */
export function getCleanFilename(title: string, url?: string): string {
  if (!title) {
    if (url && !url.startsWith("data:") && !url.startsWith("blob:")) {
      try {
        const parts = url.split("/");
        const last = parts[parts.length - 1].split("?")[0];
        if (last) return decodeURIComponent(last);
      } catch {
        // ignore
      }
    }
    return "attachment";
  }

  // 1. Remove leading attachment icons and text prefixes
  let clean = title
    .replace(/^📎\s*/g, "")
    .replace(/^添付\s*[:：]?\s*/gi, "")
    .replace(/^📎\s*添付\s*[:：]?\s*/gi, "")
    .trim();

  // 2. Remove file size suffixes: e.g. " (24.5 KB)", " (120 B)", " [1.2 MB]", "(2.5MB)"
  clean = clean
    .replace(/[\s_]*[\(\[]\s*[\d.]+\s*(?:B|Bytes?|KB|MB|GB|TB)\s*[\)\]]$/i, "")
    .trim();

  // 3. Handle cases where the size suffix was inserted before extension: e.g. "file (24.5 KB).xlsx"
  clean = clean.replace(
    /[\s_]*[\(\[]\s*[\d.]+\s*(?:B|Bytes?|KB|MB|GB|TB)\s*[\)\]](\.[a-zA-Z0-9]+)$/i,
    "$1"
  );

  // 4. Remove any remaining trailing size-like annotations
  clean = clean.replace(/\s*\(\s*\d+\s*(?:bytes?|kb|mb|gb)\s*\)/i, "").trim();

  if (clean) return clean;

  if (url && !url.startsWith("data:") && !url.startsWith("blob:")) {
    try {
      const parts = url.split("/");
      const last = parts[parts.length - 1].split("?")[0];
      if (last) return decodeURIComponent(last);
    } catch {
      // ignore
    }
  }

  return "attachment";
}

/**
 * Initiates a browser download for a file using its clean original filename.
 */
export function triggerFileDownload(title: string, url?: string): void {
  if (!url) return;
  const fileName = getCleanFilename(title, url);

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 200);
  } catch (err) {
    console.error("Failed to trigger download:", err);
    window.open(url, "_blank");
  }
}
