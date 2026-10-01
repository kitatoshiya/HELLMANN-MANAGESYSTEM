import React, { useState } from "react";
import { X, Image as ImageIcon, PaintBucket, RefreshCcw, Check, Sparkles, UserCheck } from "lucide-react";
import { AppBackground, AppTheme, UserProfile } from "../types";

interface BackgroundSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  currentTheme: AppTheme;
  background: AppBackground;
  onSave: (bg: AppBackground) => void;
}

const PRESET_WALLPAPERS = [
  {
    name: "コンテナ港 (海運)",
    url: "https://images.unsplash.com/photo-1578575437130-527eed3abbec?q=80&w=1600&auto=format&fit=crop",
  },
  {
    name: "貨物船・海洋",
    url: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?q=80&w=1600&auto=format&fit=crop",
  },
  {
    name: "ダーク抽象ジオメトリ",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1600&auto=format&fit=crop",
  },
  {
    name: "モダンナイトオフィス",
    url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1600&auto=format&fit=crop",
  },
  {
    name: "ディープグラデーション",
    url: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1600&auto=format&fit=crop",
  },
];

export function BackgroundSettingsModal({
  isOpen,
  onClose,
  currentUser,
  currentTheme,
  background,
  onSave,
}: BackgroundSettingsModalProps) {
  const [type, setType] = useState<"image" | "color" | "default">(background?.type || "default");
  const [value, setValue] = useState(background?.value || "");
  const [imageError, setImageError] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setType(background?.type || "default");
      setValue(background?.value || "");
      setImageError(false);
    }
  }, [isOpen, background]);

  if (!isOpen) return null;

  const sanitizeUrl = (rawUrl: string): string => {
    let trimmed = rawUrl.trim();
    if (!trimmed) return "";
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("data:")) {
      trimmed = "https://" + trimmed;
    }
    return trimmed;
  };

  const handleSave = () => {
    const finalVal = type === "image" ? sanitizeUrl(value) : type === "color" ? value : "";
    onSave({ type, value: finalVal });
    onClose();
  };

  const handleReset = () => {
    setType("default");
    setValue("");
    setImageError(false);
  };

  const isLight = currentTheme === "light";
  const bgClass = isLight ? "bg-white text-slate-900 border-slate-200" : "bg-slate-900 text-slate-100 border-slate-800";
  const inputBgClass = isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-950 border-slate-800 text-slate-100";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className={`w-full max-w-lg rounded-xl shadow-2xl border ${bgClass} my-8`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${isLight ? "border-slate-200" : "border-slate-800"}`}>
          <div>
            <h2 className="text-lg font-black flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-sky-500" />
              背景設定 (壁紙・カラー)
            </h2>
            <p className="text-xs text-sky-400 font-semibold flex items-center gap-1 mt-0.5">
              <UserCheck className="w-3.5 h-3.5 text-sky-400" />
              個別ログインID保存: <span className="font-mono underline">{currentUser.email}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight ? "hover:bg-slate-200 text-slate-500" : "hover:bg-slate-800 text-slate-400"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          <div className="space-y-3">
            <label className="block text-sm font-bold">背景の種類</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setType("default");
                  setImageError(false);
                }}
                className={`py-2.5 px-3 text-xs font-bold rounded-lg border flex flex-col items-center gap-1 transition-all ${
                  type === "default"
                    ? "bg-sky-600 text-white border-sky-500 ring-2 ring-sky-500/50 shadow-md"
                    : isLight ? "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                }`}
              >
                <RefreshCcw className="w-4 h-4" />
                デフォルト
              </button>
              <button
                type="button"
                onClick={() => {
                  setType("image");
                  setImageError(false);
                }}
                className={`py-2.5 px-3 text-xs font-bold rounded-lg border flex flex-col items-center gap-1 transition-all ${
                  type === "image"
                    ? "bg-sky-600 text-white border-sky-500 ring-2 ring-sky-500/50 shadow-md"
                    : isLight ? "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                画像壁紙
              </button>
              <button
                type="button"
                onClick={() => {
                  setType("color");
                  if (!value || value.startsWith("http")) setValue("#0f172a");
                  setImageError(false);
                }}
                className={`py-2.5 px-3 text-xs font-bold rounded-lg border flex flex-col items-center gap-1 transition-all ${
                  type === "color"
                    ? "bg-sky-600 text-white border-sky-500 ring-2 ring-sky-500/50 shadow-md"
                    : isLight ? "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                }`}
              >
                <PaintBucket className="w-4 h-4" />
                単色カラー
              </button>
            </div>
          </div>

          {type === "image" && (
            <div className="space-y-4">
              {/* Preset Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  推奨プリセット壁紙 (ワンクリックで選択)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_WALLPAPERS.map((preset, idx) => {
                    const isSelected = value === preset.url;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setValue(preset.url);
                          setImageError(false);
                        }}
                        className={`group relative h-16 rounded-lg overflow-hidden border transition-all text-left p-2 flex flex-col justify-end ${
                          isSelected
                            ? "border-sky-400 ring-2 ring-sky-400/60 shadow-lg"
                            : "border-slate-700/60 hover:border-slate-500"
                        }`}
                      >
                        <img
                          src={preset.url}
                          alt={preset.name}
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                        <span className="relative z-10 text-[11px] font-bold text-white drop-shadow truncate">
                          {preset.name}
                        </span>
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 bg-sky-500 text-white p-0.5 rounded-full z-10 shadow">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Image URL Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  カスタム画像のWeb URL指定
                </label>
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/photo-xxx または 画像直リンク"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setImageError(false);
                  }}
                  className={`w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-mono ${inputBgClass}`}
                />
                <p className="text-[11px] text-slate-400">
                  ※ スマホ・タブレット（Android等）でも確実に表示できるよう自動最適化されます。
                </p>
              </div>

              {/* Live Image Preview */}
              {value && value.trim() && (
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-slate-400 block">壁紙プレビュー</span>
                  <div className="relative h-28 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 flex items-center justify-center">
                    {!imageError ? (
                      <img
                        src={sanitizeUrl(value)}
                        alt="Background Preview"
                        referrerPolicy="no-referrer"
                        onError={() => setImageError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center p-3 text-rose-400 text-xs">
                        ⚠️ 画像URLを読み込めませんでした。URLをご確認ください。
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {type === "color" && (
            <div className="space-y-3">
              <label className="block text-sm font-bold">背景カラー指定</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={value || "#0f172a"}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-12 h-12 p-1 border border-slate-600 rounded cursor-pointer bg-slate-800"
                />
                <input
                  type="text"
                  value={value || "#0f172a"}
                  onChange={(e) => setValue(e.target.value)}
                  className={`flex-1 px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-mono ${inputBgClass}`}
                />
              </div>
              <div className="grid grid-cols-5 gap-2 pt-1">
                {["#0f172a", "#022c22", "#1e1b4b", "#2a1215", "#f0fdf4"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setValue(c)}
                    style={{ backgroundColor: c }}
                    className="h-8 rounded-md border border-slate-600 hover:scale-105 transition-transform"
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`p-4 border-t flex justify-between gap-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-slate-900/50"}`}>
          <button
            type="button"
            onClick={handleReset}
            className={`px-4 py-2 text-sm font-bold rounded-lg border transition-colors ${
              isLight
                ? "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            }`}
          >
            デフォルトに戻す
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 text-sm font-bold rounded-lg border transition-colors ${
                isLight
                  ? "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              }`}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-6 py-2 text-sm font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white shadow-md transition-colors"
            >
              設定を保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
