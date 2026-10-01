import React from "react";
import {
  Ship,
  Search,
  Plus,
  AlertTriangle,
  Download,
  User,
  Plane,
  RefreshCw,
  Filter,
  Palette,
  Sparkles,
  Terminal,
  Sun,
  Moon,
  Users,
  UserCheck,
  LogOut,
  Archive,
  CheckCircle2,
  Columns as KanbanIcon,
  StickyNote as StickyIcon,
  Image as ImageIcon,
  Bell,
  Play,
  SlidersHorizontal,
  Calendar,
  FileSpreadsheet,
  Mail,
} from "lucide-react";
import { ActiveView, AppTheme, FilterOptions, QuotationItem, QuoteMessage, StaffMember, UserProfile } from "../types";
import { POPULAR_IATA_AIRPORTS } from "../lib/iataAirports";
import { NotificationDropdown } from "./NotificationDropdown";

interface NavbarProps {
  quotes: QuotationItem[];
  messages: QuoteMessage[];
  filters: FilterOptions;
  setFilters: React.Dispatch<React.SetStateAction<FilterOptions>>;
  currentUser: UserProfile;
  currentTheme: AppTheme;
  activeView: ActiveView;
  onActiveViewChange: (view: ActiveView) => void;
  staffMembers: StaffMember[];
  onThemeChange: (theme: AppTheme) => void;
  onOpenNewQuoteModal: () => void;
  onOpenBackupModal: () => void;
  onOpenUserSwitchModal: () => void;
  onOpenStaffMasterModal: () => void;
  onOpenArchiveModal?: () => void;
  onOpenBgSettings?: () => void;
  onOpenNotificationSettings?: () => void;
  onShowSplash?: () => void;
  onLogout?: () => void;
  onSelectQuote: (quote: QuotationItem) => void;
  totalQuotesCount: number;
  unreadCount: number;
  archivedQuotesCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  quotes,
  messages,
  filters,
  setFilters,
  currentUser,
  currentTheme,
  activeView,
  onActiveViewChange,
  staffMembers,
  onThemeChange,
  onOpenNewQuoteModal,
  onOpenBackupModal,
  onOpenUserSwitchModal,
  onOpenStaffMasterModal,
  onOpenArchiveModal,
  onOpenBgSettings,
  onOpenNotificationSettings,
  onShowSplash,
  onLogout,
  onSelectQuote,
  totalQuotesCount,
  unreadCount,
  archivedQuotesCount = 0,
}) => {
  // Compute destination airport codes for quotes created in the past 10 days
  const recent10DaysAirportCodes = React.useMemo(() => {
    const tenDaysAgoMs = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const codeSet = new Set<string>();

    quotes.forEach((q) => {
      const createdMs = new Date(q.createdAt).getTime();
      if (createdMs >= tenDaysAgoMs) {
        q.airportCodes?.forEach((code) => {
          if (code && code.trim()) {
            codeSet.add(code.trim().toUpperCase());
          }
        });
      }
    });

    const list = Array.from(codeSet).sort();
    // If no quotes in past 10 days, fallback to popular IATA list
    if (list.length === 0) {
      return Object.keys(POPULAR_IATA_AIRPORTS).slice(0, 8);
    }
    return list;
  }, [quotes]);

  const airportCodes = ["ALL", ...recent10DaysAirportCodes];

  // Count of active quotes with status 'accepted' (受託・出荷手配)
  const acceptedCount = React.useMemo(() => {
    return quotes.filter((q) => q.status === "accepted").length;
  }, [quotes]);

  const THEMES: { id: AppTheme; name: string; icon: React.ReactNode; badgeClass: string }[] = [
    { id: "light", name: "ライト", icon: <Sun className="w-3 h-3 text-amber-500" />, badgeClass: "bg-amber-100 text-amber-800" },
    { id: "dark", name: "ダーク", icon: <Moon className="w-3 h-3 text-indigo-400" />, badgeClass: "bg-slate-800 text-slate-200" },
    { id: "cute", name: "かわいい", icon: <Sparkles className="w-3 h-3 text-pink-500" />, badgeClass: "bg-pink-100 text-pink-800 font-bold" },
    { id: "digital", name: "デジタル (ターミナル)", icon: <Terminal className="w-3 h-3 text-emerald-400" />, badgeClass: "bg-emerald-950 text-emerald-300 font-mono border border-emerald-500/50" },
  ];

  return (
    <header className={`sticky top-0 z-50 transition-colors duration-200 border-b shadow-md ${
      currentTheme === "light"
        ? "bg-sky-100 text-slate-900 border-sky-200 font-bold"
        : currentTheme === "cute"
        ? "bg-pink-100/90 text-pink-950 border-pink-200 font-bold"
        : currentTheme === "digital"
        ? "bg-[#020c07] text-emerald-400 border-emerald-900/90 font-mono shadow-emerald-950/50"
        : "bg-slate-900 text-white border-slate-800"
    }`}>
      {/* Top Bar */}
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Title */}
          <div
            onClick={onShowSplash}
            title="起動スプラッシュ画面を表示"
            className="flex items-center gap-3 shrink-0 cursor-pointer group hover:opacity-95 transition-opacity"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md transition-all group-hover:scale-105 ${
              currentTheme === "cute"
                ? "bg-gradient-to-tr from-pink-400 to-rose-400 shadow-pink-300"
                : currentTheme === "digital"
                ? "bg-[#04170e] border border-emerald-500 text-emerald-400 shadow-emerald-500/30"
                : "bg-gradient-to-tr from-sky-600 via-blue-600 to-indigo-500 shadow-sky-900/30"
            }`}>
              <Ship className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={`font-black text-base sm:text-lg tracking-tight flex items-center gap-1.5 ${
                  currentTheme === "cute" ? "text-pink-700" : currentTheme === "light" ? "text-slate-950" : currentTheme === "digital" ? "text-emerald-300 font-mono" : "text-slate-100"
                }`}>
                  ACE船用品輸出管理 <span className={`${currentTheme === 'cute' ? 'text-pink-600 font-bold' : currentTheme === 'digital' ? 'text-emerald-400 font-mono tracking-widest' : 'text-sky-600 font-extrabold'}`}>見積管理</span>
                </h1>
              </div>
            </div>
          </div>

          {/* View Mode Switcher (Compact / Minimal Mode Switcher) */}
          <div className="flex items-center bg-slate-900/90 p-0.5 rounded-lg border border-slate-700/80 shadow-sm shrink-0 gap-0.5">
            <button
              onClick={() => onActiveViewChange("kanban")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                activeView === "kanban"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
              title="カンバン画面"
            >
              <KanbanIcon className="w-3 h-3" />
              <span>カンバン</span>
            </button>
            <button
              onClick={() => onActiveViewChange("arrangement_progress")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                activeView === "arrangement_progress"
                  ? "bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 text-white shadow-sm ring-1 ring-cyan-400/40"
                  : "text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60"
              }`}
              title="受託手配進捗（日程タイムライン＆進捗管理）"
            >
              <Calendar className="w-3 h-3 text-cyan-400" />
              <span>手配進捗</span>
              {acceptedCount > 0 && (
                <span className={`px-1 py-0 rounded-full text-[9px] font-black leading-none ${
                  activeView === "arrangement_progress" ? "bg-white text-cyan-900" : "bg-cyan-950 text-cyan-300 border border-cyan-700"
                }`}>
                  {acceptedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => onActiveViewChange("stock_extractor")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                activeView === "stock_extractor"
                  ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white shadow-sm ring-1 ring-emerald-400/40"
                  : "text-slate-400 hover:text-emerald-400 hover:bg-slate-800/60"
              }`}
              title="未出荷在庫抽出（Excel/XLSM解析）"
            >
              <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
              <span>在庫抽出</span>
            </button>
            <button
              onClick={() => onActiveViewChange("shared_mail")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                activeView === "shared_mail"
                  ? "bg-gradient-to-r from-blue-600 via-sky-600 to-indigo-600 text-white shadow-sm ring-1 ring-sky-400/40"
                  : "text-slate-400 hover:text-sky-400 hover:bg-slate-800/60"
              }`}
              title="共通メールボックス (Microsoft 365)"
            >
              <Mail className="w-3 h-3 text-sky-400" />
              <span>共通メール</span>
            </button>
            <button
              onClick={() => onActiveViewChange("sticky_board")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                activeView === "sticky_board"
                  ? "bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 text-slate-950 shadow-sm"
                  : "text-slate-400 hover:text-amber-400 hover:bg-slate-800/60"
              }`}
              title="裏画面 (付箋ボード)"
            >
              <StickyIcon className="w-3 h-3 text-amber-400 fill-amber-400/20" />
              <span>付箋ボード</span>
            </button>
            <button
              onClick={() => onActiveViewChange("history_search")}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
                activeView === "history_search"
                  ? "bg-gradient-to-r from-cyan-600 via-teal-600 to-sky-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-cyan-400 hover:bg-slate-800/60"
              }`}
              title="見積履歴検索"
            >
              <Search className="w-3 h-3 text-cyan-400" />
              <span>履歴検索</span>
            </button>
          </div>

          {/* Global Search Bar (Kanban only) */}
          {activeView === "kanban" && (
            <div className="flex-1 max-w-md hidden md:block">
              <div className="relative">
                <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${currentTheme === "light" ? "text-slate-600" : "text-slate-400"}`} />
                <input
                  type="text"
                  placeholder="案件名、船名、空港コード、送信者で検索..."
                  value={filters.searchQuery}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
                  }
                  className={`w-full pl-9 pr-4 py-2 rounded-lg text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    currentTheme === "light"
                      ? "bg-white border-2 border-sky-200 text-slate-950 placeholder-slate-500 font-bold"
                      : "bg-slate-800/90 border border-slate-700/80 text-slate-200 placeholder-slate-400"
                  }`}
                />
                {filters.searchQuery && (
                  <button
                    onClick={() => setFilters((prev) => ({ ...prev, searchQuery: "" }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-900 font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Theme Selector & Actions & User Profile */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Notification Dropdown Bell */}
            <NotificationDropdown
              quotes={quotes}
              messages={messages}
              currentUser={currentUser}
              staffMembers={staffMembers}
              onSelectQuote={onSelectQuote}
              onFilterMyMentions={() => {
                const currentStaff = staffMembers.find(
                  (s) => s.email.toLowerCase() === currentUser.email.toLowerCase()
                );
                if (currentStaff) {
                  setFilters((prev) => ({
                    ...prev,
                    assignedStaffId: currentStaff.id,
                  }));
                } else {
                  setFilters((prev) => ({
                    ...prev,
                    searchQuery: `@${currentUser.name.split(" ")[0]}`,
                  }));
                }
              }}
            />

            {/* Theme Selector Dropdown - Always dark blue background with white text */}
            <div className="relative group flex items-center gap-2">
              <div className="theme-selector-box flex items-center bg-slate-900 border border-slate-700 rounded-lg p-1 gap-0.5 text-white font-bold shadow-2xs">
                <Palette className="w-3.5 h-3.5 text-sky-400 ml-1.5 mr-0.5 shrink-0" />
                <select
                  value={currentTheme}
                  onChange={(e) => onThemeChange(e.target.value as AppTheme)}
                  className="theme-selector-select bg-slate-900 text-white text-xs font-bold focus:outline-none cursor-pointer pr-1 py-1"
                  style={{ colorScheme: "dark", backgroundColor: "#0f172a", color: "#ffffff" }}
                >
                  {THEMES.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-white font-bold" style={{ colorScheme: "dark", backgroundColor: "#0f172a", color: "#ffffff" }}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={onOpenBgSettings}
                title="背景設定 (壁紙・カラー)"
                className="p-1.5 border border-slate-700 rounded-lg bg-slate-900 text-slate-300 hover:text-white transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                onClick={onShowSplash}
                title="起動スプラッシュ画面を再生"
                className="p-1.5 border border-slate-700 rounded-lg bg-slate-900 text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
              >
                <Play className="w-4 h-4" />
              </button>
              <button
                onClick={onOpenNotificationSettings}
                title="通知・メール設定"
                className="p-1.5 border border-slate-700 rounded-lg bg-slate-900 text-slate-300 hover:text-white transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4 text-sky-400" />
              </button>
            </div>

            {/* Staff Master Button */}
            <button
              onClick={onOpenStaffMasterModal}
              title="担当者マスタの登録・管理"
              className={`flex items-center gap-1.5 px-2.5 py-2 border rounded-lg text-xs font-bold transition-colors ${
                currentTheme === "light"
                  ? "bg-slate-100 hover:bg-slate-200 text-slate-900 border-slate-300"
                  : currentTheme === "digital"
                  ? "bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/80 font-mono"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
              }`}
            >
              <Users className="w-4 h-4 text-sky-500" />
              <span className="hidden xl:inline">担当者マスタ</span>
            </button>

            {/* Archive List Button */}
            <button
              onClick={onOpenArchiveModal}
              title="アーカイブ済み見積一覧"
              className={`flex items-center gap-1.5 px-2.5 py-2 border rounded-lg text-xs font-bold transition-all ${
                currentTheme === "light"
                  ? "bg-slate-100 hover:bg-slate-200 text-slate-900 border-slate-300"
                  : currentTheme === "digital"
                  ? "bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/80 font-mono"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
              }`}
            >
              <Archive className="w-4 h-4 text-amber-500" />
              <span className="hidden xl:inline">アーカイブ</span>
              {archivedQuotesCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-black rounded-full bg-amber-500 text-white">
                  {archivedQuotesCount}
                </span>
              )}
            </button>

            {/* Backup / Restore Button */}
            <button
              onClick={onOpenBackupModal}
              title="バックアップとデータ復元"
              className={`p-2 border rounded-lg text-xs font-bold transition-colors ${
                currentTheme === "light"
                  ? "bg-slate-100 hover:bg-slate-200 text-slate-900 border-slate-300"
                  : currentTheme === "digital"
                  ? "bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/80 font-mono"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
              }`}
            >
              <Download className="w-4 h-4" />
            </button>

            {/* User Profile / Switcher Button */}
            <button
              onClick={onOpenUserSwitchModal}
              className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-lg text-xs transition-colors font-bold ${
                currentTheme === "light"
                  ? "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900"
                  : currentTheme === "digital"
                  ? "bg-emerald-950/80 hover:bg-emerald-900/90 border-emerald-800 text-emerald-200 font-mono"
                  : "bg-slate-800/90 hover:bg-slate-700 border-slate-700 text-slate-200"
              }`}
              title="ユーザー設定・ログイン切替 (現在ログイン中のID)"
            >
              <div className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs font-black shrink-0">
                {currentUser.email.charAt(0).toUpperCase()}
              </div>
              <div className="text-left hidden lg:block max-w-[130px] truncate">
                <div className={`text-[11px] leading-tight truncate font-bold ${currentTheme === "light" ? "text-slate-950" : currentTheme === "digital" ? "text-emerald-200" : "text-slate-200"}`}>
                  {currentUser.name}
                </div>
                <div className={`text-[10px] truncate ${currentTheme === "light" ? "text-slate-600 font-bold" : currentTheme === "digital" ? "text-emerald-500" : "text-slate-400"}`}>
                  {currentUser.email}
                </div>
              </div>
              <RefreshCw className="w-3.5 h-3.5 text-slate-500 ml-0.5 shrink-0" />
            </button>

            {/* Logout Button */}
            <button
              onClick={onLogout}
              title="ログアウトしてログイン画面に戻る"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs font-bold transition-all active:scale-95 ${
                currentTheme === "light"
                  ? "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200"
                  : currentTheme === "digital"
                  ? "bg-emerald-950/80 hover:bg-rose-950/90 text-rose-400 border-emerald-800/80 hover:border-rose-700 font-mono"
                  : "bg-slate-800/90 hover:bg-rose-950/80 text-rose-300 hover:text-rose-200 border-slate-700 hover:border-rose-800"
              }`}
            >
              <LogOut className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="hidden sm:inline font-black">ログアウト</span>
            </button>
          </div>
        </div>


        {/* Mobile Search Input */}
        <div className="pb-3 md:hidden">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="案件名、船名、空港コード、検索..."
              value={filters.searchQuery}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
              }
              className="w-full pl-9 pr-4 py-2 bg-slate-100 border border-slate-300 rounded-lg text-xs text-slate-950 font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Filter Bar (Airport Pills & Urgent Toggle & Stats) - Kanban View Only */}
        {activeView === "kanban" && (
          <div className={`py-2.5 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
            currentTheme === "light" ? "border-slate-200 font-bold" : "border-slate-800/80"
          }`}>
          {/* Airport Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className={`flex items-center gap-1 mr-1 shrink-0 font-bold ${currentTheme === "light" ? "text-slate-800" : "text-slate-400"}`}>
              <Filter className="w-3.5 h-3.5 text-sky-600" /> 向け地(過去10日間):
            </span>
            {airportCodes.map((code) => {
              const isActive =
                (code === "ALL" && !filters.airportCode) ||
                filters.airportCode === code;
              return (
                <button
                  key={code}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      airportCode: code === "ALL" ? "" : code,
                    }))
                  }
                  className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-bold transition-all shrink-0 ${
                    isActive
                      ? "bg-sky-600 text-white shadow-xs font-black"
                      : currentTheme === "light"
                      ? "bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 font-bold"
                      : "bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60"
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>

          {/* Right Side: New Quote Button, Staff Member Filter, Urgent Toggle & Unread Counter */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {/* New Quote Button */}
            <button
              onClick={onOpenNewQuoteModal}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-black rounded-lg shadow-sm hover:shadow-md transition-all active:scale-95 shrink-0 ${
                currentTheme === "cute"
                  ? "bg-pink-500 hover:bg-pink-400 font-bold"
                  : currentTheme === "digital"
                  ? "bg-emerald-600 hover:bg-emerald-500 font-mono border border-emerald-400/50 shadow-emerald-600/30"
                  : "bg-sky-600 hover:bg-sky-500 shadow-md"
              }`}
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span className="hidden sm:inline">新規見積作成</span>
              <span className="sm:hidden">新規</span>
            </button>

            {/* Staff Filter Dropdown */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold ${
              currentTheme === "light"
                ? "bg-slate-100 border-slate-300 text-slate-900"
                : "bg-slate-800/80 border-slate-700 text-slate-200"
            }`}>
              <UserCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="text-slate-500 hidden sm:inline">担当者:</span>
              <select
                value={filters.assignedStaffId}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, assignedStaffId: e.target.value }))
                }
                className="bg-transparent font-bold focus:outline-none cursor-pointer text-xs"
              >
                <option value="ALL" className="bg-white text-slate-900 font-bold">すべて表示</option>
                <option value="UNASSIGNED" className="bg-white text-slate-900 font-bold">未割り当てのみ</option>
                {staffMembers.map((staff) => (
                  <option key={staff.id} value={staff.id} className="bg-white text-slate-900 font-bold">
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Prominent Accepted (Shipping Arranged) Counter Badge */}
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  statusFilter: prev.statusFilter === "accepted" ? "all" : "accepted",
                }))
              }
              title="受託（出荷手配）の案件を絞り込み・全件表示切り替え"
              className={`flex items-center gap-2 px-3 py-1 rounded-lg border-2 shadow-sm hover:shadow-md transition-all cursor-pointer font-bold ${
                filters.statusFilter === "accepted"
                  ? "bg-emerald-600 text-white border-emerald-300 ring-2 ring-emerald-400/60 shadow-emerald-600/40"
                  : currentTheme === "light"
                  ? "bg-gradient-to-r from-emerald-100 to-teal-50 hover:from-emerald-200 hover:to-teal-100 text-emerald-950 border-emerald-400 shadow-emerald-200/50"
                  : currentTheme === "digital"
                  ? "bg-emerald-950 hover:bg-emerald-900/90 text-emerald-300 border-emerald-500 font-mono shadow-emerald-950/60"
                  : "bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 hover:from-emerald-900 text-emerald-200 border-emerald-500/80 shadow-emerald-950/50"
              }`}
            >
              <div className="w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="text-[11px] font-black tracking-tight">受託(出荷手配):</span>
                <span className="text-xs font-black px-2 py-0.5 rounded-md bg-emerald-600 dark:bg-emerald-500 text-white shadow-xs">
                  {acceptedCount} 件
                </span>
              </div>
            </button>

            {/* Urgent Toggle */}
            <button
              onClick={() =>
                setFilters((prev) => ({ ...prev, urgentOnly: !prev.urgentOnly }))
              }
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold border transition-all ${
                filters.urgentOnly
                  ? "bg-rose-600 text-white border-rose-600 shadow-xs font-black"
                  : currentTheme === "light"
                  ? "bg-slate-100 text-slate-900 border-slate-300 hover:bg-slate-200"
                  : "bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${filters.urgentOnly ? "text-white animate-pulse" : "text-rose-600"}`} />
              <span>🚨 URGENTのみ</span>
            </button>

            {/* Unread Counter Badge */}
            {unreadCount > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-600 text-white font-black text-[11px] animate-pulse shadow-xs">
                <span>🔴 未読新着</span>
                <span className="bg-white text-rose-700 px-1.5 py-0.2 rounded-full font-black text-[10px]">
                  {unreadCount}
                </span>
              </span>
            )}

            <div className={`text-xs hidden sm:block font-bold ${currentTheme === "light" ? "text-slate-800" : "text-slate-400"}`}>
              全 <span className="font-extrabold text-sky-600">{totalQuotesCount}</span> 件
            </div>
          </div>
        </div>
        )}
      </div>
    </header>
  );
};
