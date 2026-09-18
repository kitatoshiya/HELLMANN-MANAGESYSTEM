import * as React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export interface ErrorBoundaryProps {
  children?: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset() {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="bg-amber-50/90 border border-amber-300/80 rounded-2xl p-4 my-3 text-amber-900 shadow-sm">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-xs font-bold">
                {this.props.fallbackTitle || 'コンポーネントの表示中に一時的なエラーが発生しました'}
              </h4>
              <p className="text-[11px] text-amber-800 mt-1">
                {this.props.fallbackMessage || 'データの読み込みを再試行するか、画面を更新してください。'}
              </p>
              {this.state.error?.message && (
                <div className="mt-1 font-mono text-[10px] text-amber-700 bg-amber-100/70 p-1.5 rounded overflow-x-auto">
                  {this.state.error.message}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 text-xs font-semibold rounded-lg cursor-pointer transition-colors shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>再試行</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
