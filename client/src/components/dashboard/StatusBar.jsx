import React, { useMemo } from 'react';
import { ROOM_LABEL, CAMERA_LABEL } from '../../config';
import CameraControls from '../camera-setup/CameraControls';
import { useTheme } from '../../themeContext';
import { useOperationMode } from '../../operationModeContext';
import { useViewport } from '../../hooks/useViewport';

export default function StatusBar({
  connected,
  hasPerson,
  confidencePct,
  personCount,
  statusText,
  viewMode,
  onViewModeChange,
  inputMode,
  shouldCapture,
  cameraError,
  requestWebcam,
  dummyCount,
  onAddDummy,
  onClearDummies,
  dummyKeyHelp,
  heatmapOn,
  onToggleHeatmap,
}) {
  const { theme } = useTheme();
  const { isProduction } = useOperationMode();
  const { isMobile } = useViewport();
  const s = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);

  const pillColor = !connected ? theme.textFaint : hasPerson ? theme.accent : theme.warning;
  const pillText = !connected
    ? 'サーバー未接続'
    : hasPerson
      ? `検出中 (信頼度${confidencePct}%)`
      : '検出待ち';

  return (
    <div style={s.bar}>
      {/* アプリ名は共通ヘッダー(画面最上部)側に表示しているため、ここでは
          このページ固有の文脈(どの部屋・どのカメラを見ているか)だけを示す。 */}
      <div style={s.left}>
        <span style={s.crumb}>{ROOM_LABEL}</span>
        <span style={s.sep}>・</span>
        <span style={s.crumb}>{CAMERA_LABEL}</span>
      </div>

      <div style={s.center}>
        <span
          style={{ ...s.pill, color: pillColor, border: `1px solid ${pillColor}` }}
          title={isProduction
            ? 'Role C仕様書 Step 3「MQTT over WebSocketの受信」に対応する、AWS IoT Coreへの実際の接続状態です(本番環境モード)。'
            : 'Role C仕様書 Step 3「MQTT over WebSocketの受信」の接続状態インジケーターに相当(現状はSocket.IOによるモック接続。デモ用データモード)'}
        >
          <span style={{ ...s.dot, background: pillColor }} />
          {pillText}
        </span>
        <span style={s.stateText}>{statusText}</span>
        <span style={s.countChip}>
          <span style={{ ...s.countDot, background: personCount > 0 ? theme.accent : theme.borderSoft }} />
          検出人数: {personCount || 0}人
        </span>
      </div>

      <div style={s.right}>
        {import.meta.env.DEV && (
          <>
            <CameraControls
              inputMode={inputMode}
              requestWebcam={requestWebcam}
              shouldCapture={shouldCapture}
              cameraError={cameraError}
            />
            <span style={s.rightSep} />
            <button
              onClick={onAddDummy}
              style={s.toggleBtn}
              title="人物を模したダミーを部屋の中央付近に置きます。クリックして選択後、矢印キーで移動、数字キー(1〜9)で転倒・誤飲・危険エリアへの接近などの危険行為を模擬発生できます。"
            >
              🧍 ダミーを置く
            </button>
            {dummyCount > 0 && (
              <>
                <span style={s.countChip}>
                  <span style={{ ...s.countDot, background: theme.accent }} />
                  ダミー: {dummyCount}体(矢印キーで移動)
                </span>
                <span style={s.keyHelpChip} title={dummyKeyHelp}>
                  ⌨ 1〜9キーで危険行為を模擬
                </span>
                <button onClick={onClearDummies} style={s.toggleBtn} title="配置したダミーをすべて削除します">
                  ダミーを削除
                </button>
              </>
            )}
            <span style={s.rightSep} />
          </>
        )}
        <button
          onClick={() => onViewModeChange('overview')}
          style={{ ...s.toggleBtn, ...(viewMode === 'overview' ? s.toggleBtnActive : {}) }}
        >
          自由視点
        </button>
        <button
          onClick={() => onViewModeChange('pov')}
          style={{ ...s.toggleBtn, ...(viewMode === 'pov' ? s.toggleBtnActive : {}) }}
        >
          カメラの視点
        </button>
        <span style={s.rightSep} />
        {/* 「見守りダッシュボードにもヒートマップを表示できるボタンがほしい」
            という要望への対応。既定では非表示にしておき、押すと「危険行為の履歴」
            タブと同じ考え方の発生密度ヒートマップを床に重ねて表示する。 */}
        <button
          onClick={onToggleHeatmap}
          style={{ ...s.toggleBtn, ...(heatmapOn ? s.toggleBtnActive : {}) }}
          title="危険行為の履歴をもとにした発生密度ヒートマップを、部屋の床に重ねて表示します"
        >
          ヒートマップ
        </button>
      </div>
    </div>
  );
}

function makeStyles(theme, isMobile) {
  return {
    bar: {
      // 以前はここに固定表示のハンバーガーボタンが重なっていたため左側の余白を
      // 広く取っていたが、そのボタンは共通ヘッダー側へ移したため通常の余白に戻した。
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: isMobile ? '10px 12px' : '14px 20px',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.panelBgAlt,
      flexWrap: 'wrap',
      gap: 10,
    },
    left: { display: 'flex', alignItems: 'baseline', gap: 6, color: theme.text, fontSize: 13 },
    title: { color: theme.textStrong, fontWeight: 700, fontSize: 15 },
    sep: { color: theme.borderSoft },
    crumb: { color: theme.textMuted },
    center: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    pill: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      padding: '5px 12px',
      borderRadius: 999,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    },
    dot: { width: 7, height: 7, borderRadius: '50%' },
    stateText: {
      fontSize: 12, color: theme.textFaint,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      padding: '5px 12px', borderRadius: 999,
    },
    countChip: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: theme.text,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      padding: '5px 12px',
      borderRadius: 999,
    },
    countDot: { width: 6, height: 6, borderRadius: '50%' },
    keyHelpChip: {
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: 12,
      fontWeight: 600,
      color: theme.textMuted,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px dashed ${theme.borderSoft}`,
      padding: '5px 12px',
      borderRadius: 999,
      cursor: 'help',
    },
    right: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    rightSep: { width: 1, alignSelf: 'stretch', background: theme.border, margin: '0 4px' },
    toggleBtn: {
      fontSize: 12,
      padding: '7px 14px',
      borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`,
      background: 'transparent',
      color: theme.textMuted,
      cursor: 'pointer',
    },
    toggleBtnActive: {
      background: theme.accentSoft,
      color: theme.accent,
      border: `1px solid ${theme.accentBorder}`,
    },
  };
}
