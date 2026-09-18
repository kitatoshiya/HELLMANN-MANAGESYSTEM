import React, { useState } from 'react';
import { Database, Code, Cpu, Shield, Copy, Check, FileText, Activity } from 'lucide-react';

interface SystemSpecModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFirestoreMetrics?: () => void;
}

export const SystemSpecModal: React.FC<SystemSpecModalProps> = ({ isOpen, onClose, onOpenFirestoreMetrics }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (code: string, sectionName: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSection(sectionName);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const FIRESTORE_SCHEMA = `// Firestore Collections & Documents Design
// Primary Key Rule: HAWB number if exists, else MAWB number.

// Collection: shipments/{shipmentId}
interface ShipmentDocument {
  id: string;                      // Primary Key: HAWB (e.g., "HAWB-8849-0101") or MAWB (e.g., "999-8765-4321")
  mawbNumber: string;              // Master Air Waybill No.
  hawbNumber: string | null;       // House Air Waybill No. (null if direct MAWB)
  orderNumber: string;             // 受注NO. / 特記事項番号
  invoiceNumber: string;           // INVOICE NO.
  shipper: string;                 // Shipper Company & Address
  consignee: string;               // Consignee Company & Address
  portOfLoading?: string;          // 積地 (Port of Loading)
  destination?: string;            // 向地(DEST) (Port of Discharge / Destination)
  customsClearanceDate: string;   // 通関予定日 / 仕立日 (YYYY-MM-DD)
  flightRoute: string;            // Flight No / Route
  status: 'Todo' | 'In Progress' | 'Completed'; // Auto-computed overall status
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: {
    uid: string;
    email: string;
    displayName: string;
  };
}

// Subcollection: shipments/{shipmentId}/tasks/{taskId}
interface TaskDocument {
  id: string;                      // Auto ID
  title: string;                   // Task Name (可変性: 追加/削除/順序変更)
  status: 'Todo' | 'In Progress' | 'Completed';
  order: number;                   // Execution sequence
  assignedTo: {
    uid: string;
    displayName: string;
    email: string;
  } | null;                        // 作業中担当者
  completedBy: {
    uid: string;
    displayName: string;
    email: string;
  } | null;                        // 作業完了者
  completedAt: string | null;      // MM/DD HH:MM
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Subcollection: shipments/{shipmentId}/logs/{logId}
interface ActivityLogDocument {
  id: string;                      // Auto ID
  timestamp: Timestamp;            // Immutable ISO timestamp
  formattedTime: string;           // YYYY/MM/DD HH:mm:ss
  userId: string;                  // uid
  userName: string;                // displayName
  userEmail: string;               // email
  actionType: 'CREATE' | 'STATUS_CHANGE' | 'TASK_UPDATE' | 'TASK_ADD' | 'TASK_DELETE' | 'ASSIGN';
  actionTitle: string;
  details: string;                 // 不変操作ログ本文
}`;

  const GEMINI_SAMPLE_CODE_JS = `// Node.js (TypeScript) Gemini API PDF Parser (/api/parse-pdf)
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
});

export async function parseShippingInstruction(pdfBase64Buffer: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64Buffer,
          }
        },
        {
          text: \`SI (輸出指示書) から以下の項目を構造化抽出してください:
1. mawbNumber (MAWB番号)
2. hawbNumber (HAWB番号。未記載の場合は null)
3. orderNumber (受注NO/特記事項)
4. invoiceNumber (INVOICE NO)
5. shipper (Shipper名)
6. consignee (Consignee名)
7. portOfLoading (積地 / Port of Loading)
8. destination (向地(DEST) / Destination)
9. customsClearanceDate (通関日)
10. flightRoute (フライト/ルート)
11. primaryKey: HAWBが存在すればHAWB番号、なければMAWB番号
12. suggestedTasks: 日本語の標準輸出作業工程タスク一覧\`
        }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mawbNumber: { type: Type.STRING },
          hawbNumber: { type: Type.STRING, nullable: true },
          orderNumber: { type: Type.STRING },
          invoiceNumber: { type: Type.STRING },
          shipper: { type: Type.STRING },
          consignee: { type: Type.STRING },
          portOfLoading: { type: Type.STRING },
          destination: { type: Type.STRING },
          customsClearanceDate: { type: Type.STRING },
          flightRoute: { type: Type.STRING },
          primaryKey: { type: Type.STRING },
          suggestedTasks: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['mawbNumber', 'orderNumber', 'invoiceNumber', 'shipper', 'consignee', 'primaryKey', 'suggestedTasks']
      }
    }
  });

  return JSON.parse(response.text || '{}');
}`;

  const CLOUD_FUNCTIONS_CODE = `// Cloud Functions v2 (Firestore Trigger for Task Updates & Status Aggregation)
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

export const aggregateShipmentStatusOnTaskWrite = onDocumentWritten(
  "shipments/{shipmentId}/tasks/{taskId}",
  async (event) => {
    const shipmentId = event.params.shipmentId;
    const shipmentRef = db.collection("shipments").doc(shipmentId);

    // Fetch all sub-tasks under the shipment
    const tasksSnapshot = await db.collection("shipments").doc(shipmentId).collection("tasks").get();
    const tasks = tasksSnapshot.docs.map(doc => doc.data());

    if (tasks.length === 0) return;

    // Calculate aggregated status according to Section 5 Rules
    let newStatus = "Todo";
    const allTodo = tasks.every(t => t.status === "Todo");
    const allDone = tasks.every(t => t.status === "Completed");

    if (allDone) {
      newStatus = "Completed";
    } else if (!allTodo) {
      newStatus = "In Progress";
    }

    // Update parent shipment document status atomically
    await shipmentRef.update({
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
);`;

  const SECURITY_RULES = `// Firestore Security Rules (firestore.rules)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated logistics team members can read/write shipments
    match /shipments/{shipmentId} {
      allow read, write: if request.auth != null;

      match /tasks/{taskId} {
        allow read, write: if request.auth != null;
      }

      // Activity logs are append-only (immutable audit trail)
      match /logs/{logId} {
        allow read: if request.auth != null;
        allow create: if request.auth != null;
        allow update, delete: if false; // Prohibit tampering with audit logs
      }
    }
  }
}`;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden my-8 text-slate-100 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-6 bg-slate-950 border-b border-slate-800 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">輸出進捗管理システム システム要件定義書 & 設計仕様</h2>
              <p className="text-xs text-slate-400">データ構造・Gemini AI連携コード・Cloud Functions・Firestore設計</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg font-bold">
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-8 text-xs leading-relaxed">
          {/* Section 1: Firestore Schema */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-amber-400 flex items-center">
                <Database className="w-4 h-4 mr-2" />
                1. Firestore データ構造 (コレクション・ドキュメント設計)
              </h3>
              <button
                onClick={() => handleCopy(FIRESTORE_SCHEMA, 'schema')}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 inline-flex items-center"
              >
                {copiedSection === 'schema' ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
                コードをコピー
              </button>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-[11px] text-blue-300 overflow-x-auto">
              {FIRESTORE_SCHEMA}
            </pre>
          </div>

          {/* Section 2: Gemini API PDF Parsing Code */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-amber-400 flex items-center">
                <Code className="w-4 h-4 mr-2" />
                2. Gemini 3.6 Flash API PDF解析・JSON構造化サンプルコード
              </h3>
              <button
                onClick={() => handleCopy(GEMINI_SAMPLE_CODE_JS, 'gemini')}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 inline-flex items-center"
              >
                {copiedSection === 'gemini' ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
                コードをコピー
              </button>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-[11px] text-emerald-300 overflow-x-auto">
              {GEMINI_SAMPLE_CODE_JS}
            </pre>
          </div>

          {/* Section 3: Cloud Functions Logic */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-amber-400 flex items-center">
                <Cpu className="w-4 h-4 mr-2" />
                3. 全タスク完了時の案件ステータス自動判定 Cloud Functions ロジック
              </h3>
              <button
                onClick={() => handleCopy(CLOUD_FUNCTIONS_CODE, 'functions')}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 inline-flex items-center"
              >
                {copiedSection === 'functions' ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
                コードをコピー
              </button>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-[11px] text-amber-300 overflow-x-auto">
              {CLOUD_FUNCTIONS_CODE}
            </pre>
          </div>

          {/* Section 4: Security Rules */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-amber-400 flex items-center">
                <Shield className="w-4 h-4 mr-2" />
                4. 不変ログ保護 & 認証対応 Firestore セキュリティルール (firestore.rules)
              </h3>
              <button
                onClick={() => handleCopy(SECURITY_RULES, 'rules')}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 inline-flex items-center"
              >
                {copiedSection === 'rules' ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
                コードをコピー
              </button>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-[11px] text-purple-300 overflow-x-auto">
              {SECURITY_RULES}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-between items-center shrink-0">
          <div>
            {onOpenFirestoreMetrics && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFirestoreMetrics();
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-300 border border-slate-800 hover:border-amber-500/30 rounded-lg text-xs font-mono transition-all flex items-center space-x-1.5 cursor-pointer"
                title="Firestore 読み取りメトリクス & 負荷可視化ダッシュボード"
              >
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span>[内部診断] Firestore 読取メトリクス (7-Days)</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
