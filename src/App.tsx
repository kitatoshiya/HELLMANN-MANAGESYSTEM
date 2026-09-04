import React, { useState, useEffect, useCallback } from 'react';
import { Shipment } from './types';
import { getShipments, getShipmentById, subscribeToStore, resetToDemoData } from './lib/storageManager';
import { initAutoBackupListener } from './lib/backupService';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { ShipmentDetail } from './components/ShipmentDetail';
import { PdfUploadModal } from './components/PdfUploadModal';
import { SystemSpecModal } from './components/SystemSpecModal';
import { XrayAnalysisModal } from './components/XrayAnalysisModal';
import { ShipmentProgressReport } from './components/ShipmentProgressReport';
import { BackupManagerModal } from './components/BackupManagerModal';
import { StandaloneTaskView } from './components/StandaloneTaskView';
import { MobileViewerApp } from './components/MobileViewerApp';
import { ToastContainer } from './components/ToastContainer';
import { SystemNotificationSettingsModal } from './components/SystemNotificationSettingsModal';
import { FirestoreReadMetricsDashboard } from './components/FirestoreReadMetricsDashboard';
import { SplashScreen } from './components/SplashScreen';
import { initCutTimeMonitor } from './lib/notificationService';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { AuthScreen } from './components/AuthScreen';
import { Loader2, Flame, BarChart2 } from 'lucide-react';

function MainApp() {
  const { firebaseUser, loading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isSpecsOpen, setIsSpecsOpen] = useState(false);
  const [isXrayModalOpen, setIsXrayModalOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false);
  const [isFirestoreMetricsOpen, setIsFirestoreMetricsOpen] = useState(false);
  const [todayTrigger, setTodayTrigger] = useState<number>(0);

  const handleSelectToday = () => {
    setSelectedShipmentId(null);
    setTodayTrigger((prev) => prev + 1);
  };

  const loadShipments = useCallback(() => {
    const list = getShipments();
    setShipments((prev) => {
      if (prev === list) return prev;
      return list;
    });
  }, []);

  useEffect(() => {
    // If not authenticated, reset state and skip store subscription
    if (!firebaseUser) {
      setShipments([]);
      setSelectedShipmentId(null);
      return;
    }

    // Initial load when user is authenticated
    loadShipments();

    // Subscribe to store updates with proper cleanup
    const unsubscribeStore = subscribeToStore(() => {
      loadShipments();
    });

    // Start automated background backup timer
    const unsubscribeAutoBackup = initAutoBackupListener();

    // Start automated approaching cut-off time monitor (excluding completed)
    const unsubscribeCutTimeMonitor = initCutTimeMonitor(
      () => getShipments(),
      (shipmentId) => setSelectedShipmentId(shipmentId)
    );

    // Global hidden shortcut (Ctrl+Alt+M or Ctrl+Shift+F) to open Firestore Metrics
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.altKey && e.key.toLowerCase() === 'm') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setIsFirestoreMetricsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubscribeStore();
      unsubscribeAutoBackup();
      unsubscribeCutTimeMonitor();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [firebaseUser?.uid, loadShipments]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300 text-xs font-mono space-y-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span>Firebase 認証状態を確認中...</span>
      </div>
    );
  }

  // If not logged in, force AuthScreen login / sign up
  if (!firebaseUser) {
    return <AuthScreen />;
  }

  // Check if standalone task view or mobile viewer requested
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isMobileViewer = pathname === '/viewer' || pathname.startsWith('/viewer') || searchParams?.get('view') === 'viewer' || searchParams?.get('mode') === 'readonly';

  if (isMobileViewer) {
    return <MobileViewerApp />;
  }

  const isStandaloneTaskView = searchParams?.get('view') === 'tasks-standalone';
  if (isStandaloneTaskView) {
    return <StandaloneTaskView />;
  }

  const selectedShipment = selectedShipmentId ? getShipmentById(selectedShipmentId) : null;

  const handleShipmentCreated = (shipmentId: string) => {
    setSelectedShipmentId(shipmentId);
  };

  const handleResetDemo = () => {
    if (confirm('初期データ（案件・タスク・ログ）をリセットしますか？')) {
      resetToDemoData();
      setSelectedShipmentId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 font-sans text-slate-800 antialiased flex flex-col">
      {/* High-Impact Opening Splash Screen (Modal Popup Style) */}
      {showSplash && (
        <SplashScreen
          shipments={shipments}
          minDuration={2800}
          onComplete={() => setShowSplash(false)}
        />
      )}

      {/* Header Bar */}
      <Navbar
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenSpecs={() => setIsSpecsOpen(true)}
        onResetDemo={handleResetDemo}
        onSelectToday={handleSelectToday}
        onOpenXrayAnalysis={() => setIsXrayModalOpen(true)}
        onOpenReport={() => setIsReportOpen(true)}
        onOpenBackup={() => setIsBackupModalOpen(true)}
        onOpenNotificationSettings={() => setIsNotificationSettingsOpen(true)}
        onShowSplash={() => setShowSplash(true)}
      />

      {/* Real-time System Toast Notifications Container */}
      <ToastContainer onSelectShipment={(sId) => setSelectedShipmentId(sId)} />

      {/* Main Body */}
      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {selectedShipment ? (
          <ShipmentDetail
            shipment={selectedShipment}
            onBack={() => setSelectedShipmentId(null)}
            onShipmentChange={(sId) => setSelectedShipmentId(sId)}
          />
        ) : (
          <Dashboard
            shipments={shipments}
            onSelectShipment={(s) => setSelectedShipmentId(s.id)}
            onOpenUpload={() => setIsUploadOpen(true)}
            todayTrigger={todayTrigger}
            onOpenXrayAnalysis={() => setIsXrayModalOpen(true)}
            onOpenReport={() => setIsReportOpen(true)}
            onOpenBackup={() => setIsBackupModalOpen(true)}
          />
        )}
      </main>

      {/* Modals */}
      <ShipmentProgressReport
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        shipments={shipments}
        onSelectShipment={(s) => {
          setIsReportOpen(false);
          setSelectedShipmentId(s.id);
        }}
      />

      <BackupManagerModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        shipments={shipments}
      />

      <PdfUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onShipmentCreated={handleShipmentCreated}
      />

      <SystemSpecModal
        isOpen={isSpecsOpen}
        onClose={() => setIsSpecsOpen(false)}
        onOpenFirestoreMetrics={() => setIsFirestoreMetricsOpen(true)}
      />

      <XrayAnalysisModal
        isOpen={isXrayModalOpen}
        onClose={() => setIsXrayModalOpen(false)}
      />

      <SystemNotificationSettingsModal
        isOpen={isNotificationSettingsOpen}
        onClose={() => setIsNotificationSettingsOpen(false)}
      />

      <FirestoreReadMetricsDashboard
        isOpen={isFirestoreMetricsOpen}
        onClose={() => setIsFirestoreMetricsOpen(false)}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 text-xs text-slate-400 flex items-center justify-between">
        <div className="w-12 hidden sm:block" />
        <p className="text-center flex-1">
          輸出進捗管理システム (Export Progress Management System) • Powered by Google AI Studio (Gemini Flash) &{' '}
          <button
            type="button"
            onClick={() => setIsFirestoreMetricsOpen(true)}
            className="hover:text-amber-600 transition-colors cursor-pointer inline-flex items-center space-x-0.5 group focus:outline-hidden"
            title="[Admin] Firestore Read Operations Dashboard (Ctrl+Alt+M)"
          >
            <span className="group-hover:underline">Firebase</span>
            <Flame className="w-3 h-3 text-amber-500/30 group-hover:text-amber-500 inline-block transition-colors" />
          </button>
        </p>
        <div className="w-12 text-right">
          {/* Subtle discrete indicator button for admins */}
          <button
            type="button"
            onClick={() => setIsFirestoreMetricsOpen(true)}
            className="text-[10px] text-slate-300 hover:text-slate-600 transition-colors p-1 rounded cursor-pointer font-mono"
            title="Firestore メトリクス (隠し画面)"
          >
            📊
          </button>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
