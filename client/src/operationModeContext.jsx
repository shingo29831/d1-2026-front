import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

// ===================================================================
// 「デモ用データ」と「本番環境」を切り替えるためのコンテキスト。
// ・デモ(demo): これまで通りのプロトタイプ動作。このブラウザ端末自身の
//   Webカメラ映像をYOLO中継サーバー(Socket.IO)へ送り、pose-data(姿勢の
//   連続ストリーム)を受信して、検出した人物をリアルタイムに3D表示する。
// ・本番(production): 仕様書(Role A / Role C)通りのアーキテクチャ。
//   カメラ映像の取得・AI推論はエッジ(EC2)側の役割のため、このフロント
//   エンドではWebカメラを一切起動せず、Socket.IOへの接続も行わない。
//   AWS IoT CoreからMQTT経由で届く離散的なイベント(ai_hazard/sensor_alert/
//   complex_alert/risk_suggestion)のみを受信する「閲覧専用」の画面になる
//   (詳細は useDetectionPipeline.js・useMonitoringAlerts.js・
//   ROLE_C_SPEC_ALIGNMENT.md を参照)。
//
// 選択したモードはlocalStorageに保存し、次回起動時にも復元する
// (themeContext.jsxのダーク/ホワイトモード切り替えと同じ考え方)。
// ===================================================================

const STORAGE_KEY = 'system1.operationMode.v1';
const OperationModeContext = createContext(null);

function loadSaved() {
  if (!import.meta.env.DEV) return 'production';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'demo' || raw === 'production' ? raw : null;
  } catch {
    return null;
  }
}

export function OperationModeProvider({ children }) {
  // 既定はデモ用データ(これまで通りの挙動)。一度でも切り替えれば、その選択が
  // localStorageに保存され、次回起動時もその選択が復元される。
  // 本番ビルド時は強制的に本番環境モード(production)に固定する。
  const [mode, setMode] = useState(() => {
    if (!import.meta.env.DEV) return 'production';
    return loadSaved() || 'demo';
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 保存できなくても致命的ではないため無視
    }
  }, [mode]);

  const toggleOperationMode = useCallback(() => {
    if (!import.meta.env.DEV) return;
    setMode((m) => (m === 'demo' ? 'production' : 'demo'));
  }, []);

  const value = useMemo(() => ({
    mode,
    isProduction: mode === 'production',
    toggleOperationMode,
    setMode,
  }), [mode, toggleOperationMode]);

  return <OperationModeContext.Provider value={value}>{children}</OperationModeContext.Provider>;
}

export function useOperationMode() {
  const ctx = useContext(OperationModeContext);
  if (!ctx) {
    throw new Error('useOperationMode() はOperationModeProviderの内側でのみ使用できます。');
  }
  return ctx;
}
