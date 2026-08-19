import React, { useMemo, useState } from 'react';
import { useTheme } from '../../themeContext';
import { FONT_FAMILY } from '../../fontFamily';

// 【2026-08-19追加】「危険行為の履歴やほかの設定などの長い説明文を、タイトルの
// 横にiボタンを追加して、押したら説明をモーダルで画面中央に表示するように
// してほしい」というご要望への対応。以前は各ページのタイトル直下に長い説明の
// 段落(s.lead)を常時表示していたが、ページ本編(3Dプレビュー・間取り図など)に
// たどり着くまでの縦スクロール量が増えてしまっていた。この共通部品を
// タイトルの隣に置き、押したときだけ画面中央のモーダルで説明を表示する形に
// 変更する(複数ページで同じ見た目・挙動を使い回すための共通コンポーネント)。
export default function InfoButton({ title, children }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={styles.btn}
        aria-label={`${title || 'このページ'}の説明を表示`}
        title="このページの説明を表示"
      >
        i
      </button>
      {open && (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.card} onClick={(e) => e.stopPropagation()}>
            <div style={styles.headerRow}>
              <span style={styles.cardTitle}>{title}</span>
              <button style={styles.closeBtn} onClick={() => setOpen(false)} aria-label="閉じる">✕</button>
            </div>
            <div style={styles.body}>{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

function makeStyles(theme) {
  return {
    // タイトル文字と並べても違和感が無いよう、小さな丸ボタンにしている
    // (この手のUIでよく使われる「i」アイコンボタンの見た目)。
    // 【2026-08-19further変更・不具合修正】「文字が統一されていない」という
    // ご指摘への対応。以前はこの「i」だけ明朝体(Georgia/Times New Roman)の
    // 斜体にしていたが、アプリ全体のフォント(fontFamily.js参照)から浮いて
    // 見えていたため、書体はアプリ共通のものに合わせつつ、太字・斜体だけは
    // 残して「i」アイコンらしい見分けやすさは保つようにした。
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 20,
      height: 20,
      borderRadius: '50%',
      border: `1px solid ${theme.borderSoft}`,
      background: 'transparent',
      color: theme.textMuted,
      fontSize: 12,
      fontWeight: 700,
      fontStyle: 'italic',
      fontFamily: FONT_FAMILY,
      cursor: 'pointer',
      marginLeft: 8,
      verticalAlign: 'middle',
      lineHeight: 1,
      padding: 0,
      flexShrink: 0,
    },
    // 【2026-08-19変更】「モーダルは画面の中央に表示してほしい」というご要望に
    // 合わせ、alignItems:'center'で常に画面の縦横中央に表示する。
    // 【重要・不具合修正】このボタンは<RoomScene>(3Dプレビュー)を持つページ
    // (部屋・カメラ・家具・エリア・センサーの各設定タブ)でも使われており、
    // @react-three/dreiの<Html>ラベル(見守りカメラのマーカーなど)は既定で
    // 非常に大きなzIndex(zIndexRange既定値[16777271, 0])を自前で持つため、
    // 以前のzIndex:1000のままだと3Dラベルがこのモーダルより手前に表示されて
    // しまう不具合があった(NotificationModal.jsxと同じ原因・同じ対処)。
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      zIndex: 100000000,
    },
    card: {
      width: '100%',
      maxWidth: 440,
      maxHeight: '80vh',
      background: theme.panelBgAlt,
      borderRadius: 16,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px',
      borderBottom: `1px solid ${theme.border}`,
      flexShrink: 0,
    },
    cardTitle: { color: theme.textStrong, fontWeight: 700, fontSize: 15 },
    closeBtn: {
      width: 28,
      height: 28,
      borderRadius: 8,
      border: 'none',
      background: 'transparent',
      color: theme.textMuted,
      fontSize: 16,
      cursor: 'pointer',
      flexShrink: 0,
    },
    body: {
      padding: 16,
      overflowY: 'auto',
      color: theme.textMuted,
      fontSize: 13.5,
      lineHeight: 1.7,
    },
  };
}
