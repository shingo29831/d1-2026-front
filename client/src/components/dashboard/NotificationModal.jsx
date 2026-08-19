import React, { useMemo, useState } from 'react';
import { useTheme } from '../../themeContext';

// NotificationPanel.jsxのformatTimeと同じ表示形式(月/日 時:分:秒)。
function formatTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

// NotificationPanel.jsxと同じアニメーション定義(新規通知のスライドイン・
// 危険通知アイコンのパルス)。モーダル内でも同じ見え方にするためここでも
// 1度だけ差し込む。
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

// 【2026-08-19追加】スマホ幅で「通知」ボタン(StatusBar.jsx)を押したときに開く
// モーダル。以前は危険通知とAIリスクサジェストを1つのパネル内に縦に並べて
// 両方同時に表示していたが、「通知というタイトルで危険通知とAIリスクサジェスト
// を切り替えれるように」というご要望を受け、タブで切り替える形に変更した
// (スマホでは画面が狭く、2セクションを同時にスクロール表示すると窮屈なため)。
// デスクトップでは引き続きNotificationPanel.jsx(常時表示・2セクション縦積み)を
// 使うため、このモーダルはスマホ幅のときだけMonitoringDashboard.jsxから
// マウントされる。
export default function NotificationModal({ notifications, onAck, onDismiss, onClearAll, riskSuggestions, onClose }) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('danger'); // 'danger' | 'suggestions'
  const suggestions = Array.isArray(riskSuggestions) ? riskSuggestions : [];
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <style>{ANIM_STYLE}</style>
      {/* カード自体のクリックはバブリングで閉じないようにする(背景タップのみで閉じる) */}
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <span style={styles.title}>通知</span>
          <button style={styles.closeBtn} onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        <div style={styles.tabRow}>
          <button
            style={{ ...styles.tabBtn, ...(activeTab === 'danger' ? styles.tabBtnActive : {}) }}
            onClick={() => setActiveTab('danger')}
          >
            危険通知
            <span style={styles.tabCount}>{notifications.length}</span>
          </button>
          <button
            style={{ ...styles.tabBtn, ...(activeTab === 'suggestions' ? styles.tabBtnActive : {}) }}
            onClick={() => setActiveTab('suggestions')}
          >
            AIリスクサジェスト
            <span style={styles.tabCount}>{suggestions.length}</span>
          </button>
        </div>

        <div style={styles.body}>
          {activeTab === 'danger' && (
            <>
              {notifications.length > 0 && (
                <div style={styles.clearRow}>
                  <button style={styles.clearBtn} onClick={onClearAll}>すべてクリア</button>
                </div>
              )}
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
            </>
          )}

          {activeTab === 'suggestions' && (
            <div style={styles.riskList}>
              {suggestions.length === 0 && (
                <div style={styles.empty}>現在、AIリスクサジェストはありません。</div>
              )}
              {suggestions.slice(0, 3).map((s) => (
                <div key={s.id} style={styles.riskItem}>
                  <div style={styles.riskItemTitle}>{s.label}</div>
                  <div style={styles.riskItemTime}>{formatTime(s.time)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function makeStyles(theme) {
  return {
    // 画面下からせり上がるボトムシート形式(スマホでは片手操作で閉じやすいため)。
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      zIndex: 1000,
    },
    card: {
      width: '100%',
      maxWidth: 480,
      maxHeight: '80vh',
      background: theme.panelBgAlt,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.25)',
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px',
      borderBottom: `1px solid ${theme.border}`,
      flexShrink: 0,
    },
    title: { color: theme.textStrong, fontWeight: 700, fontSize: 16 },
    closeBtn: {
      width: 28,
      height: 28,
      borderRadius: 8,
      border: 'none',
      background: 'transparent',
      color: theme.textMuted,
      fontSize: 16,
      cursor: 'pointer',
    },
    tabRow: { display: 'flex', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 },
    tabBtn: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: '10px 8px',
      fontSize: 13,
      fontWeight: 600,
      color: theme.textMuted,
      background: 'transparent',
      border: 'none',
      borderBottom: '2px solid transparent',
      cursor: 'pointer',
    },
    tabBtnActive: {
      color: theme.warning,
      borderBottom: `2px solid ${theme.warning}`,
    },
    tabCount: {
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: 700,
      borderRadius: 999,
      padding: '1px 7px',
    },
    body: { flex: 1, overflowY: 'auto' },
    clearRow: { display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 0' },
    clearBtn: { fontSize: 11, color: theme.textFaint, background: 'transparent', border: 'none', cursor: 'pointer' },
    list: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
    empty: { color: theme.textFaint, fontSize: 12, padding: 24, textAlign: 'center' },
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
