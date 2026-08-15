import React, { useMemo } from 'react';
import { ROOM_LABEL, CAMERA_LABEL } from '../../config';
import CameraControls from '../camera-setup/CameraControls';
import { useTheme } from '../../themeContext';

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
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

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
          title="Role C仕様書 Step 3「MQTT over WebSocketの受信」の接続状態インジケーターに相当(現状はSocket.IOによるモック接続)"
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
          title="人物を模したダミーを部屋の中央付近に置きます。クリックして選択後、矢印キーで移動、数字キー(1〜9)で転倒・誤飲・危険エリア侵入などの危険行為を模擬発生できます。"
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
        <button
          onClick={() => onViewModeChange('overview')}
          style={{ ...s.toggleBtn, ...(viewMode === 'overview' ? s.toggleBtnActive : {}) }}
        >
          俯瞰3D
        </button>
        <button
          onClick={() => onViewModeChange('pov')}
          style={{ ...s.toggleBtn, ...(viewMode === 'pov' ? s.toggleBtnActive : {}) }}
        >
          カメラの視点
        </button>
      </div>
    </div>
  );
}

function makeStyles(theme) {
  return {
    bar: {
      // 以前はここに固定表示のハンバーガーボタンが重なっていたため左側の余白を
      // 広く取っていたが、そのボタンは共通ヘッダー側へ移したため通常の余白に戻した。
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 20px',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.panelBgAlt,
      flexWrap: 'wrap',
      gap: 10,
    },
    left: { display: 'flex', alignItems: 'baseline', gap: 6, color: theme.text, fontSize: 13 },
    title: { color: theme.textStrong, fontWeight: 700, fontSize: 15 },
    sep: { color: theme.borderSoft },
    crumb: { color: theme.textMuted },
    center: { display: 'flex', alignItems: 'center', gap: 12 },
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
    right: { display: 'flex', alignItems: 'center', gap: 6 },
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
      borderColor: theme.accentBorder,
    },
  };
}
