import React, { useEffect, useRef, useState } from 'react';
import HamburgerMenu from './HamburgerMenu';
import { useTheme } from '../../themeContext';

// 画面上部に固定表示する共通ヘッダー。
// これまでは「ハンバーガーメニューの開閉ボタン」と「常設のログアウトボタン」が
// それぞれ独立して画面の左上・右上に浮いているだけで、見守りダッシュボードには
// さらにページ専用の情報バー(StatusBar)があり、タイトルや接続状況、ログアウトが
// あちこちに分散して見えていた。
// このAppHeaderを全ページ共通の1本のヘッダーとしてどの画面でも同じ位置に固定
// 表示し、次の3つだけをまとめて置く:
//   ・左: メニューを開くボタン + アプリ名 + サーバー接続状況(点)
//   ・右: アカウントアイコン(カーソルを合わせる/タップすると、メールアドレスと
//        ログアウトボタンを含むカードが開く)
// ページごとの操作(ダミー操作・カメラ映像・表示モード切替など)は、これまで
// 通り各ページ側(StatusBarなど)に残し、ここには置かない。
export const HEADER_HEIGHT = 60;

export default function AppHeader({ currentPage, onNavigate, connected, userEmail, authMode, onLogout }) {
  const { theme } = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const s = makeStyles(theme);

  // アカウントカードの外側をクリックしたら閉じる(タップで開いたときのため)。
  useEffect(() => {
    if (!accountOpen) return undefined;
    const onDocClick = (e) => {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [accountOpen]);

  const trimmedEmail = (userEmail || '').trim();
  const initial = trimmedEmail ? trimmedEmail.charAt(0).toUpperCase() : '👤';
  const modeLabel = authMode === 'cognito' ? 'Cognitoアカウントでログイン中' : 'ゲストログイン(デモ用)';

  return (
    <header style={s.header}>
      <div style={s.left}>
        <HamburgerMenu embedded currentPage={currentPage} onNavigate={onNavigate} connected={connected} />
        <div style={s.brand}>
          <span style={s.brandTitle}>子供見守りシステム</span>
          <span
            style={{ ...s.connDot, background: connected ? theme.accent : theme.textFaint }}
            title={connected ? 'サーバー接続中' : 'サーバー未接続'}
          />
        </div>
      </div>

      {/* アカウントアイコン。マウスを乗せる(onMouseEnter)か、タップ/クリック
          (onClick)するとアカウント情報カードが開く。カード自体もこの要素の
          子として重なる位置に配置しているため、アイコン→カードへそのまま
          カーソルを動かしても意図せず閉じない。 */}
      <div
        ref={accountRef}
        style={s.account}
        onMouseEnter={() => setAccountOpen(true)}
        onMouseLeave={() => setAccountOpen(false)}
      >
        <button
          type="button"
          aria-label="アカウントメニュー"
          onClick={() => setAccountOpen((v) => !v)}
          style={s.avatarBtn}
        >
          {initial}
        </button>

        {accountOpen && (
          <div style={s.dropdown}>
            <div style={s.dropdownHeader}>
              <div style={s.dropdownAvatar}>{initial}</div>
              <div style={{ minWidth: 0 }}>
                <div style={s.dropdownEmail}>{trimmedEmail || 'ゲストとして利用中'}</div>
                <div style={s.dropdownMode}>{modeLabel}</div>
              </div>
            </div>
            <button style={s.logoutBtn} onClick={onLogout}>
              🚪 ログアウト
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function makeStyles(theme) {
  return {
    header: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: HEADER_HEIGHT,
      zIndex: 1001,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 18px',
      background: theme.mode === 'dark' ? 'rgba(15,18,26,0.92)' : 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(8px)',
      borderBottom: `1px solid ${theme.border}`,
    },
    left: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 },
    brand: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
    brandTitle: { fontSize: 15, fontWeight: 700, color: theme.textStrong, whiteSpace: 'nowrap' },
    connDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
    account: { position: 'relative' },
    avatarBtn: {
      width: 38,
      height: 38,
      borderRadius: '50%',
      border: `1px solid ${theme.accentBorder}`,
      background: theme.accentSoft,
      color: theme.accent,
      fontWeight: 700,
      fontSize: 14,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dropdown: {
      // アイコンとカードの間に隙間を空けない(隙間があると、カーソルを
      // アイコンからカードへ移動する途中でonMouseLeaveが発火して閉じて
      // しまうため)。見た目の余白はカード自身のpaddingで確保している。
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: 0,
      minWidth: 260,
      background: theme.panelBg,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
      padding: 14,
      paddingTop: 18,
      zIndex: 1002,
    },
    dropdownHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
    dropdownAvatar: {
      width: 34,
      height: 34,
      borderRadius: '50%',
      background: theme.accentSoft,
      color: theme.accent,
      fontWeight: 700,
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    dropdownEmail: { fontSize: 12.5, fontWeight: 600, color: theme.textStrong, wordBreak: 'break-all', lineHeight: 1.4 },
    dropdownMode: { fontSize: 11, color: theme.textFaint, marginTop: 2 },
    logoutBtn: {
      width: '100%',
      padding: '9px 12px',
      fontSize: 12.5,
      fontWeight: 600,
      color: theme.danger,
      background: 'transparent',
      border: `1px solid ${theme.borderSoft}`,
      borderRadius: 8,
      cursor: 'pointer',
    },
  };
}
