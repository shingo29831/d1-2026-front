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
  // 【2026-08-19変更】本番環境では継続的な姿勢ストリームが無く、常に「人物なし」の
  // 状態になるため、以前はここが常に「検出待ち」のまま固定表示されてしまっていた。
  // 本番環境では「検出待ち」という文言そのものが実態と合わないため、単純な接続状態
  // (接続中/未接続)の表示に置き換える(他画面でも「接続中」を同じ意味で使っている)。
  const pillText = !connected
    ? 'サーバー未接続'
    : hasPerson
      ? `検出中 (信頼度${confidencePct}%)`
      : isProduction
        ? '接続中'
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

      {/* 【2026-08-19追加: スマホ対応】以前はこの中の「接続状態」「検出人数」
          「カメラ操作」「視点切り替え」「ヒートマップ」などが、画面が狭いと
          それぞれ勝手に折り返して縦に4〜5段も積み重なってしまい、非常に
          見にくくなっていた。スマホ幅では、この1つの帯の中にすべてのボタンを
          横1列に並べ、はみ出す分は横スクロールで見られるようにする
          (components/settings/SettingsPage.jsxのタブバーと同じ考え方)。
          デスクトップ幅では見た目を変えたくないため、s.scrollRowは
          display:'contents'にして「無いのと同じ」扱いにし、従来通り
          center/rightがbar側で個別に折り返す挙動のままにしている。 */}
      <div style={s.scrollRow}>
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
          {/* 本番環境で意図的に空文字を渡している場合(MonitoringDashboard.jsx参照)は、
              空のピルだけが残ってしまわないよう、そもそも描画しない。 */}
          {statusText && <span style={s.stateText}>{statusText}</span>}
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
              {/* 【2026-08-19変更】「本番環境に切り替えたらダミーを置く機能を削除してほしい」
                  というご要望を受け、ダミー関連のUI(配置ボタン・体数チップ・キー操作の
                  ヘルプ・削除ボタン)一式を、本番環境モードでは丸ごと非表示にする。
                  CameraControls(Webカメラの再試行など)は従来通りDEVビルドでは常に表示する。 */}
              {!isProduction && (
                <>
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
    </div>
  );
}

function makeStyles(theme, isMobile) {
  return {
    bar: {
      // 以前はここに固定表示のハンバーガーボタンが重なっていたため左側の余白を
      // 広く取っていたが、そのボタンは共通ヘッダー側へ移したため通常の余白に戻した。
      // 【2026-08-19変更】スマホ幅では、パンくず(left)を上段、ボタン類(scrollRow)を
      // 下段の1行にした2段組みにするため、column方向に積む。
      display: 'flex',
      alignItems: isMobile ? 'stretch' : 'center',
      justifyContent: 'space-between',
      flexDirection: isMobile ? 'column' : 'row',
      padding: isMobile ? '10px 12px' : '14px 20px',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.panelBgAlt,
      flexWrap: isMobile ? 'nowrap' : 'wrap',
      gap: isMobile ? 8 : 10,
    },
    left: { display: 'flex', alignItems: 'baseline', gap: 6, color: theme.text, fontSize: 13 },
    title: { color: theme.textStrong, fontWeight: 700, fontSize: 15 },
    sep: { color: theme.borderSoft },
    crumb: { color: theme.textMuted },
    // 【2026-08-19追加: スマホ対応】center(接続状態・検出人数)とright(各種ボタン)を
    // まとめて1本の横スクロール行にするための外側コンテナ。デスクトップでは
    // display:'contents'にして「透明な入れ物」にし、center/rightがbar直下に
    // あるのと全く同じ見た目・折り返し挙動になるようにする(既存レイアウトを
    // 変えないため)。スマホでは実際にflexコンテナとして働き、横スクロールする。
    scrollRow: isMobile
      ? {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        // 横スクロールできることが分かるよう、スクロールバーは細く残す
        // (非表示にはしない)。
        paddingBottom: 2,
      }
      : { display: 'contents' },
    center: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: isMobile ? 'nowrap' : 'wrap',
      flexShrink: 0,
    },
    pill: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      padding: '5px 12px',
      borderRadius: 999,
      whiteSpace: 'nowrap',
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    },
    dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
    stateText: {
      fontSize: 12, color: theme.textFaint,
      whiteSpace: 'nowrap',
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
      whiteSpace: 'nowrap',
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      padding: '5px 12px',
      borderRadius: 999,
    },
    countDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
    keyHelpChip: {
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: 12,
      fontWeight: 600,
      color: theme.textMuted,
      whiteSpace: 'nowrap',
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px dashed ${theme.borderSoft}`,
      padding: '5px 12px',
      borderRadius: 999,
      cursor: 'help',
    },
    right: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: isMobile ? 'nowrap' : 'wrap',
      flexShrink: 0,
    },
    rightSep: { width: 1, flexShrink: 0, alignSelf: 'stretch', background: theme.border, margin: '0 4px' },
    toggleBtn: {
      fontSize: 12,
      padding: '7px 14px',
      borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`,
      background: 'transparent',
      color: theme.textMuted,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    },
    toggleBtnActive: {
      background: theme.accentSoft,
      color: theme.accent,
      border: `1px solid ${theme.accentBorder}`,
    },
  };
}
