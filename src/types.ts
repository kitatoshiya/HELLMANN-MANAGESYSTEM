export type TaskStatus = 'Todo' | 'In Progress' | 'Completed';
export type ShipmentStatus = 'Todo' | 'In Progress' | 'Completed';
export type StatusFilterType = 'ALL' | 'UNCOMPLETED' | ShipmentStatus;

export interface ShipmentComment {
  id: string;
  shipmentId: string;
  authorName: string;
  authorEmail?: string;
  createdAt: string; // ISO string
  formattedTime: string; // e.g. "2026/08/01 11:34"
  content: string;
  isImportant?: boolean; // 重要メモフラグ (ON時: 赤色強調表示, デフォルトOFF)
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  employeeNumber?: string;
  department?: string;
  avatarColor?: string;
}

export interface Operator {
  id: string; // Email address (Primary Key)
  email: string;
  name: string; // 氏名
  employeeNumber?: string; // 社員番号（任意）
  department?: string; // 部署
  createdAt?: string;
}

export type MilestoneKey = 'document_received' | 'customs_cleared' | 'customs_permit' | 'onboarded';

export interface MilestoneState {
  key: MilestoneKey;
  label: string; // e.g. "書類受領 (Document Received)", "通関完了 (Customs Cleared)", "搭載完了 (Onboarded)"
  completed: boolean;
  completedAt: string | null; // Formatted timestamp e.g. "2026/08/03 16:50"
  updatedAt?: string | null;
}

export interface Task {
  id: string;
  title: string;
  shortName?: string; // 作業短縮文字 (5文字以下)
  status: TaskStatus;
  order: number;
  isUrgent?: boolean; // 緊急フラグ
  isImportant?: boolean; // 重要フラグ
  priorityLevel?: 'High' | 'Medium' | 'Low';
  priority?: 'High' | 'Medium' | 'Low';
  assignedTo: User | null;
  completedBy: User | null;
  completedAt: string | null; // e.g. "07/31 14:30"
  createdAt: string;
  updatedAt: string;
}

export interface Shipment {
  id: string; // HAWB number if exists, else MAWB number (Primary Key)
  mawbNumber: string;
  hawbNumber: string | null;
  orderNumber: string; // 受注NO. / 特記事項番号
  invoiceNumber: string; // INVOICE NO.
  shipper: string;
  consignee: string;
  portOfLoading?: string | null; // 積地 (Port of Loading)
  destination?: string | null; // 向地(DEST) (Port of Destination / Place of Delivery)
  flag?: string | null; // FLAG (船籍)
  customsClearanceDate: string; // 通関日 / 仕立日
  flightRoute: string; // フライト / ルート
  pieces?: string | null; // 個数 (No.of Pieces RCP)
  grossWeight?: string | null; // 重量 (Gross Weight)
  specialNotes?: string | null; // 特記事項 (複数行)
  cutTime?: string | null; // カット時間
  status: ShipmentStatus;
  isPinned?: boolean; // ピン留めフラグ (ダッシュボード最上部固定)
  isDgCargo?: boolean; // DG (危険物) フラグ
  isImportant?: boolean; // 重要案件フラグ
  isUrgent?: boolean; // 緊急案件フラグ
  priorityLevel?: 'High' | 'Medium' | 'Low'; // 優先度レベル (High: 高, Medium: 中, Low: 低)
  priority?: 'High' | 'Medium' | 'Low';
  assignedOperator?: Operator | null; // 担当者 (担当者マスタより)
  hasCustomPdf?: boolean; // ユーザーアップロード/取り込み元PDF保持フラグ
  originalPdfUrl?: string; // 取り込んだ元のPDFデータURL
  pdfDataUrl?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: User;
  tasks: Task[];
  comments?: ShipmentComment[];
  billingItems?: BillingItem[];
  billingInitialized?: boolean; // 請求明細オーバーレイの初回表示・初期化済みフラグ
  milestones?: MilestoneState[];
}

export interface BillingItem {
  id: string;
  taxable: boolean; // 課税フラグ (ON時「T」出力)
  name: string; // 請求項目名 (20文字まで)
  amount: number | null | ''; // 金額 (0は入力済み、nullまたは''は未入力・空欄)
}

export interface BillingPresetPattern {
  id: string;
  name: string; // パターン名称 (最大20文字程度)
  isDefault?: boolean; // 新規登録タスク時の初期デフォルトパターンフラグ
  items: Array<{
    taxable: boolean;
    name: string;
    amount: number | null | '';
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskMaster {
  id: string;
  orderNumber: number; // №：作業工程の優先順位
  shortName: string; // 作業短縮文字 (5文字以下)
  content: string; // 作業内容 (20文字以下)
  isDgOnly: boolean; // DG設定：DGの時のみ表示するフラグ
  autoInclude: boolean; // 表示フラグ：PDF取り込み時に自動で生成するフラグ
  createdAt?: string;
  updatedAt?: string;
}

export interface PdfPositionTemplate {
  id: string;
  name: string;
  description: string;
  confidenceScore: number;
  zones: Record<string, { x: number; y: number; w: number; h: number; label: string }>;
  savedAt: string;
  usageCount: number;
}

export interface ActivityLog {
  id: string;
  shipmentId: string;
  timestamp: string; // ISO string
  formattedTime: string; // "YYYY/MM/DD HH:mm:ss"
  userId: string;
  userName: string;
  userEmail: string;
  actionType: 'CREATE' | 'STATUS_CHANGE' | 'TASK_UPDATE' | 'TASK_ADD' | 'TASK_DELETE' | 'ASSIGN' | 'AUTO_COMPLETE';
  actionTitle: string;
  details: string;
}

export interface ParsedSIResult {
  mawbNumber: string;
  hawbNumber: string | null;
  orderNumber: string;
  invoiceNumber: string;
  shipper: string;
  consignee: string;
  portOfLoading?: string | null; // 積地 (Port of Loading)
  destination?: string | null; // 向地(DEST) (Port of Destination / Place of Delivery)
  flag?: string | null; // FLAG (船籍)
  customsClearanceDate: string;
  flightRoute: string;
  pieces?: string | null; // 個数 (No.of Pieces RCP)
  grossWeight?: string | null; // 重量 (Gross Weight)
  specialNotes?: string | null; // 特記事項 (複数行)
  cutTime?: string | null; // カット時間
  suggestedTasks: string[];
  primaryKey: string; // HAWB or MAWB
  confidenceScore?: number;
}

export interface BackupPayload {
  version: string; // e.g. "1.0"
  timestamp: string; // ISO string
  formattedDate: string; // e.g. "2026/08/18 17:00:00"
  systemName: string;
  author?: {
    name: string;
    email: string;
    employeeNumber?: string;
  };
  stats: {
    shipmentsCount: number;
    tasksCount: number;
    logsCount: number;
    operatorsCount: number;
    taskMastersCount: number;
  };
  data: {
    shipments: Shipment[];
    activityLogs: ActivityLog[];
    operators: Operator[];
    taskMasters: TaskMaster[];
  };
}

export interface BackupSnapshotMeta {
  id: string; // e.g. "snapshot_2026-08-18_170000"
  timestamp: string; // ISO string
  formattedDate: string;
  type: 'AUTO' | 'MANUAL';
  storagePath?: string; // Firebase Storage path
  storageDownloadUrl?: string;
  fileSizeBytes?: number;
  shipmentsCount: number;
  tasksCount: number;
  logsCount: number;
  operatorsCount: number;
  authorName?: string;
  authorEmail?: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
}

export interface BackupSettings {
  autoBackupEnabled: boolean; // 自動スナップショット保存有効/無効
  intervalHours: number; // 実行間隔（1, 6, 12, 24時間）
  lastAutoBackupTime?: string | null;
  lastManualBackupTime?: string | null;
  autoDownloadJson: boolean; // JSON自動ダウンロード通知/実行
  retentionCount: number; // 保存スナップショット最大世代数（デフォルト 30）
}

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  subMessage?: string;
  duration?: number; // ミリ秒 (デフォルト 6000ms, 0で自動消去なし)
  timestamp: number;
  shipmentId?: string;
  actions?: ToastAction[];
  isCutTimeAlert?: boolean;
  cutTime?: string;
  remainingMinutes?: number;
}

export interface NotificationSettings {
  enabled: boolean; // システム全体のトースト通知の有効/無効
  notifyOnNewShipment: boolean; // 新規案件登録完了時の通知
  notifyOnApproachingCutTime: boolean; // 当日カット時間・締切接近時の通知 (完了済は非対象)
  cutTimeWarningMinutes: number; // カット時間何分前に警告通知するか (15, 30, 45, 60, 90, 120分)
  soundEnabled: boolean; // 通知音 (Web Audio) の有効/無効
  checkIntervalSeconds: number; // 監視チェック間隔（秒, デフォルト 30秒）
  autoDismissSeconds: number; // トースト表示時間（秒, デフォルト 6秒）
}

export type CloudSyncState = 'synced' | 'syncing' | 'error' | 'offline';

export interface CloudSyncStatus {
  state: CloudSyncState;
  lastSyncedAt: number | null;
  pendingCount: number;
  errorMessage?: string;
}


