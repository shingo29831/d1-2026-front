import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTheme } from '../../themeContext';

export default function RiskSuggestionMarkers({ suggestions }) {
  const { theme } = useTheme();
  
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  return (
    <group>
      {suggestions.map((sug) => (
        <RiskSuggestionMarker key={sug.id} suggestion={sug} theme={theme} />
      ))}
    </group>
  );
}

function RiskSuggestionMarker({ suggestion, theme }) {
  const materialRef = useRef();
  
  const { x, z, radius } = suggestion;
  
  // 座標が未確定の場合は描画しない
  if (x == null || z == null) return null;
  
  // 半径が未指定の場合はデフォルト1.0m
  const r = radius || 1.0;
  
  // 注意喚起のため、ゆっくりと点滅させるアニメーション
  useFrame(({ clock }) => {
    if (materialRef.current) {
      const t = clock.getElapsedTime();
      materialRef.current.opacity = 0.2 + Math.sin(t * 2) * 0.15;
    }
  });

  return (
    <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[r, 32]} />
      <meshBasicMaterial 
        ref={materialRef}
        color={theme.mode === 'dark' ? '#fbbf24' : '#f59e0b'} // サジェスト用のアンバー色
        transparent 
        depthWrite={false}
      />
    </mesh>
  );
}