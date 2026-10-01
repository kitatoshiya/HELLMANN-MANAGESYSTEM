import React, { useRef, useEffect, useState } from 'react';
import { Bold, Italic, Underline, Table, Code, Eye, Palette } from 'lucide-react';

interface HtmlMailEditorProps {
  value: string;
  onChange: (htmlValue: string) => void;
  rows?: number;
  placeholder?: string;
}

export const HtmlMailEditor: React.FC<HtmlMailEditorProps> = ({
  value,
  onChange,
  rows = 10,
  placeholder = 'メール本文を入力またはコピペしてください...',
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showCode, setShowCode] = useState(false);
  const [htmlCode, setHtmlCode] = useState('');

  // Convert plain text with line breaks to HTML if value doesn't contain HTML tags
  const formatInitialHtml = (val: string): string => {
    if (!val) return '';
    if (/<[a-z][\s\S]*>/i.test(val) || val.includes('<table') || val.includes('<div') || val.includes('<br')) {
      return val;
    }
    // Convert newlines to <br> for plain text
    return val.replace(/\n/g, '<br>');
  };

  useEffect(() => {
    if (editorRef.current) {
      const initialHtml = formatInitialHtml(value);
      // Only update if innerHTML is drastically different to preserve caret during edits
      if (editorRef.current.innerHTML !== initialHtml && !showCode) {
        editorRef.current.innerHTML = initialHtml;
      }
    }
    setHtmlCode(value);
  }, [value, showCode]);

  const handleInput = () => {
    if (editorRef.current) {
      const currentHtml = editorRef.current.innerHTML;
      setHtmlCode(currentHtml);
      onChange(currentHtml);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboardData = e.clipboardData;
    const htmlData = clipboardData.getData('text/html');

    if (htmlData) {
      e.preventDefault();
      // Insert HTML with tables/styles preserved
      document.execCommand('insertHTML', false, htmlData);
      handleInput();
    }
  };

  const execCmd = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    handleInput();
  };

  const insertSampleTable = () => {
    const tableHtml = `
      <table style="border-collapse: collapse; width: 100%; border: 1px solid #cbd5e1; margin: 10px 0; font-size: 12px;">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left;">品名 (ITEM)</th>
            <th style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center;">数量 (QTY)</th>
            <th style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">金額 (VALUE)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">Diaphragm, P/No. 10D6-11</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center;">1</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">¥8,500</td>
          </tr>
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">Diaphragm, P/No. 10D6-15</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center;">1</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">¥6,500</td>
          </tr>
        </tbody>
      </table>
      <p><br></p>
    `;
    execCmd('insertHTML', tableHtml);
  };

  const minHeightPx = Math.max(160, rows * 20);

  return (
    <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-2xs flex flex-col focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
      {/* Editor Toolbar */}
      <div className="bg-slate-100 border-b border-slate-200 p-1.5 px-2 flex flex-wrap items-center justify-between gap-1 text-xs">
        <div className="flex items-center space-x-1 flex-wrap gap-y-1">
          <button
            type="button"
            onClick={() => execCmd('bold')}
            className="p-1.5 hover:bg-slate-200 rounded text-slate-700 hover:text-slate-900 font-bold cursor-pointer"
            title="太字 (Bold)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => execCmd('italic')}
            className="p-1.5 hover:bg-slate-200 rounded text-slate-700 hover:text-slate-900 cursor-pointer"
            title="斜体 (Italic)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => execCmd('underline')}
            className="p-1.5 hover:bg-slate-200 rounded text-slate-700 hover:text-slate-900 cursor-pointer"
            title="下線 (Underline)"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {/* Color selector */}
          <div className="flex items-center space-x-0.5" title="文字色を変更">
            <Palette className="w-3.5 h-3.5 text-slate-500 mr-1" />
            {['#000000', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#4b5563'].map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => execCmd('foreColor', color)}
                className="w-4 h-4 rounded-full border border-slate-300 cursor-pointer hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <div className="h-4 w-px bg-slate-300 mx-1" />

          <button
            type="button"
            onClick={insertSampleTable}
            className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-300 rounded text-[11px] font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
            title="表（テーブル）の雛形を挿入"
          >
            <Table className="w-3.5 h-3.5 text-blue-600" />
            <span>表を挿入</span>
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className={`px-2 py-1 rounded text-[11px] font-mono border flex items-center gap-1 cursor-pointer transition-colors ${
              showCode
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
          >
            {showCode ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>リッチテキスト表示</span>
              </>
            ) : (
              <>
                <Code className="w-3.5 h-3.5" />
                <span>HTMLソース</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Content Area */}
      {showCode ? (
        <textarea
          value={htmlCode}
          onChange={(e) => {
            setHtmlCode(e.target.value);
            onChange(e.target.value);
          }}
          className="w-full p-3 font-mono text-xs text-slate-800 bg-slate-900 text-emerald-300 border-0 focus:ring-0 focus:outline-none"
          style={{ minHeight: `${minHeightPx}px` }}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onPaste={handlePaste}
          className="w-full p-3 text-xs leading-relaxed text-slate-800 focus:outline-none overflow-y-auto prose prose-xs max-w-none prose-table:border-collapse prose-table:border prose-table:border-slate-300 prose-td:border prose-td:border-slate-300 prose-td:p-1.5 prose-th:border prose-th:border-slate-300 prose-th:bg-slate-100 prose-th:p-1.5"
          style={{
            minHeight: `${minHeightPx}px`,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
          data-placeholder={placeholder}
        />
      )}

      {/* CSS overrides for editable table rendering */}
      <style>{`
        [contenteditable] table {
          border-collapse: collapse !important;
          width: 100% !important;
          margin: 8px 0 !important;
          border: 1px solid #cbd5e1 !important;
        }
        [contenteditable] th, [contenteditable] td {
          border: 1px solid #cbd5e1 !important;
          padding: 6px 10px !important;
          font-size: 12px !important;
        }
        [contenteditable] th {
          background-color: #f1f5f9 !important;
          font-weight: bold !important;
        }
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
};
