import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../themeContext';

// 各ページに group('user'=利用者画面 / 'admin'=管理画面)を持たせ、メニュー内で
// タブ切り替えして表示する。
//   ・利用者画面 … 日常的に見守りに使う画面(ダッシュボード・履歴)に加え、
//                  部屋・カメラ・家具・エリアの設定など、利用者自身が
//                  住環境に合わせて調整する画面
//   ・管理画面   … 接続状況の確認やYOLO/Polycamの動作確認など、設置時や
//                  メンテナンス時にエンジニアが使う画面
// (家具・エリアの設定は、以前は1画面にまとめていたが「家具の設定」と
// 「エリアの設定」の2画面に分割した)
const PAGES = [
  { id: 'dashboard', label: '見守りダッシュボード', desc: '3Dルームでの見守りモニター', group: 'user' },
  { id: 'history', label: '危険行為の履歴', desc: '転倒・危険エリア侵入の履歴とヒートマップ', group: 'user' },
  { id: 'roomSetup', label: '部屋の設定', desc: '形とサイズを入力、またはGLTF/GLBを読み込んで部屋を作成', group: 'user' },
  { id: 'cameraSetup', label: 'カメラ位置の設定', desc: '間取り図でカメラの設置位置・向き・視野角を決める', group: 'user' },
  { id: 'furnitureSetup', label: '家具の設定', desc: '家具(箱)を自由に配置', group: 'user' },
  { id: 'zoneSetup', label: 'エリアの設定', desc: '危険・注意エリアを自由に配置', group: 'user' },
  { id: 'doorSensorSetup', label: '開閉センサーの設定', desc: '玄関・勝手口などの開閉センサーを間取り図上に配置', group: 'user' },
  { id: 'connectionStatus', label: '接続状況', desc: 'AWS(Cognito・IoT Core・履歴API)やカメラ等の接続状態を確認', group: 'admin' },
  { id: 'yolo', label: 'YOLOの起動・動作確認', desc: 'Webカメラ/動画とYOLOv8-Poseの疎通確認', group: 'admin' },
  { id: 'polycam', label: 'Polycamの動作確認', desc: 'スキャンしたGLTF/GLBの読み込み確認', group: 'admin' },
];

const GROUP_LABELS = { user: '利用者画面', admin: '管理画面' };

function groupOf(pageId) {
  const p = PAGES.find((x) => x.id === pageId);
  return p ? p.group : 'user';
}

// embedded: trueの場合、共通ヘッダー(AppHeader.jsx)の中に収まる「インライン
// ボタン」として描画する(画面左上に単独で固定表示する以前の見た目をやめ、
// ヘッダーの左端に収める)。ドロワー(メニュー本体)自体は従来通り画面全体に
// 被さるオーバーレイのまま変わらない。
export default function HamburgerMenu({ currentPage, onNavigate, connected, embedded }) {
  const [open, setOpen] = useState(false);
  // メニューを開いたとき、今見ている画面のタブ(利用者/管理)を自動的に選んでおく。
  const [activeGroup, setActiveGroup] = useState(() => groupOf(currentPage));
  const { theme, mode, toggleTheme } = useTheme();
  const styles = useMemo(() => makeStyles(theme, embedded), [theme, embedded]);
  const visiblePages = useMemo(() => PAGES.filter((p) => p.group === activeGroup), [activeGroup]);

  return (
    <>
      <button
        aria-label="メニューを開く"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            // 開くときだけ、現在表示中の画面に応じたタブを選び直す
            if (next) setActiveGroup(groupOf(currentPage));
            return next;
          });
        }}
        style={styles.hamburgerButton}
      >
        <span style={styles.barWrap}>
          <span style={{ ...styles.bar, transform: open ? 'translateY(7px) rotate(45deg)' : 'none' }} />
          <span style={{ ...styles.bar, opacity: open ? 0 : 1 }} />
          <span style={{ ...styles.bar, transform: open ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
        </span>
      </button>

      {/* バックドロップとドロワー本体はdocument.bodyへポータルで描画する。
          埋め込み(embedded)時、このコンポーネントは共通ヘッダー(AppHeader)の
          中に置かれるが、ヘッダーにはbackdropFilter(すりガラス効果)が
          設定されており、これがposition:fixedな子要素の基準(containing
          block)を書き換えてしまうため、そのままではドロワーが画面全体に
          広がらない(ヘッダーの高さぶんに潰れる)。ポータルでbody直下に
          描画することでこの影響を避け、これまで通りのスライドイン/アウトの
          アニメーションも維持している(常時マウントしておき、transformだけ
          切り替える)。 */}
      {createPortal(
        <>
          {open && <div style={styles.backdrop} onClick={() => setOpen(false)} />}
          <nav style={{ ...styles.drawer, transform: open ? 'translateX(0)' : 'translateX(-105%)' }}>
            {renderDrawerContents()}
          </nav>
        </>,
        document.body,
      )}
    </>
  );

  function renderDrawerContents() {
    return (
      <>
        <div style={styles.drawerHeader}>
          <div style={styles.drawerTitle}>子供見守りシステム</div>
          <div style={styles.drawerSubtitle}>YOLOv8-Pose × Three.js × Polycam</div>
        </div>

        <div style={styles.connState}>
          <span style={{ ...styles.dot, background: connected ? theme.accent : theme.textFaint }} />
          {connected ? 'サーバー接続中' : 'サーバー未接続'}
        </div>

        <button onClick={toggleTheme} style={styles.themeToggle}>
          {mode === 'dark' ? '🌙 ダークモード' : '☀️ ホワイトモード'}
          <span style={styles.themeToggleHint}>クリックで切り替え</span>
        </button>

        {/* 利用者画面/管理画面のタブ切り替え */}
        <div style={styles.groupTabs}>
          {Object.keys(GROUP_LABELS).map((g) => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              style={{ ...styles.groupTab, ...(activeGroup === g ? styles.groupTabActive : {}) }}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>

        <ul style={styles.list}>
          {visiblePages.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onNavigate(p.id);
                  setOpen(false);
                }}
                style={{
                  ...styles.navItem,
                  ...(currentPage === p.id ? styles.navItemActive : {}),
                }}
              >
                <div style={styles.navItemLabel}>{p.label}</div>
                <div style={styles.navItemDesc}>{p.desc}</div>
              </button>
            </li>
          ))}
        </ul>

        <div style={styles.footer}>
          {/* アカウント情報(メールアドレス・ログアウト)は共通ヘッダー右上の
              アイコンにまとめたため、ここではナビゲーション専用にしている。 */}
          ダミーデータ版から実データ連携へ移行中
        </div>
      </>
    );
  }
}

function makeStyles(theme, embedded) {
  return {
    hamburgerButton: embedded
      ? {
        width: 40,
        height: 40,
        borderRadius: 10,
        border: `1px solid ${theme.borderSoft}`,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }
      : {
        position: 'fixed',
        top: 16,
        left: 16,
        width: 44,
        height: 44,
        borderRadius: 10,
        border: `1px solid ${theme.borderSoft}`,
        background: theme.mode === 'dark' ? 'rgba(15,18,26,0.9)' : 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 1000,
      },
    barWrap: {
      width: 20,
      height: 16,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    },
    bar: {
      display: 'block',
      height: 2,
      width: '100%',
      background: theme.accent,
      borderRadius: 2,
      transition: 'transform 0.2s ease, opacity 0.2s ease',
    },
    // 共通ヘッダー(AppHeader.jsx、zIndex:1001)より手前に出す。ドロワーは
    // モーダル的な全画面オーバーレイのため、開いたときはヘッダーごと覆って
    // 見せる(ヘッダー側の半透明背景と重なって見た目が崩れるのを防ぐ)。
    backdrop: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 1010,
    },
    drawer: {
      position: 'fixed',
      top: 0,
      left: 0,
      bottom: 0,
      width: 300,
      background: theme.panelBg,
      borderRight: `1px solid ${theme.border}`,
      zIndex: 1011,
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 18px 18px',
      transition: 'transform 0.22s ease',
      boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
    },
    drawerHeader: { marginBottom: 18 },
    drawerTitle: { color: theme.textStrong, fontWeight: 700, fontSize: 17 },
    drawerSubtitle: { color: theme.textFaint, fontSize: 12, marginTop: 4 },
    connState: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12,
      color: theme.textMuted,
      padding: '8px 10px',
      background: theme.panelBgAlt,
      borderRadius: 8,
      marginBottom: 10,
    },
    dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
    themeToggle: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      fontSize: 12.5,
      fontWeight: 600,
      color: theme.text,
      background: theme.panelBgAlt,
      border: `1px solid ${theme.borderSoft}`,
      borderRadius: 8,
      padding: '9px 12px',
      marginBottom: 16,
      cursor: 'pointer',
    },
    themeToggleHint: { fontSize: 10.5, color: theme.textFaint, fontWeight: 400 },
    groupTabs: {
      display: 'flex',
      gap: 6,
      marginBottom: 12,
      padding: 4,
      background: theme.panelBgAlt,
      borderRadius: 10,
      border: `1px solid ${theme.borderSoft}`,
    },
    groupTab: {
      flex: 1,
      fontSize: 12.5,
      fontWeight: 600,
      padding: '8px 6px',
      borderRadius: 7,
      border: '1px solid transparent',
      background: 'transparent',
      color: theme.textMuted,
      cursor: 'pointer',
    },
    groupTabActive: {
      background: theme.accentSoft,
      color: theme.accent,
      border: `1px solid ${theme.accentBorder}`,
    },
    list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' },
    navItem: {
      width: '100%',
      textAlign: 'left',
      background: 'transparent',
      border: '1px solid transparent',
      borderRadius: 10,
      padding: '10px 12px',
      cursor: 'pointer',
    },
    navItemActive: {
      background: theme.accentSoft,
      border: `1px solid ${theme.accentBorder}`,
    },
    navItemLabel: { color: theme.text, fontSize: 14, fontWeight: 600 },
    navItemDesc: { color: theme.textFaint, fontSize: 11.5, marginTop: 2 },
    footer: { marginTop: 'auto', color: theme.textFaint, fontSize: 11, textAlign: 'center' },
  };
}
