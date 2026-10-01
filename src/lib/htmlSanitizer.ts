import { EmailAttachment } from '../types';

/**
 * Sanitize email HTML content and resolve `cid:` (Content-ID) inline images to base64 data URLs
 * while preserving fonts, font sizes, colors, inline styles, tables, line breaks, and formatting.
 */
export function sanitizeEmailHtml(html: string | undefined | null, attachments?: EmailAttachment[]): string {
  if (!html) return '';

  let sanitized = html;

  // 1. Remove dangerous script and iframe elements for safety
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // 2. Resolve `cid:` (Content-ID) inline image references
  sanitized = sanitized.replace(/src=["']cid:([^"']+)["']/gi, (_match, rawCid) => {
    const cleanedCid = (rawCid || '').replace(/^<|>$/g, '').trim();
    const cleanLower = cleanedCid.toLowerCase();

    if (attachments && attachments.length > 0) {
      const matchedAtt = attachments.find((att) => {
        if (!att) return false;
        const attId = ((att.id || '') as string).replace(/^<|>$/g, '').trim().toLowerCase();
        const attName = ((att.fileName || (att as any).name || '') as string).replace(/^<|>$/g, '').trim().toLowerCase();
        const attCid = (((att as any).contentId || (att as any).cid || '') as string).replace(/^<|>$/g, '').trim().toLowerCase();

        // Exact match
        if (attCid && (attCid === cleanLower || cleanLower.includes(attCid) || attCid.includes(cleanLower))) return true;
        if (attId && (attId === cleanLower || cleanLower.includes(attId) || attId.includes(cleanLower))) return true;
        if (attName && (attName === cleanLower || cleanLower.includes(attName) || attName.includes(cleanLower))) return true;

        // Strip prefix/suffix match (e.g. image001.png@01DB... -> image001.png)
        const baseCidName = cleanLower.split('@')[0];
        if (baseCidName && (attName === baseCidName || attId === baseCidName)) return true;

        return false;
      });

      if (matchedAtt) {
        const dataUrl = matchedAtt.dataUrl || (matchedAtt.contentBytes ? `data:${matchedAtt.contentType || 'image/png'};base64,${matchedAtt.contentBytes}` : undefined);
        if (dataUrl) {
          return `src="${dataUrl}" data-cid="${cleanedCid}" style="max-width:100%;height:auto;display:inline-block;"`;
        }
      }
    }

    // Fallback: If no matching attachment found, use transparent placeholder
    return `src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E" data-unresolved-cid="${cleanedCid}" style="max-width:100%;height:auto;display:inline-block;"`;
  });

  // 3. Ensure images don't overflow their containers and have safe referrer policies
  sanitized = sanitized.replace(/<img\b([^>]*)>/gi, (match, attributes) => {
    if (!attributes.includes('referrerpolicy')) {
      attributes += ' referrerpolicy="no-referrer"';
    }
    if (!attributes.includes('loading')) {
      attributes += ' loading="lazy"';
    }
    return `<img ${attributes.trim()}>`;
  });

  return sanitized;
}
