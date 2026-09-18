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
    id: 'si_kix_sin_goldencargo',
    name: '【航空輸出】関空発シンガポール行 (MAWB: 618-55129605 / Golden Cargo → HYUNDAI BUSAN)',
    description: 'MAWB: 618-55129605, HAWBなし(直截), INVなし, SHIPPER: Golden Cargo S.A., CONSIGNEE: HYUNDAI BUSAN, DEST: SIN',
    sampleText: `Shipping Instruction
営業担当者 TAC62 浪口 茜   通関日: 2026年09月14日(月)   仕立日: 2026年09月14日(月)
サブ代理店 HELLMANN WORLDWIDE LOGISTICS INC.
SHIPPER : Golden Cargo S.A.
CONSIGNEE : HYUNDAI BUSAN
MAWB : 618-55129605
HAWB : -
ROUTE : KIX
積地 : KIX   行先 : SIN   代理店 : -
通関業者 : 100OSA0   場所 : 4MW49   上屋コード : 4MW49   通関コード : D8TKF
INVOICE NO. :
個数 : 2   総重量 : 6.0 kg
特記事項:
ヘルマンシップスパーツ
船名でご確認下さい
HYUNDAI BUSAN
9月14日搬入予定`,
    parsedResult: {
      mawbNumber: '618-55129605',
      hawbNumber: null,
      orderNumber: '',
      invoiceNumber: '',
      shipper: 'Golden Cargo S.A.',
      consignee: 'HYUNDAI BUSAN',
      portOfLoading: 'KIX',
      destination: 'SIN',
      customsClearanceDate: '2026-09-14',
      flightRoute: 'KIX -> SIN',
      pieces: '2',
      grossWeight: '6.0 kg',
      specialNotes: 'ヘルマンシップスパーツ\n船名でご確認下さい\nHYUNDAI BUSAN\n9月14日搬入予定',
      primaryKey: '618-55129605',
      confidenceScore: 0.99,
      suggestedTasks: [
        '通関依頼',
        '業連・爆発物検査依頼書をFAX',
        '搬入伝票FAX',
        'X線検査結果入手',
        'X線検査結果をメール',
        '許可書メール',
      ],
    },
  },
  {
    id: 'si_kix_pvg_kbtrans',
    name: '【航空輸出】関空発上海行 (MAWB: 804-22772584 / KB Trans → OCEAN FORTUNE)',
    description: 'MAWB: 804-22772584, HAWBなし(直截), INVなし(空欄), SHIPPER: KB Trans, CONSIGNEE: OCEAN FORTUNE',
    sampleText: `Shipping Instruction
通関日: 2026年09月14日(月)   仕立日: 2026年09月14日(月)
サブ代理店 HELLMANN WORLDWIDE LOGISTICS INC.
SHIPPER : KB Trans
CONSIGNEE : OCEAN FORTUNE
MAWB : 804-22772584
HAWB : -
ROUTE : KIX - PVG
積地 : KIX   向地 : PVG
通関業者 : 100OSA0   場所 : 4MW49   上屋コード : 4MW49   通関コード : D8TKF
INVOICE NO. :
受注NO. :
個数 : 1   総重量 : 21.2 kg (22.5 kg)
特記事項:
ヘルマンシップスパーツ
9月14日搬入予定
<MARKING>
SHIP SPARES IN TRANSIT
M/V OCEAN FORTUNE
C/NO. 1`,
    parsedResult: {
      mawbNumber: '804-22772584',
      hawbNumber: null,
      orderNumber: '',
      invoiceNumber: '',
      shipper: 'KB Trans',
      consignee: 'OCEAN FORTUNE',
      portOfLoading: 'KIX',
      destination: 'PVG',
      customsClearanceDate: '2026-09-14',
      flightRoute: 'KIX -> PVG',
      pieces: '1',
      grossWeight: '21.2 kg',
      specialNotes: 'ヘルマンシップスパーツ\n9月14日搬入予定\n<MARKING>\nSHIP SPARES IN TRANSIT\nM/V OCEAN FORTUNE\nC/NO. 1',
      primaryKey: '804-22772584',
      confidenceScore: 0.99,
      suggestedTasks: [
        '通関依頼',
        '業連・爆発物検査依頼書をFAX',
        '搬入伝票FAX',
        'X線検査結果入手',
        'X線検査結果をメール',
        '許可書メール',
      ],
    },
  },
  {
    id: 'si_kix_cgk_hellmann',
    name: '【航空輸出】関空発ジャカルタ行 (MAWB: 189-04358045 / HAWB: S2602006126)',
    description: 'MAWB: 189-04358045, HAWB: S2602006126, 受注NOなし (実運用SI標準フォーマット)',
    sampleText: `SHIPPING INSTRUCTION (EXPORT AIR CARGO)
------------------------------------------------
MAWB: 189-04358045 CHK
HAWB: S2602006126 CGK
FLT. / ROUTE: KIX - CGK
SHIPPER:
  SHINKO CO., LTD.
  OSAKA, JAPAN
CONSIGNEE:
  PT ANDALAN MANIS SEJAHTERA
  JAKARTA, INDONESIA
SUB AGENT: HELLMANN WORLDWIDE LOGISTICS INC.
CUSTOMS CLEARANCE DATE: 2026-09-15
INVOICE NO.: R260914005 (L)
受注NO.: (空欄)
CARGO: REPLACEMENT PARTS FOR GENERATOR
PIECES / WEIGHT: 2 CARTON / 175.0 KGS
SPECIAL INSTRUCTION:
  貨物は9/15(AM)に搬入いたします。
  インボイス番号：R260914005 (L)
  マーク：特になし
  個数：2 CARTON
  GW: 175.0kg
  Size: 80x80x60cm(1) 125.0kg / 70x135x80cm(1) 50.0kg
  ファーストにて搬入`,
    parsedResult: {
      mawbNumber: '189-04358045',
      hawbNumber: 'S2602006126',
      orderNumber: '',
      invoiceNumber: 'R260914005 (L)',
      shipper: 'SHINKO CO., LTD.',
      consignee: 'PT ANDALAN MANIS SEJAHTERA',
      portOfLoading: 'KIX (関空)',
      destination: 'CGK (ジャカルタ)',
      customsClearanceDate: '2026-09-15',
      flightRoute: 'KIX → CGK',
      pieces: '2 CARTON',
      grossWeight: '175.0 KGS',
      specialNotes: '・貨物は9/15(AM)に搬入\n・インボイス番号：R260914005 (L)\n・マーク：特になし\n・個数：2 CARTON / GW: 175.0kg\n・Size: 80x80x60cm(1) 125.0kg / 70x135x80cm(1) 50.0kg\n・ファーストにて搬入',
      primaryKey: 'S2602006126',
      confidenceScore: 0.99,
      suggestedTasks: [
        'SI受領・輸出書類内容点検 (INV: R260914005)',
        '保税蔵置場（ファースト）搬入確認',
        '輸出通関申告作成 & 許可取得 (2026-09-15)',
        'HAWB確定発行 (S2602006126)',
        'MAWB確定発行 (189-04358045)',
        'ヘルマン社(HELLMANN) Pre-Advice送付',
      ],
    },
  },
  {
    id: 'si_tokyo_la',
    name: '【航空輸出】成田発ロサンゼルス行（HAWB有）',
    description: 'HAWB番号あり。精密機器の輸出指示書（通常航空貨物）',
    sampleText: `SHIPPING INSTRUCTION (EXPORT AIR CARGO)
------------------------------------------------
MAWB NO.: 999-44556677
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
      mawbNumber: '999-44556677',
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
MAWB NO.: 160-77112233
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
      mawbNumber: '160-77112233',
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
      primaryKey: '160-77112233',
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
MAWB NO.: 618-99001122
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
      mawbNumber: '618-99001122',
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
