import { Shipment } from '../types';

/**
 * Air Waybill (MAWB / HAWB) formatting and sanitization utilities
 */

/**
 * Normalizes MAWB to the standard IATA forwarder format: 3-digit airline prefix + single hyphen + 8 digits
 * e.g. "189-0435-8045" -> "189-04358045"
 * e.g. "189 04358045"   -> "189-04358045"
 * e.g. "18904358045"    -> "189-04358045"
 */
export function normalizeMawbNumber(mawb: string | null | undefined): string {
  if (!mawb) return '';
  const str = String(mawb).trim();

  // Pattern: 3 digits, hyphen/space, 4 digits, hyphen/space, 4 digits (e.g. 189-0435-8045)
  const m344 = str.match(/^(\d{3})[-\s](\d{4})[-\s](\d{4})$/);
  if (m344) {
    return `${m344[1]}-${m344[2]}${m344[3]}`;
  }

  // Pattern: 3 digits, optional hyphen/space, 8 digits (e.g. 189-04358045 or 18904358045)
  const m38 = str.match(/^(\d{3})[-\s]?(\d{8})$/);
  if (m38) {
    return `${m38[1]}-${m38[2]}`;
  }

  return str;
}

/**
 * Checks if a string is an email address, email account/username, or department/user identifier
 */
export function isEmailOrAccountIdentifier(str: string): boolean {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  
  // 1. Contains @ or looks like full email (e.g. user@domain.com, <user@domain.com>)
  if (s.includes('@') || /<[^>]+@[^>]+>/.test(s)) {
    return true;
  }

  // 2. Email domain patterns (e.g. tac-japan.co.jp, hellmann.com, gmail.com)
  if (/\.(?:co\.jp|ne\.jp|or\.jp|ac\.jp|go\.jp|com|net|org|io|jp|de|cn|hk|sg|us)$/i.test(s)) {
    return true;
  }

  // 3. Common email account / office / sales department prefix/suffix patterns
  // e.g. osasales2, osasales, tyosales, nrtsales, kixsales, ngosales, sales, info, support, cs, ops, customs
  if (/^(?:osa|tyo|nrt|kix|ngo|hnd|sin|hkg|bkk|tac|hlm)?(?:sales|team|staff|office|desk|admin|cs|ops|op|user|mail|info|contact|customs|import|export)\d*$/i.test(s)) {
    return true;
  }

  // 4. Known specific system / staff email handles
  const knownHandles = [
    'osasales2', 'osasales', 'tyosales', 'nrtsales', 'kixsales',
    'shirana', 'kitatoshiya', 'kita', 'rio.tsutsui', 'hms-jp',
    'tac-hellmann', 'tacjapan', 'tac-japan', 'hellmann'
  ];
  if (knownHandles.includes(s)) {
    return true;
  }

  // 5. Contains Japanese characters (department names, person names, e.g. 大阪 営業2, 通関課)
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str)) {
    return true;
  }

  // 6. Starts with mailto: or http: or https:
  if (/^(?:mailto:|http:\/\/|https:\/\/)/i.test(s)) {
    return true;
  }

  return false;
}

/**
 * Clean and validate HAWB string
 */
export function cleanHawbNumber(hawb: string | null | undefined): string | null {
  if (!hawb) return null;
  let str = String(hawb).trim();
  
  // Strip surrounding brackets/quotes
  str = str.replace(/^[<"'\(\[]+|[>"'\)\]]+$/g, '').trim();
  if (!str) return null;

  const lower = str.toLowerCase();

  // Reject email addresses, usernames, and department names
  if (isEmailOrAccountIdentifier(str)) {
    return null;
  }

  // Common non-HAWB placeholder texts
  if (
    [
      'なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', '',
      '直截', 'direct', '直截マスター', 'hose', 'house', 'home', 'hold',
      'hours', 'hour', 'item', 'items', 'total', 'goods', 'order',
      'subject', 'email', 'mail', 'message', 'forwarder', 'flight',
      'pieces', 'weight', 'hawb', 'mawb', 'awb',
      '未設定', '未設定(直截等)', '未設定(直裁等)'
    ].includes(lower) ||
    lower.includes('なし (直截)') ||
    lower.startsWith('なし') ||
    lower.startsWith('未設定') ||
    lower.includes('未設定')
  ) {
    return null;
  }

  // Pure letters with no numbers and no hyphens (e.g. "osaka", "tokyo", "general")
  if (/^[a-z]{3,15}$/i.test(str)) {
    return null;
  }

  return str;
}

/**
 * Clean Order Number string (remove "なし", "null", or duplicate HAWBs)
 */
export function cleanOrderNumber(orderNumber: string | null | undefined, hawb: string | null | undefined): string {
  if (!orderNumber) return '';
  let str = String(orderNumber).trim();
  const lower = str.toLowerCase();
  if (['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', ''].includes(lower)) {
    return '';
  }
  // If orderNumber is identical to HAWB, it was mistakenly extracted from HAWB field
  if (hawb && str === hawb) {
    return '';
  }
  return str;
}

/**
 * Clean Invoice Number:
 * Removes misidentified warehouse/customs codes (e.g. 4MW49, 100OSA0, D8TKF) or placeholder texts.
 */
export function cleanInvoiceNumber(invoiceNumber: string | null | undefined, rawText?: string): string {
  if (!invoiceNumber) return '';
  let str = String(invoiceNumber).trim();
  const lower = str.toLowerCase();

  // Check against known non-invoice placeholders
  if (
    ['なし', 'null', 'none', 'n/a', 'undefined', 'ー', '-', '', '（空欄）', '(空欄)', '空欄', '未設定'].includes(lower)
  ) {
    return '';
  }

  // Known warehouse/terminal codes mistakenly captured from neighboring boxes
  // e.g. 4MW49 (上屋コード/保管場所), 100OSA0 (通関業者), D8TKF (通関コード)
  if (
    /^(?:4MW49|100OSA0|D8TKF|TAC\s*OSAKA|TAC\d+|OSA\d+)$/i.test(str) ||
    /(?:上屋|場所|通関コード|通関業者)/.test(str)
  ) {
    return '';
  }

  // If raw text has "INVOICE NO. :" followed directly by newline or blank or another section
  if (rawText) {
    const invMatch = rawText.match(/INVOICE\s*(?:NO\.?|番号)?\s*[:：]\s*([A-Za-z0-9\-_/()\s]{2,40})/i);
    if (invMatch && invMatch[1]) {
      const candidate = invMatch[1].trim();
      if (/^(?:4MW49|100OSA0|D8TKF|安全宣言|安全|PREPAID|COLLECT|担当者|コード)/i.test(candidate)) {
        return '';
      }
    }
  }

  return str;
}

/**
 * Clean Shipper Name:
 * Removes "サブ代理店 ...", "SUB AGENT ...", "コード:...", "TEL:..." mistakenly grouped into shipper.
 */
export function cleanShipperName(shipper: string | null | undefined, rawText?: string): string {
  if (!shipper) return '';
  let str = String(shipper).trim();

  // First check if raw text contains an explicit "SHIPPER : <name>"
  if (rawText) {
    const shipperMatch = rawText.match(/SHIPPER\s*[:：]\s*([^\r\n]+)/i);
    if (shipperMatch && shipperMatch[1]) {
      let extracted = shipperMatch[1].trim();
      // Remove trailing fields like "サブ代理店...", "コード:...", "TEL:...", "FAX:...", "担当者:..."
      extracted = extracted
        .replace(/サブ代理店.*$/i, '')
        .replace(/SUB\s*AGENT.*$/i, '')
        .replace(/コード\s*[:：].*$/i, '')
        .replace(/TEL\s*[:：].*$/i, '')
        .replace(/FAX\s*[:：].*$/i, '')
        .replace(/担当者\s*[:：].*$/i, '')
        .replace(/輸出者符号\s*[:：].*$/i, '')
        .trim();
      if (extracted.length >= 2 && !/^(?:なし|null|-)$/i.test(extracted)) {
        return extracted;
      }
    }
  }

  // Remove "サブ代理店 ..." if embedded in the middle or end
  str = str
    .replace(/(?:サブ代理店|SUB\s*AGENT)\s*[:：]?\s*[^\n\r,]+/gi, '')
    .replace(/コード\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/TEL\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/FAX\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/担当者\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/輸出者符号\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/^SHIPPER\s*[:：]\s*/i, '')
    .trim();

  return str;
}

/**
 * Clean Consignee Name:
 * Ensures true consignee (e.g. "HYUNDAI BUSAN", "OCEAN FORTUNE") is extracted and not overwritten by destination port, forwarder/subagent or billing party.
 */
export function cleanConsigneeName(consignee: string | null | undefined, rawText?: string): string {
  if (!consignee) return '';
  let str = String(consignee).trim();

  // If consignee is just a 3-letter IATA airport code (like SIN, PVG, KIX), check rawText for actual CONSIGNEE
  const isPortCodeOnly = /^[A-Z]{3}$/.test(str);

  // Check if raw text contains an explicit "CONSIGNEE : <name>"
  if (rawText) {
    const consigneeMatch = rawText.match(/CONSIGNEE\s*[:：]\s*([^\r\n]+)/i);
    if (consigneeMatch && consigneeMatch[1]) {
      let extracted = consigneeMatch[1].trim();
      extracted = extracted
        .replace(/コード\s*[:：].*$/i, '')
        .replace(/TEL\s*[:：].*$/i, '')
        .replace(/FAX\s*[:：].*$/i, '')
        .replace(/NOTIFY\s*[:：].*$/i, '')
        .replace(/INVOICE\s*NO.*$/i, '')
        .replace(/請求先.*$/i, '')
        .replace(/場所\s*[:：].*$/i, '')
        .trim();
      if (extracted.length >= 2 && !/^(?:なし|null|-)$/i.test(extracted) && !/^[A-Z]{3}$/.test(extracted)) {
        return extracted;
      }
    }
  }

  // Clean trailing codes or subagent/billing references
  str = str
    .replace(/コード\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/TEL\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/FAX\s*[:：]\s*[^\n\r,\s]+/gi, '')
    .replace(/NOTIFY\s*[:：].*$/i, '')
    .replace(/^CONSIGNEE\s*[:：]\s*/i, '')
    .trim();

  return str;
}

/**
 * Format and restore multi-line structure for Special Notes (特記事項)
 * Preserves newlines, removes header/stream artifacts (like TAC62 浪口 茜, HAWB, MAWB, FLT.),
 * and restores linebreaks for markings, vessel names, carton numbers, and dates.
 */
export function formatSpecialNotes(notes: string | null | undefined, rawText?: string): string {
  if (!notes) return '';
  let str = String(notes).trim();

  // Strip known document header keywords that might be accidentally captured due to text stream order
  const forbiddenHeaderRegexes = [
    /^営業担当者/i,
    /^TAC\d+/i,
    /^浪口/i,
    /^茜/i,
    /^HAWB$/i,
    /^MAWB$/i,
    /^FLT\.?$/i,
    /^ROUTE$/i,
    /^積地/i,
    /^行先/i,
    /^(海外)?代理店/i,
    /^早出し/i,
    /^超早出し/i,
    /^RO\s+LOCAL/i,
    /^ETD\s*-\s*ETA/i,
    /^ＢＬ返却先/i,
    /^アタッチ書類/i,
    /^受注[NＮ][OＯ]/i,
    /^通関業者/i,
  ];

  // If string has newlines, filter out header noise lines
  if (str.includes('\n')) {
    const cleanedLines = str
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !forbiddenHeaderRegexes.some(re => re.test(l)));
    if (cleanedLines.length > 0) {
      return cleanedLines.join('\n');
    }
  }

  // If flattened on a single line or rawText has a specific block, intelligently restore line breaks
  str = str
    .replace(/\s*(<MARKING>|\[MARKING\]|【MARKING】)\s*/gi, '\n$1\n')
    .replace(/\s*(SHIP\s+SPARES\s+IN\s+TRANSIT)\s*/gi, '\n$1\n')
    .replace(/\s*(船名でご確認下さい|船名確認|船名で確認)\s*/gi, '\n$1\n')
    .replace(/\s*(M\/V\s+[A-Za-z0-9\s&.,'-]+?)(?=\s+C\/NO|\s*<|\s*\d+月|\s*船名|\s*$)/gi, '\n$1\n')
    .replace(/\s*(HYUNDAI\s+BUSAN|OCEAN\s+FORTUNE)\s*/gi, '\n$1\n')
    .replace(/\s*(C\/NO\.?\s*\d+)/gi, '\n$1\n')
    .replace(/\s*(\d{1,2}月\d{1,2}日[^\s\n\r]*搬入[^\s\n\r]*|\d{1,2}\/\d{1,2}[^\s\n\r]*搬入[^\s\n\r]*)\s*/gi, '\n$1\n')
    .replace(/\s*([・•*])\s*/g, '\n$1 ')
    .replace(/\s*(インボイス番号[:：]|マーク[:：]|個数[:：]|GW[:：]|Size[:：]|ファーストにて搬入|保税[:：])/gi, '\n$1');

  const lines = str
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !forbiddenHeaderRegexes.some(re => re.test(l)));

  return lines.join('\n');
}

/**
 * Determine the primary key (HAWB if valid, else MAWB)
 */
export function calculatePrimaryKey(hawb: string | null | undefined, mawb: string | null | undefined): string {
  const cleanH = cleanHawbNumber(hawb);
  const cleanM = normalizeMawbNumber(mawb);
  return cleanH || cleanM || 'UNKNOWN-KEY';
}

/**
 * Helper to extract numeric weight (kg) from grossWeight string (e.g. "1,450.0 KGS", "310.0 KG", "21.2 kg")
 */
export function parseNumericWeight(valStr: string | null | undefined): number {
  if (!valStr) return 0;
  // Remove commas and extract numeric portion with optional decimal
  const match = String(valStr).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return 0;
}

/**
 * Determines whether a shipment is classified as "重量案件" (Heavy Shipment).
 * Criteria:
 * 1. Explicit flag: `shipment.isHeavyCargo === true`
 * 2. Explicit off: `shipment.isHeavyCargo === false`
 * 3. Text indicators: specialNotes, flag, or orderNumber includes "重量", "ヘビー", or "heavy"
 * 4. Gross weight >= 1000kg
 */
export function isHeavyShipment(shipment: Shipment | null | undefined): boolean {
  if (!shipment) return false;

  // 1. Explicit property setting
  if (shipment.isHeavyCargo === true) return true;
  if (shipment.isHeavyCargo === false) return false;

  // 2. Keyword check in metadata
  const textToCheck = `${shipment.flag || ''} ${shipment.specialNotes || ''} ${shipment.orderNumber || ''}`.toLowerCase();
  if (textToCheck.includes('重量') || textToCheck.includes('ヘビー') || textToCheck.includes('heavy')) {
    return true;
  }

  // 3. Gross Weight >= 1000 (kg)
  const weightNum = parseNumericWeight(shipment.grossWeight || (shipment as any).weight);
  if (weightNum >= 1000) {
    return true;
  }

  return false;
}

/**
 * Determines whether a shipment is classified as "重要案件" (Important Shipment).
 * Criteria:
 * 1. Explicit flag: `shipment.isImportant === true`
 * 2. Priority level is High
 */
export function isImportantShipment(shipment: Shipment | null | undefined): boolean {
  if (!shipment) return false;
  return !!(
    shipment.isImportant ||
    shipment.priorityLevel === 'High' ||
    (shipment as any).priority === 'High'
  );
}

