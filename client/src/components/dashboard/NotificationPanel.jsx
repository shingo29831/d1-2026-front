import React, { useMemo } from 'react';
import { useTheme } from '../../themeContext';
import { useViewport } from '../../hooks/useViewport';

// 日付(月/日)・時・分・秒までを表示する(以前は時:分のみだったため、日をまたいだ
// 通知の見分けや、短時間に連続した通知の前後関係が分かりにくかった)。
function formatTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

// 通知パネルのアニメーション用CSS。React本体のstyleプロップ(インラインstyle)
// だけではCSSアニメーション(@keyframes)を直接書けないため、この<style>タグを
// 1度だけ差し込んでおき、以後は各要素にanimation名を指定するだけで使えるように
// している(通知が新規追加されるたびに、そのDOMノードは新規マウントになる
// ため、キーフレームアニメーションは自動的に最初から再生される)。
// ・notifSlideIn: 新しい通知がスッと右からフェードインしながら現れる
// ・notifPulse: 危険(danger)通知のアイコンをしばらくの間ゆっくり点滅させ、
//   見逃しにくくする(確認(✓)を押すとopacityが下がり、パルスも目立たなくなる)
const ANIM_STYLE = `
@keyframes notifSlideIn {
  from { opacity: 0; transform: translateX(18px) scale(0.97); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes notifPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(1.25); }
}
`;

// 【2026-08-19変更】以前は「AIリスクサジェスト」を見守りダッシュボードの3D
// シーンの上に浮かせて表示していたが、「危険通知とAIリスクサジェストで分けて
// 表示してほしい」というご要望を受け、この通知パネルの中に「危険通知」と並ぶ
// もう1つのセクションとして統合した。「デフォルトで危険通知が出るように」との
// ご要望通り、危険通知セクションは常に(0件でも「現在、通知はありません。」を)
// 一番上に表示し、タブなどで隠さない。AIリスクサジェストは件数がある時だけ、
// その下に別セクションとして表示する。
export default function NotificationPanel({ notifications, onAck, onDismiss, onClearAll, riskSuggestions }) {
  const { theme } = useTheme();
  // 【2026-08-19追加: スマホ対応】MonitoringDashboard.jsx側でスマホ幅のときは
  // 3Dシーンの下に縦積みするレイアウトに切り替えているため、このパネル自身も
  // 固定320px幅ではなく画面幅いっぱい・高さは決め打ちにする必要がある。
  const { isMobile } = useViewport();
  const styles = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);
  const suggestions = Array.isArray(riskSuggestions) ? riskSuggestions : [];

  return (
    <aside style={styles.panel}>
      <style>{ANIM_STYLE}</style>
      <div style={styles.scrollArea}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>危険通知</span>
          <span style={styles.count}>{notifications.length}</span>
          <button style={styles.clearBtn} onClick={onClearAll}>すべてクリア</button>
        </div>

        <div style={styles.list}>
          {notifications.length === 0 && (
            <div style={styles.empty}>現在、通知はありません。</div>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              style={{
                ...styles.item,
                borderLeftColor: n.level === 'danger' ? '#f43f5e' : '#f59e0b',
                opacity: n.acknowledged ? 0.55 : 1,
                animation: 'notifSlideIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) both',
              }}
            >
              <div style={styles.itemHead}>
                <span
                  style={{
                    ...styles.icon,
                    color: n.level === 'danger' ? '#f43f5e' : '#f59e0b',
                    display: 'inline-block',
                    animation: n.level === 'danger' && !n.acknowledged ? 'notifPulse 1.4s ease-in-out infinite' : 'none',
                  }}
                >
                  {n.level === 'danger' ? '●' : '⚠'}
                </span>
                <span style={styles.itemTitle}>{n.title}</span>
                <span style={styles.itemTime}>{formatTime(n.time)}</span>
              </div>
              <div style={styles.itemMsg}>{n.message}</div>
              <div style={styles.itemActions}>
                <button style={styles.actionBtn} onClick={() => onAck(n.id)} title="確認済みにする">✓</button>
                <button style={styles.actionBtn} onClick={() => onDismiss(n.id)} title="削除">✕</button>
              </div>
            </div>
          ))}
        </div>

        {suggestions.length > 0 && (
          <>
            <div style={styles.sectionDivider} />
            <div style={styles.header}>
              <span style={styles.headerTitleRisk}>
                <i className="fa-solid fa-lightbulb" aria-hidden="true" />
                AIリスクサジェスト
              </span>
              <span style={styles.count}>{suggestions.length}</span>
            </div>
            <div style={styles.riskList}>
              {suggestions.slice(0, 3).map((s) => (
                <div key={s.id} style={styles.riskItem}>
                  <div style={styles.riskItemTitle}>{s.label}</div>
                  <div style={styles.riskItemTime}>{formatTime(s.time)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function makeStyles(theme, isMobile) {
  return {
    panel: isMobile
      ? {
        width: '100%',
        flexShrink: 0,
        borderLeft: 'none',
        borderTop: `1px solid ${theme.border}`,
        background: theme.panelBgAlt,
        display: 'flex',
        flexDirection: 'column',
        // 縦積み時は画面いっぱいの高さを取ると3Dシーンが見えなくなるため、
        // ここだけスクロールする決め打ちの高さにしておく。
        height: 320,
      }
      : {
        width: 320,
        flexShrink: 0,
        borderLeft: `1px solid ${theme.border}`,
        background: theme.panelBgAlt,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      },
    // 【2026-08-19追加】危険通知・AIリスクサジェストの2セクションをまとめて
    // 1本のスクロール領域にする(片方だけが伸び縮みして表示が崩れるのを防ぐため、
    // panel直下ではなくこの中でflex:1+overflowY:'auto'を持たせる)。
    scrollArea: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '14px 16px',
      borderBottom: `1px solid ${theme.border}`,
    },
    headerTitle: { color: theme.textStrong, fontWeight: 700, fontSize: 14 },
    // AIリスクサジェスト側のセクション見出し(以前の浮遊UIと同じ配色: warning色+電球アイコン)。
    headerTitleRisk: {
      color: theme.warning,
      fontWeight: 700,
      fontSize: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    count: {
      background: '#f43f5e',
      color: '#fff',
      fontSize: 11,
      fontWeight: 700,
      borderRadius: 999,
      padding: '1px 8px',
    },
    clearBtn: {
      marginLeft: 'auto',
      fontSize: 11,
      color: theme.textFaint,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
    },
    // 【2026-08-19変更】以前はここにflex:1+overflowY:'auto'を持たせていたが、
    // AIリスクサジェストのセクションを下に追加したため、スクロールはscrollArea側
    // (両セクション共通)にまとめ、ここは内容ぶんだけの高さに変えた。
    list: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
    empty: { color: theme.textFaint, fontSize: 12, padding: 16, textAlign: 'center' },
    // 2つのセクションの境目の区切り線。
    sectionDivider: { borderTop: `1px solid ${theme.border}` },
    riskList: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
    riskItem: {
      background: theme.mode === 'dark' ? 'rgba(245,158,11,0.08)' : 'rgba(217,119,6,0.06)',
      borderLeft: `3px solid ${theme.warning}`,
      borderRadius: 6,
      padding: '10px 12px',
    },
    riskItemTitle: { color: theme.text, fontSize: 13, fontWeight: 600 },
    riskItemTime: { color: theme.textFaint, fontSize: 10.5, marginTop: 2 },
    item: {
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      borderLeft: '3px solid',
      borderRadius: 6,
      padding: '10px 12px',
    },
    itemHead: { display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' },
    icon: { fontSize: 10 },
    itemTitle: { color: theme.text, fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 },
    itemTime: { color: theme.textFaint, fontSize: 10.5, flexShrink: 0, whiteSpace: 'nowrap' },
    itemMsg: { color: theme.textMuted, fontSize: 12, marginTop: 4, lineHeight: 1.4 },
    itemActions: { display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' },
    actionBtn: {
      width: 24,
      height: 24,
      borderRadius: 6,
      border: `1px solid ${theme.borderSoft}`,
      background: 'transparent',
      color: theme.textMuted,
      cursor: 'pointer',
      fontSize: 11,
    },
  };
}
