import React, { useMemo } from 'react';
import { useTheme } from '../../themeContext';

// 見守りダッシュボード上でWebカメラの状態を確認・切り替えるための小さなコントロール。
// 「YOLOの起動・動作確認」ページへ移動しなくても、この画面のままWebカメラを
// 起動し直したり、現在カメラが使えているかどうかを確認できるようにする。
//
// 【重要】クリックするたびに必ずrequestWebcam()(=getUserMediaの再試行)を呼ぶ。
// 以前はすでにinputMode==='webcam'のときクリックしても何も起きなかったため、
// 初回のカメラ起動に失敗した場合(許可を拒否した、他アプリがカメラ使用中だった等)に
// ボタンを押しても映像がずっと真っ黒のままになってしまう問題があった。
export default function CameraControls({ inputMode, requestWebcam, shouldCapture, cameraError }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (shouldCapture === false) {
    return (
      <span
        style={styles.readonlyNote}
        title="この端末は閲覧専用モードです。URLの末尾に ?capture=1 を付けて開くとこの端末のカメラを使用できます。"
      >
        閲覧専用モード
      </span>
    );
  }

  const active = inputMode === 'webcam' && !cameraError;

  return (
    <div style={styles.wrap}>
      <button
        onClick={requestWebcam}
        style={{
          ...styles.btn,
          ...(active ? styles.btnActive : {}),
          ...(cameraError ? styles.btnError : {}),
        }}
        title={
          cameraError
            ? `${cameraError}\n(クリックして再試行)`
            : active
              ? 'このWebカメラで検出中です(クリックで再起動)'
              : 'クリックしてWebカメラを起動'
        }
      >
        <span
          style={{
            ...styles.dot,
            background: cameraError ? theme.danger : active ? theme.accent : theme.textFaint,
          }}
        />
        Webカメラを使用{cameraError ? '(再試行)' : ''}
      </button>
      {cameraError && (
        <span style={styles.errorNote} title={cameraError}>
          ⚠ 起動失敗
        </span>
      )}
    </div>
  );
}

function makeStyles(theme) {
  return {
    wrap: { display: 'inline-flex', alignItems: 'center', gap: 8 },
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 12,
      padding: '7px 14px',
      borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`,
      background: 'transparent',
      color: theme.textMuted,
      cursor: 'pointer',
    },
    btnActive: {
      background: theme.accentSoft,
      color: theme.accent,
      borderColor: theme.accentBorder,
    },
    btnError: {
      borderColor: theme.danger,
      color: theme.danger,
    },
    dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
    errorNote: {
      fontSize: 11,
      color: theme.danger,
      cursor: 'default',
    },
    readonlyNote: {
      fontSize: 11.5,
      color: theme.warning,
      background: theme.mode === 'dark' ? 'rgba(245,158,11,0.1)' : 'rgba(217,119,6,0.1)',
      border: `1px solid ${theme.warning}55`,
      borderRadius: 8,
      padding: '7px 12px',
      cursor: 'default',
    },
  };
}
