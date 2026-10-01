export interface AirportInfo {
  code: string;
  city: string;
  name: string;
  country: string;
}

export const POPULAR_IATA_AIRPORTS: Record<string, AirportInfo> = {
  SIN: { code: "SIN", city: "シンガポール", name: "チャンギ国際空港", country: "SG" },
  BKK: { code: "BKK", city: "バンコク", name: "スワンナプーム国際空港", country: "TH" },
  HND: { code: "HND", city: "東京/羽田", name: "東京国際空港", country: "JP" },
  NRT: { code: "NRT", city: "東京/成田", name: "成田国際空港", country: "JP" },
  KIX: { code: "KIX", city: "大阪/関西", name: "関西国際空港", country: "JP" },
  NGO: { code: "NGO", city: "名古屋/中部", name: "中部国際空港", country: "JP" },
  ICN: { code: "ICN", city: "ソウル/仁川", name: "仁川国際空港", country: "KR" },
  PVG: { code: "PVG", city: "上海/浦東", name: "浦東国際空港", country: "CN" },
  HKG: { code: "HKG", city: "香港", name: "香港国際空港", country: "HK" },
  TPE: { code: "TPE", city: "台北/桃園", name: "台湾桃園国際空港", country: "TW" },
  BUS: { code: "BUS", city: "釜山", name: "金海国際空港", country: "KR" },
  DXB: { code: "DXB", city: "ドバイ", name: "ドバイ国際空港", country: "AE" },
  DOH: { code: "DOH", city: "ドーハ", name: "ハマド国際空港", country: "QA" },
  FRA: { code: "FRA", city: "フランクフルト", name: "フランクフルト空港", country: "DE" },
  AMS: { code: "AMS", city: "アムステルダム", name: "スキポール空港", country: "NL" },
  RTM: { code: "RTM", city: "ロッテルダム", name: "ザ・ハーグ空港", country: "NL" },
  LHR: { code: "LHR", city: "ロンドン", name: "ヒースロー空港", country: "GB" },
  LAX: { code: "LAX", city: "ロサンゼルス", name: "ロサンゼルス国際空港", country: "US" },
  JFK: { code: "JFK", city: "ニューヨーク", name: "JFK国際空港", country: "US" },
  DFW: { code: "DFW", city: "ダラス", name: "ダラス・フォートワース国際空港", country: "US" },
  SYD: { code: "SYD", city: "シドニー", name: "シドニー空港", country: "AU" },
};

/**
 * Check if the input is a valid 3-letter IATA uppercase airport code
 */
export function isValidIataCode(code: string): boolean {
  if (!code) return false;
  const clean = code.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(clean);
}

/**
 * Return airport display label or code
 */
export function getAirportLabel(code: string): string {
  const clean = code.trim().toUpperCase();
  if (POPULAR_IATA_AIRPORTS[clean]) {
    const ap = POPULAR_IATA_AIRPORTS[clean];
    return `${ap.code} (${ap.city})`;
  }
  return clean;
}
