import React, { useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import { useTheme } from '../../themeContext';
import {
  clusterIncidentHotspots,
  formatIncidentDateTime,
  formatIncidentRelative,
} from '../../incidentHeatmap';

// 「ヒートマップボタンを押したらそこから吹き出しが出て、危険行為が多い場所で
// 何が起きたか＋直近3件を見られるようにしてほしい」という要望への対応。
// HeatmapOverlay3D(マス目の密度を色の濃淡で表す面)とは別に、実際の履歴
// (incidents)を近接クラスタリングして「件数バッジ」をクリック可能なマーカー
// として床に置き、クリックすると吹き出し(カテゴリ内訳+直近3件)を開閉する。
// 表示条件はHeatmapOverlay3Dと同じ(showHeatmap時のみRoomScene.jsxから描画)。

const MARKER_Y = 0.05;
// 何件以上をクラスタとして拾うか。1件だけの場所は「多い場所」とは言えない
// ため、2件以上まとまっている場所だけをクリック対象にする。
const HOTSPOT_MIN_COUNT = 2;
// クラスタリングの吸着半径(メートル)。ヒートマップのガウシアン広がり
// (HEATMAP_SIGMA_M=0.9)と概ね揃え、ヒートマップ上の1つの山に対して
// バッジが1つ対応するようにする。
const HOTSPOT_RADIUS_M = 0.8;

function HotspotMarker({ hotspot, isOpen, onToggle, theme }) {
  const topColor = hotspot.categoryBreakdown[0]?.color || '#f43f5e';
  return (
    <Html
      center
      distanceFactor={6}
      position={[hotspot.x, MARKER_Y + 0.5, hotspot.z]}
      occlude={false}
      zIndexRange={[100, 0]}
    >
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title="この場所で起きた危険行為を見る"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '2px solid #fff',
            background: `linear-gradient(135deg, ${topColor}, #f43f5e)`,
            color: '#fff',
            fontWeight: 800,
            fontSize: 12.5,
            lineHeight: 1,
            cursor: 'pointer',
            boxShadow: isOpen
              ? '0 0 0 4px rgba(244,63,94,0.35), 0 3px 10px rgba(0,0,0,0.4)'
              : '0 2px 10px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {hotspot.count}
        </button>

        {isOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '130%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 240,
              background: theme.mode === 'dark' ? 'rgba(15,20,30,0.96)' : 'rgba(255,255,255,0.98)',
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              padding: '10px 12px',
              boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
              textAlign: 'left',
              cursor: 'auto',
            }}
            // 吹き出し内のクリック(スクロールなど)がOrbitControlsのドラッグ判定
            // に化けないよう伝播を止める。
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: theme.textStrong,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>この場所の危険行為（計{hotspot.count}件）</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                title="閉じる"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: theme.textMuted,
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1,
                  padding: 2,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
              {hotspot.categoryBreakdown.map((c) => (
                <div
                  key={c.key}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: theme.text }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: c.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <span style={{ fontWeight: 700, color: theme.textStrong }}>{c.count}件</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10.5, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }}>
              直近3件
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {hotspot.recent.map((inc) => (
                <div key={inc.id} style={{ fontSize: 11, lineHeight: 1.35 }}>
                  <div style={{ color: theme.text }}>{inc.label}</div>
                  <div style={{ color: theme.textMuted, fontSize: 10 }}>
                    {formatIncidentDateTime(inc.time)}（{formatIncidentRelative(inc.time)}）
                  </div>
                </div>
              ))}
            </div>

            {/* 吹き出しの三角形の尾(マーカーを指し示す) */}
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                borderTop: `7px solid ${theme.mode === 'dark' ? 'rgba(15,20,30,0.96)' : 'rgba(255,255,255,0.98)'}`,
              }}
            />
          </div>
        )}
      </div>
    </Html>
  );
}

// incidents: HeatmapOverlay3Dと同じ、RoomScene.jsxから渡される絞り込み済みの
// 履歴一覧(historyApi.js経由の実データ。位置不明な項目はapprox:true付きで
// 部屋の中心に概算配置されている)。footprint自体はここでは使わないが、
// HeatmapOverlay3Dと呼び出しシグネチャを揃えておく(将来、部屋外に出た
// クラスタを弾く等の用途に使えるようにするため)。
export default function HeatmapHotspots({ incidents }) {
  const { theme } = useTheme();
  const [openKey, setOpenKey] = useState(null);

  const hotspots = useMemo(
    () => clusterIncidentHotspots(incidents, { radius: HOTSPOT_RADIUS_M, minCount: HOTSPOT_MIN_COUNT }),
    [incidents]
  );

  if (hotspots.length === 0) return null;

  return (
    <>
      {hotspots.map((h, idx) => {
        const key = `${h.x.toFixed(2)}_${h.z.toFixed(2)}_${idx}`;
        return (
          <HotspotMarker
            key={key}
            hotspot={h}
            theme={theme}
            isOpen={openKey === key}
            onToggle={() => setOpenKey((prev) => (prev === key ? null : key))}
          />
        );
      })}
    </>
  );
}
