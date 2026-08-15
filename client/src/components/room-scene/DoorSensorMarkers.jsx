import React from 'react';
import { Html } from '@react-three/drei';
import { useRoomConfig } from '../../roomConfigContext';

// 開閉センサー(玄関・勝手口などのドアに取り付けたセンサー)を3Dシーン上に
// 小さなドアのアイコンで表示する。閉(closed)は緑、開(open)は赤で示し、
// 一目で「今どこかのドアが開いたままになっていないか」が分かるようにする。
// DangerZoneMarkers.jsxと同じ考え方(Html labelでの簡易表示)を踏襲している。
export default function DoorSensorMarkers({ doorSensors: sensorsProp }) {
  const { doorSensors: ctxDoorSensors } = useRoomConfig();
  const sensors = sensorsProp || ctxDoorSensors;

  return (
    <>
      {(Array.isArray(sensors) ? sensors : []).map((sensor) => {
        const isOpen = sensor.status === 'open';
        const color = isOpen ? '#f43f5e' : '#22c55e';
        return (
          <group key={sensor.id} position={[sensor.x, 0, sensor.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
              <circleGeometry args={[0.16, 20]} />
              <meshBasicMaterial color={color} transparent opacity={isOpen ? 0.5 : 0.32} />
            </mesh>
            <Html center distanceFactor={6} position={[0, 0.35, 0]} occlude={false}>
              <div
                style={{
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  color: '#fff',
                  background: isOpen ? 'rgba(220,38,38,0.9)' : 'rgba(22,163,74,0.9)',
                  border: isOpen ? '2px solid #fff' : '1px solid rgba(255,255,255,0.4)',
                  boxShadow: isOpen ? '0 0 12px rgba(255,255,255,0.6)' : 'none',
                  transform: 'translateY(-50%)',
                }}
              >
                {isOpen ? '🚪 開' : '🚪 閉'} {sensor.label}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
