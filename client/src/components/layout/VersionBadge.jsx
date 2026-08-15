import React from 'react';
import { useTheme } from '../../themeContext';
import { APP_VERSION } from '../../config';

// 画面右下に小さく表示するバージョン表示。「MM.DD.N」形式(config.jsのAPP_VERSION参照)。
// クリック・操作の邪魔にならないよう、控えめな色・小さいフォントサイズにし、
// pointerEvents: 'none' でマウス操作も透過させている。
export default function VersionBadge() {
  const { theme } = useTheme();
  return (
    <div
      style={{
        position: 'fixed',
        right: 10,
        bottom: 8,
        fontSize: 10.5,
        color: theme.textFaint,
        opacity: 0.7,
        fontFamily: 'monospace',
        pointerEvents: 'none',
        zIndex: 1200,
        userSelect: 'none',
      }}
    >
      version:{APP_VERSION}
    </div>
  );
}
