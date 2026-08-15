import React from 'react';
import { Html } from '@react-three/drei';
import { useRoomConfig } from '../../roomConfigContext';
import { isInsideZone } from '../../poseGeometry';

// 危険/注意エリアを床の色付き矩形＋動画と同じ雰囲気のピル型ラベルで表示する。
// エリアの一覧は「家具・エリアの設定」タブで自由に追加・移動・削除できる
// (zonesプロップが渡された場合はそれを優先する。設定タブ自身の保存前プレビュー用)。
// peopleFloors: 検出された全員分のフロア座標の配列。誰か1人でもエリア内に
// いればそのエリアを「アクティブ」として強調表示する。
export default function DangerZoneMarkers({ peopleFloors, zones: zonesProp }) {
  const { zones: ctxZones } = useRoomConfig();
  const zones = zonesProp || ctxZones;
  const floors = Array.isArray(peopleFloors) ? peopleFloors : [];
  return (
    <>
      {(Array.isArray(zones) ? zones : []).map((zone) => {
        const active = floors.some((floor) => isInsideZone(floor, zone));
        const color = zone.type === 'danger' ? '#f43f5e' : '#f59e0b';

        return (
          <group key={zone.id} position={[zone.x, 0, zone.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
              <planeGeometry args={[zone.width, zone.depth]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={active ? 0.45 : 0.22}
              />
            </mesh>
            <Html center distanceFactor={6} position={[0, 0.5, 0]} occlude={false}>
              <div
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  color: zone.type === 'danger' ? '#fff' : '#3a2a06',
                  background: zone.type === 'danger' ? 'rgba(220,38,38,0.9)' : 'rgba(245,158,11,0.9)',
                  border: active ? '2px solid #fff' : '1px solid rgba(255,255,255,0.4)',
                  boxShadow: active ? '0 0 12px rgba(255,255,255,0.6)' : 'none',
                  transform: 'translateY(-50%)',
                }}
              >
                {zone.type === 'danger' ? '⚠ ' : '△ '}
                {zone.label}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
