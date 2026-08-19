import React, { useMemo, useState } from 'react';
import RoomSetupPage from '../room-setup/RoomSetupPage';
import CameraSetupPage from '../camera-setup/CameraSetupPage';
import FurnitureSetupPage from '../furniture-zone-setup/FurnitureSetupPage';
import ZoneSetupPage from '../furniture-zone-setup/ZoneSetupPage';
import DoorSensorSetupPage from '../door-sensor-setup/DoorSensorSetupPage';
import { useTheme } from '../../themeContext';
import { useViewport } from '../../hooks/useViewport';

// ===================================================================
// 【2026-08-19追加: スマホ対応・画面遷移の削減】
// 「システムをスマホ対応できるように大改良してほしい。画面遷移は少なく、
// 使いやすいように」というご要望を受け、以前はハンバーガーメニューから
// それぞれ個別のページとして遷移していた5つの設定画面
// (部屋の設定 / カメラ位置の設定 / 家具の設定 / エリアの設定 /
//  開閉センサーの設定)を、この1ページの中でタブ切り替えする形にまとめた。
// メニューを開いて項目を選ぶ操作が「メニューを開く→『各種設定』を選ぶ→
// タブを切り替える」になり、ページ単位の遷移(マウント/アンマウント)が
// 5回から1回に減る。
//
// 【重要: WebGLキャンバスの制約】各設定ページはそれぞれ独自の<RoomScene>
// (Three.js/@react-three/fiberのWebGLキャンバス)を持っている。App.jsxの
// コメントにある通り、複数のWebGLコンテキストを同時にマウントしたまま
// 裏側で描画ループを回し続けると、ページ切り替え時に画面が固まって見える
// 不具合が過去にあったため、App.jsxは「今表示しているページだけをマウント
// する」方式を取っている。このタブ切り替えも同じ考え方を1階層下で再現し、
// 非アクティブなタブのコンポーネントは描画しない(常時マウントしておいて
// CSSで隠す、という方式は採らない)。
// ===================================================================

const TABS = [
  { id: 'room', label: '部屋', Component: RoomSetupPage },
  { id: 'camera', label: 'カメラ', Component: CameraSetupPage },
  { id: 'furniture', label: '家具', Component: FurnitureSetupPage },
  { id: 'zone', label: 'エリア', Component: ZoneSetupPage },
  { id: 'doorSensor', label: 'センサー', Component: DoorSensorSetupPage },
];

export default function SettingsPage() {
  const { theme } = useTheme();
  const { isMobile } = useViewport();
  const [activeTab, setActiveTab] = useState('room');
  const s = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);

  const ActiveComponent = TABS.find((t) => t.id === activeTab)?.Component || RoomSetupPage;

  return (
    <div style={s.page}>
      {/* タブバー。スマホ幅では5つ全部を並べると窮屈になるため、横スクロール
          できるピル状のボタン列にしている(overflowX:auto)。 */}
      <div style={s.tabBarWrap}>
        <div style={s.tabBar}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{ ...s.tab, ...(activeTab === t.id ? s.tabActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* アクティブなタブのページだけをマウントする(上記コメント参照)。
          各ページ自身の見出し・説明文・保存ボタンなどはそのまま残しているため、
          タブバーの下に元のページがそのまま表示される見た目になる。 */}
      <ActiveComponent />
    </div>
  );
}

function makeStyles(theme, isMobile) {
  return {
    page: { background: theme.pageBg, minHeight: '100vh' },
    tabBarWrap: {
      position: 'sticky',
      top: 0,
      zIndex: 5,
      background: theme.pageBg,
      borderBottom: `1px solid ${theme.border}`,
      padding: isMobile ? '10px 10px 0' : '14px 32px 0',
    },
    tabBar: {
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      // スクロールバーが常時見えると見た目が煩雑になるため細くする程度に留め、
      // 非表示にはしない(スクロールできることが分かるようにするため)。
      paddingBottom: 10,
    },
    tab: {
      flexShrink: 0,
      whiteSpace: 'nowrap',
      fontSize: 13.5,
      fontWeight: 600,
      padding: isMobile ? '9px 16px' : '9px 18px',
      borderRadius: 999,
      border: `1px solid ${theme.borderSoft}`,
      background: 'transparent',
      color: theme.textMuted,
      cursor: 'pointer',
    },
    // 【不具合修正】ここを borderColor だけの上書きにすると、タブの
    // border(shorthand)と混在してReactが「Removing borderColor border …」
    // という警告を出す(shorthandとlonghandの混在)。tabと同じ border
    // shorthandで丸ごと上書きするようにして警告を防いでいる。
    tabActive: {
      background: theme.accentSoft,
      color: theme.accent,
      border: `1px solid ${theme.accentBorder}`,
    },
  };
}
