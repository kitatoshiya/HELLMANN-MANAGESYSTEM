import React, { useRef, useEffect, useState } from "react";
import { Table, Code, Eye, Bold, List, Trash2, Sparkles, Plus, ZoomIn, ZoomOut, AtSign, Check } from "lucide-react";
import { convertTsvToHtmlTable } from "../lib/excelParser";
import { StaffMember } from "../types";
import { formatMentionHtml } from "../lib/mentionUtils";

interface UnifiedRichEditorProps {
  value: string;
  onChange: (newValue: string) => void;
  placeholder?: string;
  minHeight?: string;
  staffMembers?: StaffMember[];
  disabled?: boolean;
}

export const UnifiedRichEditor: React.FC<UnifiedRichEditorProps> = ({
  value,
  onChange,
  placeholder = "ここに投稿本文・依頼内容・Excel表を直接入力またはコピペしてください...",
  minHeight = "160px",
  staffMembers = [],
  disabled = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isRawSourceMode, setIsRawSourceMode] = useState(false);
  const [zoomScale, setZoomScale] = useState<number>(100);
  const [isMentionOpen, setIsMentionOpen] = useState(false);

  // Auto-complete @ mention popup state
  const [isMentionPopupOpen, setIsMentionPopupOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);

  // Synchronize external value changes (such as modal open with prefilled mail HTML) to contentEditable div
  useEffect(() => {
    if (editorRef.current && !isRawSourceMode) {
      if (editorRef.current.innerHTML !== (value || "")) {
        editorRef.current.innerHTML = value || "";
      }
    }
  }, [value, isRawSourceMode]);

  const filteredCandidates = React.useMemo(() => {
    if (!staffMembers || staffMembers.length === 0) return [];
    if (!mentionQuery) return staffMembers;
    const q = mentionQuery.toLowerCase();
    return staffMembers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    );
  }, [staffMembers, mentionQuery]);

  const handleZoomOut = () => {
    setZoomScale((prev) => Math.max(70, prev - 15));
  };

  const handleZoomIn = () => {
    setZoomScale((prev) => Math.min(200, prev + 15));
  };

  const handleInsertMention = (staff: StaffMember) => {
    const mentionBadgeStr = formatMentionHtml(staff);
    const displayName = staff.name.split(" ")[0] || staff.name;

    if (isRawSourceMode) {
      const q = mentionQuery;
      const targetStr = "@" + q;
      const lastIdx = value.lastIndexOf(targetStr);
      if (lastIdx !== -1) {
        const newValue =
          value.slice(0, lastIdx) +
          `@${displayName} (${staff.email}) ` +
          value.slice(lastIdx + targetStr.length);
        onChange(newValue);
      } else {
        const atIdx = value.lastIndexOf("@");
        if (atIdx !== -1) {
          const newValue =
            value.slice(0, atIdx) +
            `@${displayName} (${staff.email}) ` +
            value.slice(atIdx + 1);
          onChange(newValue);
        } else {
          onChange((value || "") + `@${displayName} (${staff.email}) `);
        }
      }
    } else {
      if (editorRef.current) {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = mentionBadgeStr;
        const mentionNode = tempDiv.firstChild as HTMLElement | null;
        const spaceNode = tempDiv.lastChild as Text | null;

        const findTargetTextNode = (root: Node): { node: Text; index: number } | null => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
              let parent: HTMLElement | null = node.parentElement;
              while (parent && parent !== root) {
                if (
                  parent.getAttribute("contenteditable") === "false" ||
                  parent.hasAttribute("data-mention-email")
                ) {
                  return NodeFilter.FILTER_REJECT;
                }
                parent = parent.parentElement;
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          });

          let current: Text | null = null;
          const textNodes: Text[] = [];
          while ((current = walker.nextNode() as Text | null)) {
            textNodes.push(current);
          }

          for (let i = textNodes.length - 1; i >= 0; i--) {
            const tNode = textNodes[i];
            const text = tNode.textContent || "";
            const searchTarget = mentionQuery ? `@${mentionQuery}` : "@";
            let idx = text.lastIndexOf(searchTarget);
            if (idx === -1 && mentionQuery) {
              idx = text.lastIndexOf("@");
            }
            if (idx !== -1) {
              return { node: tNode, index: idx };
            }
          }
          return null;
        };

        const target = findTargetTextNode(editorRef.current);

        if (target && mentionNode) {
          const { node: textNode, index: atIdx } = target;
          const fullText = textNode.textContent || "";
          const textBeforeAt = fullText.substring(0, atIdx);
          textNode.textContent = textBeforeAt;

          const parent = textNode.parentNode;
          if (parent) {
            const nextSib = textNode.nextSibling;
            if (nextSib) {
              parent.insertBefore(mentionNode, nextSib);
              if (spaceNode) parent.insertBefore(spaceNode, nextSib);
            } else {
              parent.appendChild(mentionNode);
              if (spaceNode) parent.appendChild(spaceNode);
            }
          }
        } else if (mentionNode) {
          editorRef.current.appendChild(mentionNode);
          if (spaceNode) editorRef.current.appendChild(spaceNode);
        }

        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          const caretTarget = spaceNode || mentionNode || editorRef.current;
          range.setStartAfter(caretTarget);
          range.setEndAfter(caretTarget);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        onChange(editorRef.current.innerHTML);
      } else {
        onChange((value || "") + mentionBadgeStr);
      }
    }
    setIsMentionOpen(false);
    setIsMentionPopupOpen(false);
    setMentionQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isMentionPopupOpen || filteredCandidates.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedCandidateIdx((prev) => (prev + 1) % filteredCandidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedCandidateIdx(
        (prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length
      );
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const candidate = filteredCandidates[selectedCandidateIdx] || filteredCandidates[0];
      if (candidate) {
        handleInsertMention(candidate);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsMentionPopupOpen(false);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const textBeforeCursor = node.textContent.slice(0, range.startOffset);
        const atIndex = textBeforeCursor.lastIndexOf("@");
        if (atIndex !== -1) {
          const queryCandidate = textBeforeCursor.slice(atIndex + 1);
          if (!queryCandidate.includes(" ") && !queryCandidate.includes("\n")) {
            setMentionQuery(queryCandidate);
            setIsMentionPopupOpen(true);
            setSelectedCandidateIdx(0);
            return;
          }
        }
      }
    }
    setIsMentionPopupOpen(false);
  };

  // Sync state to innerHTML if editor is not active or when mode changes
  useEffect(() => {
    if (editorRef.current && !isRawSourceMode) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value || "";
      }
    }
  }, [value, isRawSourceMode]);

  // Handle paste events (detect TSV from Excel)
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const textData = e.clipboardData.getData("text/plain");
    const htmlData = e.clipboardData.getData("text/html");

    // If Excel copy-paste (contains tabs)
    if (textData && textData.includes("\t")) {
      e.preventDefault();
      const tableHtml = convertTsvToHtmlTable(textData);

      if (isRawSourceMode) {
        onChange(value + (value ? "\n\n" : "") + tableHtml);
      } else {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const div = document.createElement("div");
          div.innerHTML = tableHtml;
          range.insertNode(div);
        } else if (editorRef.current) {
          editorRef.current.innerHTML += tableHtml;
        }
        if (editorRef.current) {
          onChange(editorRef.current.innerHTML);
        }
      }
    } else if (!htmlData && textData && !isRawSourceMode) {
      // Plain text paste into contentEditable (convert newlines to <br>)
      e.preventDefault();
      document.execCommand("insertHTML", false, textData.replace(/\n/g, "<br>"));
      if (editorRef.current) {
        onChange(editorRef.current.innerHTML);
      }
    }
  };

  // Convert raw TSV tabs inside current text to HTML table
  const handleConvertTsvToTable = () => {
    if (!value) return;
    const tableHtml = convertTsvToHtmlTable(value);
    onChange(tableHtml);
  };

  // Insert empty sample table
  const handleInsertSampleTable = () => {
    const sampleTable = `
      <div class="overflow-x-auto my-3 rounded-lg border-2 border-slate-300 bg-white">
        <table class="w-full text-xs text-left border-collapse" style="border-collapse: collapse; border: 2px solid #cbd5e1; background-color: #ffffff;">
          <thead>
            <tr class="bg-slate-200 text-slate-900 font-bold border-b-2 border-slate-400">
              <th class="px-3 py-2 border border-slate-300" style="background-color: #e2e8f0; color: #0f172a;">品名 (Item Name)</th>
              <th class="px-3 py-2 border border-slate-300" style="background-color: #e2e8f0; color: #0f172a;">数量 (Qty)</th>
              <th class="px-3 py-2 border border-slate-300" style="background-color: #e2e8f0; color: #0f172a;">重量 (Weight)</th>
              <th class="px-3 py-2 border border-slate-300" style="background-color: #e2e8f0; color: #0f172a;">単価 (Unit Price)</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-slate-300 bg-white">
              <td class="px-3 py-2 border border-slate-300" style="background-color: #ffffff; color: #0f172a;">CYLINDER LINER NO.1</td>
              <td class="px-3 py-2 border border-slate-300" style="background-color: #ffffff; color: #0f172a;">1 PC</td>
              <td class="px-3 py-2 border border-slate-300" style="background-color: #ffffff; color: #0f172a;">450 KG</td>
              <td class="px-3 py-2 border border-slate-300" style="background-color: #ffffff; color: #0f172a;">¥1,200,000</td>
            </tr>
            <tr class="border-b border-slate-300 bg-slate-50">
              <td class="px-3 py-2 border border-slate-300" style="background-color: #f8fafc; color: #0f172a;">PISTON CROWN ASSY</td>
              <td class="px-3 py-2 border border-slate-300" style="background-color: #f8fafc; color: #0f172a;">2 PCS</td>
              <td class="px-3 py-2 border border-slate-300" style="background-color: #f8fafc; color: #0f172a;">180 KG</td>
              <td class="px-3 py-2 border border-slate-300" style="background-color: #f8fafc; color: #0f172a;">¥850,000</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    onChange((value || "") + sampleTable);
  };

  return (
    <div className={`w-full border-2 border-slate-700 rounded-xl overflow-hidden bg-slate-900 shadow-xs focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30 transition-all relative ${
      disabled ? "opacity-70 pointer-events-none bg-slate-900/90" : ""
    }`}>
      {/* Floating Auto-complete @ Mention Candidates Popup */}
      {!disabled && isMentionPopupOpen && filteredCandidates.length > 0 && (
        <div className="absolute left-4 top-11 z-50 w-80 bg-slate-900 border-2 border-sky-500 rounded-xl shadow-2xl overflow-hidden py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3 py-1.5 text-[10px] font-black text-sky-400 bg-sky-950/90 border-b border-slate-800 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <AtSign className="w-3.5 h-3.5 text-sky-400" /> 得意先・担当者マスタより自動取得:
            </span>
            <span className="text-[9px] text-slate-400">↑↓ 移動 / Enter 決定</span>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-800/60 custom-scrollbar">
            {filteredCandidates.map((staff, idx) => {
              const isSelected = idx === selectedCandidateIdx;
              const displayName = staff.name.split(" ")[0] || staff.name;
              return (
                <button
                  key={staff.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleInsertMention(staff);
                  }}
                  className={`w-full text-left px-3.5 py-2 transition-colors flex items-center justify-between cursor-pointer ${
                    isSelected ? "bg-sky-900/90 text-white font-black" : "hover:bg-slate-800 text-slate-200"
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-xs font-bold truncate flex items-center gap-1.5">
                      <span className="inline-block px-1.5 py-0.5 text-[10px] bg-slate-950 text-sky-300 border border-sky-600 rounded font-mono font-bold">
                        @{displayName}
                      </span>
                      <span>{staff.name}</span>
                    </span>
                    <span className="text-[10px] text-slate-400 truncate font-mono mt-0.5">
                      {staff.email}
                    </span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Editor Integrated Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-800/90 border-b border-slate-700 text-xs gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-slate-200 flex items-center gap-1 mr-1">
            <Eye className="w-3.5 h-3.5 text-sky-400" />
            一体型ライブエディタ
          </span>

          {/* Bold Button */}
          <button
            type="button"
            onClick={() => document.execCommand("bold")}
            className="p-1 hover:bg-slate-700 rounded text-slate-300"
            title="太字 (Bold)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          {/* List Button */}
          <button
            type="button"
            onClick={() => document.execCommand("insertUnorderedList")}
            className="p-1 hover:bg-slate-700 rounded text-slate-300"
            title="箇条書き (List)"
          >
            <List className="w-3.5 h-3.5" />
          </button>

          {/* Add Table Button */}
          <button
            type="button"
            onClick={handleInsertSampleTable}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[11px] font-semibold flex items-center gap-1 shadow-2xs"
          >
            <Plus className="w-3 h-3 text-sky-400" /> 表を挿入
          </button>

          {/* Mention Staff Helper Dropdown */}
          {staffMembers.length > 0 && (
            <div className="relative inline-block text-left">
              <button
                type="button"
                onClick={() => setIsMentionOpen(!isMentionOpen)}
                className="px-2 py-1 bg-sky-950 hover:bg-sky-900 text-sky-200 border border-sky-700 rounded text-[11px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                title="担当スタッフをメンション挿入 (@メンション)"
              >
                <AtSign className="w-3 h-3 text-sky-400" />
                <span>@メンション</span>
              </button>

              {isMentionOpen && (
                <div className="absolute left-0 mt-1 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 divide-y divide-slate-800">
                  <div className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 bg-slate-950">
                    通知先スタッフを選択:
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {staffMembers.map((staff) => (
                      <button
                        key={staff.id}
                        type="button"
                        onClick={() => handleInsertMention(staff)}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-xs font-bold text-slate-200 flex items-center justify-between cursor-pointer"
                      >
                        <span className="truncate">{staff.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">@{staff.email.split("@")[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Size Adjust Controls: 縮小・拡大 */}
          <div className="flex items-center gap-1 border-l border-slate-700 pl-2 ml-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomScale <= 70}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 border border-slate-700 rounded text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-all cursor-pointer disabled:cursor-not-allowed"
              title="文字や罫線を縮小表示"
            >
              <ZoomOut className="w-3 h-3 text-sky-400" />
              <span>縮小</span>
            </button>

            <span className="text-[10px] font-mono font-extrabold text-sky-300 min-w-[34px] text-center">
              {zoomScale}%
            </span>

            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomScale >= 200}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 border border-slate-700 rounded text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-all cursor-pointer disabled:cursor-not-allowed"
              title="文字や罫線を拡大表示"
            >
              <ZoomIn className="w-3 h-3 text-sky-400" />
              <span>拡大</span>
            </button>
          </div>

          {/* Convert TSV Button */}
          {value.includes("\t") && (
            <button
              type="button"
              onClick={handleConvertTsvToTable}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded text-[11px] flex items-center gap-1 shadow-xs animate-pulse"
            >
              <Table className="w-3 h-3" /> Excelコピペを表に一括変換
            </button>
          )}
        </div>

        {/* Right Tools: Raw HTML Toggle & Clear */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsRawSourceMode(!isRawSourceMode)}
            className={`px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1 ${
              isRawSourceMode
                ? "bg-sky-600 text-white font-bold"
                : "bg-slate-700 text-slate-200"
            }`}
          >
            <Code className="w-3 h-3" />
            {isRawSourceMode ? "HTMLソース編集" : "ライブ編集"}
          </button>

          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="p-1 text-slate-400 hover:text-rose-400"
              title="本文をクリア"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Editor Input / Content Area */}
      {isRawSourceMode ? (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          placeholder={placeholder}
          className="rich-editor-input w-full p-3 font-mono text-xs bg-white text-slate-900 focus:outline-none custom-scrollbar disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
          style={{ minHeight, backgroundColor: disabled ? "#f1f5f9" : "#ffffff", color: disabled ? "#64748b" : "#0f172a", fontSize: `${zoomScale}%`, zoom: zoomScale / 100 }}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onPaste={handlePaste}
          placeholder={placeholder}
          className={`rich-editor-input p-3 text-xs text-slate-900 focus:outline-none overflow-y-auto custom-scrollbar leading-relaxed ${
            disabled ? "bg-slate-100 text-slate-500 cursor-not-allowed" : "bg-white"
          }`}
          style={{ minHeight, backgroundColor: disabled ? "#f1f5f9" : "#ffffff", color: disabled ? "#64748b" : "#0f172a", fontSize: `${zoomScale}%`, zoom: zoomScale / 100 }}
        />
      )}

      {/* Editor Footer Help Banner */}
      <div className="px-3 py-1.5 bg-slate-900/80 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-sky-400 shrink-0" />
          Excelからの直接コピー＆ペーストで綺麗な罫線付きテーブルが同じ枠内に生成され、セル文字を直接編集可能です。
        </span>
      </div>
    </div>
  );
};
