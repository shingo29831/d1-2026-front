import React, { useMemo } from 'react';
import { useTheme } from '../../themeContext';

// 「1〜9キーで危険行為を模擬」の対応表を、見守りシーンの上に常時表示する
// オーバーレイパネル。以前はStatusBarの⌨チップにマウスを重ねたときだけ
// (title属性のブラウザ標準ツールチップとして)表示していたが、それだと
// 何番が何の危険行為かが分かりにくい・見つけにくいという指摘があったため、
// ダミー選択中は常にこの一覧が見える形にした。
// 直近で押されたキー(flashKey)に該当する行は、押した瞬間が分かるよう
// 一瞬だけハイライトする(呼び出し側でsetTimeoutにより数百ms後にnullへ戻す)。
export default function KeyLegendOverlay({ items, flashKey }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  if (!items || items.length === 0) return null;

  return (
    <div style={s.wrap}>
      <div style={s.title}>⌨ 危険行為の模擬(選択中のダミー)</div>
      <div style={s.list}>
        {items.map((item) => {
          const flashed = flashKey === item.key;
          return (
            <div
              key={item.key}
              style={{
                ...s.row,
                ...(flashed ? s.rowFlash : {}),
              }}
            >
              {/* keyCap/labelは自身にcolorを持つため、親のcolor:'#fff'だけでは
                  上書きされない。フラッシュ中は個別に白文字へ切り替える。 */}
              <span style={{ ...s.keyCap, ...(flashed ? { color: '#fff', background: 'rgba(255,255,255,0.25)' } : {}) }}>
                {item.key}
              </span>
              <span style={{ ...s.label, ...(flashed ? { color: '#fff', fontWeight: 700 } : {}) }}>
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function makeStyles(theme) {
  return {
    wrap: {
      position: 'absolute',
      left: 14,
      bottom: 14,
      zIndex: 5,
      background: theme.mode === 'dark' ? 'rgba(15,20,30,0.88)' : 'rgba(255,255,255,0.92)',
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: '10px 12px',
      minWidth: 210,
      maxWidth: 260,
      boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
      backdropFilter: 'blur(6px)',
      pointerEvents: 'none',
    },
    title: { fontSize: 11.5, fontWeight: 700, color: theme.textMuted, marginBottom: 6 },
    list: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflowY: 'auto' },
    row: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', borderRadius: 6,
      transition: 'background 0.15s ease, transform 0.15s ease',
    },
    rowFlash: {
      // 薄いaccentSoftだと(特に明るいテーマで)ほぼ見えなかったため、押した瞬間が
      // はっきり分かるよう、はっきりした塗りつぶし色+白文字に変更した。
      background: theme.accent,
      color: '#fff',
      transform: 'scale(1.05)',
    },
    keyCap: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: 4, fontSize: 11, fontWeight: 700,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      color: theme.textStrong, flexShrink: 0,
    },
    label: { fontSize: 12, color: theme.text, lineHeight: 1.3 },
  };
}
