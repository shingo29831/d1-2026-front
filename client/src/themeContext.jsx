import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

// ===================================================================
// ダークモード/ホワイトモードの切り替えを、アプリ全体(通常のHTML画面と
// Three.jsの3Dシーンの両方)に反映するためのコンテキスト。
// ・選択したモードはlocalStorageに保存し、次回起動時にも復元する。
// ・各コンポーネントは useTheme() で色パレット(theme)を取得し、
//   ハードコードされた色の代わりにこれを使うことで両モードに対応する。
// ===================================================================

const STORAGE_KEY = 'system1.theme.v1';
const ThemeContext = createContext(null);

const PALETTES = {
  dark: {
    mode: 'dark',
    pageBg: '#0a0a0a',
    appBg: '#090b11',
    panelBg: '#0d111a',
    panelBgAlt: '#0b0e15',
    border: '#1f2937',
    borderSoft: '#263042',
    text: '#e5e9f0',
    textStrong: '#f8fafc',
    textMuted: '#94a3b8',
    textFaint: '#64748b',
    accent: '#22d3ee',
    accentSoft: 'rgba(34,211,238,0.12)',
    accentBorder: 'rgba(34,211,238,0.4)',
    inputBg: '#0a0e16',
    danger: '#f87171',
    warning: '#f59e0b',
    sceneBg: '#0d1420',
    sceneFloor: '#c9bfa8',
    sceneWallOpacity: 0.12,
    sceneGrid1: '#1f2937',
    sceneGrid2: '#141a24',
    sceneAmbient: 0.55,
    sceneHemiSky: '#3b4a63',
    sceneHemiGround: '#0a0d14',
  },
  light: {
    mode: 'light',
    pageBg: '#f3f5f9',
    appBg: '#eef1f6',
    panelBg: '#ffffff',
    panelBgAlt: '#f5f7fb',
    border: '#dbe2ec',
    borderSoft: '#c7d0dd',
    text: '#1e293b',
    textStrong: '#0f172a',
    textMuted: '#51607a',
    textFaint: '#8492a8',
    accent: '#0891b2',
    accentSoft: 'rgba(8,145,178,0.1)',
    accentBorder: 'rgba(8,145,178,0.4)',
    inputBg: '#ffffff',
    danger: '#dc2626',
    warning: '#d97706',
    sceneBg: '#dce7f2',
    sceneFloor: '#ecdfc4',
    sceneWallOpacity: 0.16,
    sceneGrid1: '#c3cedd',
    sceneGrid2: '#aeb9c9',
    sceneAmbient: 0.9,
    sceneHemiSky: '#ffffff',
    sceneHemiGround: '#c7d2e0',
  },
};

function loadSaved() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }) {
  // 既定はホワイトモード(未選択時)。一度でも切り替えれば、その選択がlocalStorageに
  // 保存され、次回起動時もその選択が復元される。
  const [mode, setMode] = useState(() => loadSaved() || 'light');

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 保存できなくても致命的ではないため無視
    }
    if (typeof document !== 'undefined') {
      document.body.style.background = PALETTES[mode].pageBg;
      document.body.style.transition = 'background 0.15s ease';
    }
  }, [mode]);

  const toggleTheme = useCallback(() => {
    setMode((m) => (m === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({
    mode,
    theme: PALETTES[mode],
    toggleTheme,
    setMode,
  }), [mode, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() はThemeProviderの内側でのみ使用できます。');
  }
  return ctx;
}
