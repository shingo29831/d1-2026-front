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
  
  const area = suggestion.details?.suggested_area;
  if (!area) return null;
  
  const { x, z, radius } = area;
  
  // 注意喚起のため、ゆっくりと点滅させる
  useFrame(({ clock }) => {
    if (materialRef.current) {
      const t = clock.getElapsedTime();
      materialRef.current.opacity = 0.2 + Math.sin(t * 2) * 0.15;
    }
  });

  return (
    <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 32]} />
      <meshBasicMaterial 
        ref={materialRef}
        color={theme.mode === 'dark' ? '#fbbf24' : '#f59e0b'} // サジェスト用のアンバー色
        transparent 
        depthWrite={false}
      />
    </mesh>
  );
}