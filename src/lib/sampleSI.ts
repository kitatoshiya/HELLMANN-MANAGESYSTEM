import { ParsedSIResult } from '../types';

export interface SampleSITemplate {
  id: string;
  name: string;
  description: string;
  sampleText: string;
  parsedResult: ParsedSIResult;
}

export const SAMPLE_SI_TEMPLATES: SampleSITemplate[] = [
  {
    id: 'si_tokyo_la',
    name: '【航空輸出】成田発ロサンゼルス行（HAWB有）',
    description: 'HAWB番号あり。精密機器の輸出指示書（通常航空貨物）',
    sampleText: `SHIPPING INSTRUCTION (EXPORT AIR CARGO)
------------------------------------------------
MAWB NO.: 999-4455-6677
HAWB NO.: HAWB-2026-LAX088
REF NO. / ORDER NO.: ORD-998823 / SP-0091
INVOICE NO.: INV-TYO-2026-0819
SHIPPER:
  NIPPON PRECISION MACHINERY CO., LTD.
  3-12-1 AKIHABARA, CHIYODA-KU, TOKYO, JAPAN
CONSIGNEE:
  WEST COAST ROBOTICS LABS LLC
  4500 AIRPORT BLVD, LOS ANGELES, CA 90045, USA
FLIGHT / ROUTE: NH006 (ALL NIPPON AIRWAYS) / NRT -> LAX
CUSTOMS CLEARANCE DATE: 2026-08-05
CARGO DESCRIPTION: INDUSTRIAL INDUSTRIAL SERVO MOTORS & CONTROLLERS
PACKAGE / WEIGHT: 12 WOODEN CASES / 1,450.0 KGS
SPECIAL INSTRUCTION: DO NOT TILT. TEMP CONTROLLED 15-25C.`,
    parsedResult: {
      mawbNumber: '999-4455-6677',
      hawbNumber: 'HAWB-2026-LAX088',
      orderNumber: 'ORD-998823 / SP-0091',
      invoiceNumber: 'INV-TYO-2026-0819',
      shipper: 'NIPPON PRECISION MACHINERY CO., LTD.',
      consignee: 'WEST COAST ROBOTICS LABS LLC',
      portOfLoading: 'NRT (成田)',
      destination: 'LAX (ロサンゼルス)',
      customsClearanceDate: '2026-08-05',
      flightRoute: 'NH006 / NRT (成田) → LAX (ロサンゼルス)',
      pieces: '12 WOODEN CASES',
      grossWeight: '1,450.0 KGS',
      specialNotes: '・傾斜厳禁（DO NOT TILT）\n・精密機器につき定温保管手配（15〜25℃）',
      primaryKey: 'HAWB-2026-LAX088',
      confidenceScore: 0.98,
      suggestedTasks: [
        'SI（輸出指示書）内容確認・検証',
        '書類点検（インボイス・パッキングリスト・MSDS）',
        '温度管理および取扱指示点検',
        '輸出通関申告作成 & 税関提出',
        '上屋・保税倉庫搬入手配 (Cargo Booking)',
        'HAWB / MAWB 確定発行',
        'Shipper / Consignee 送状送付',
      ],
    },
  },
  {
    id: 'si_osaka_frankfurt',
    name: '【航空輸出】関空発フランクフルト行（MAWBのみ）',
    description: 'HAWB番号未記載。MAWBがプライマリキーとして採用されるケース',
    sampleText: `AIRWAY BILL INSTRUCTION (DIRECT MASTER)
------------------------------------------------
MAWB NO.: 160-7711-2233
HAWB NO.: N/A (直截マスター扱い)
ORDER / PO NO.: PO-GERMANY-5510
INVOICE NO.: INV-OSK-88192
SHIPPER:
  KANSAI ADVANCED MATERIALS CORP.
  1-5-2 HONMACHI, CHUO-KU, OSAKA, JAPAN
CONSIGNEE:
  BAVARIA AUTOMOTIVE SYSTEM GMBH
  SIEMENSSTRASSE 10, FRANKFURT, GERMANY
FLIGHT / ROUTE: LH741 (LUFTHANSA) / KIX -> FRA
CUSTOMS CLEARANCE DATE: 2026-08-08
CARGO DESCRIPTION: CARBON FIBER REINFORCED COMPOSITES
PACKAGE / WEIGHT: 4 PALLETS / 820 KGS`,
    parsedResult: {
      mawbNumber: '160-7711-2233',
      hawbNumber: null,
      orderNumber: 'PO-GERMANY-5510',
      invoiceNumber: 'INV-OSK-88192',
      shipper: 'KANSAI ADVANCED MATERIALS CORP.',
      consignee: 'BAVARIA AUTOMOTIVE SYSTEM GMBH',
      portOfLoading: 'KIX (関空)',
      destination: 'FRA (フランクフルト)',
      customsClearanceDate: '2026-08-08',
      flightRoute: 'LH741 / KIX (関空) → FRA (フランクフルト)',
      pieces: '4 PALLETS',
      grossWeight: '820.0 KGS',
      specialNotes: '・関空上屋直載手配\n・原産地証明書（EUR.1）同封要',
      primaryKey: '160-7711-2233',
      confidenceScore: 0.96,
      suggestedTasks: [
        'SI内容確認・直截MAWB条件確認',
        '原産地証明書および各種証明書点検',
        '輸出申告手配・税関承認取得',
        '関空保税倉庫搬入確認・スペース確保',
        'MAWB発行および航空会社ハンドオーバー',
        '現地代理店・Consignee宛てPre-Advice送付',
      ],
    },
  },
  {
    id: 'si_haneda_singapore',
    name: '【航空輸出】羽田発シンガポール行（医薬品冷貨）',
    description: 'HAWBあり。厳格な温度管理指示・優先通関を伴う案件',
    sampleText: `EXPORT SHIPPING INSTRUCTION
------------------------------------------------
MAWB NO.: 618-9900-1122
HAWB NO.: HAWB-2026-SIN007
ORDER NO.: ORD-PHARMA-003
INVOICE NO.: INV-HND-9901
SHIPPER:
  TOKYO BIO-PHARMA PHACEUTICALS CO.
  1-1 SHINAGAWA, TOKYO, JAPAN
CONSIGNEE:
  SINGAPORE HEALTHCARE LOGISTICS PTE LTD
  10 AIRPORT CARGO ROAD, SINGAPORE
FLIGHT / ROUTE: SQ635 (SINGAPORE AIRLINES) / HND -> SIN
CUSTOMS CLEARANCE DATE: 2026-08-03
CARGO DESCRIPTION: REFRIGERATED BIOMEDICAL SAMPLES (+2C to +8C)
PACKAGE / WEIGHT: 2 TEMPERATURE CONTROLLED CONTAINERS / 310 KGS`,
    parsedResult: {
      mawbNumber: '618-9900-1122',
      hawbNumber: 'HAWB-2026-SIN007',
      orderNumber: 'ORD-PHARMA-003',
      invoiceNumber: 'INV-HND-9901',
      shipper: 'TOKYO BIO-PHARMA PHACEUTICALS CO.',
      consignee: 'SINGAPORE HEALTHCARE LOGISTICS PTE LTD',
      portOfLoading: 'HND (羽田)',
      destination: 'SIN (シンガポール)',
      customsClearanceDate: '2026-08-03',
      flightRoute: 'SQ635 / HND (羽田) → SIN (シンガポール)',
      pieces: '2 CONTAINERS',
      grossWeight: '310.0 KGS',
      specialNotes: '【冷蔵医薬品】+2℃〜+8℃厳守\n・ドライアイス補充状態の事前点検要\n・現地事前通関要請（Pre-Clearance）',
      primaryKey: 'HAWB-2026-SIN007',
      confidenceScore: 0.99,
      suggestedTasks: [
        'SI受領・医薬品温度管理プロトコル確認',
        '優先通関申告作成 & 厚生労働省要件チェック',
        'ドライアイス/保冷コンテナチェック・搬入',
        '航空会社（SQ）冷貨受領サイン確認',
        'HAWB / MAWB 確定発行',
        'シンガポール現地着荷前事前通知 (Pre-Alert)',
      ],
    },
  },
];
