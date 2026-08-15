import React, { useMemo, useRef, useState } from 'react';
import RoomScene from '../room-scene/RoomScene';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintBounds, nearestEdgePoint, normalToYawDeg, yawDegToDir } from '../../roomShapes';

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;
const HEIGHT_LIMITS = { min: 0.5, max: 2.6, step: 0.1 };
const FOV_LIMITS = { min: 30, max: 120, step: 1 };
// 上下の角度(pitch)。0=水平、正の値ほど下向き、負の値は上向き。
// 真下や真上まで振り切れる機種は稀なので±75°程度に制限している。
const PITCH_LIMITS = { min: -75, max: 75, step: 1 };
const DRAG_THRESHOLD_PX = 3;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// 「カメラ位置の設定」タブ。
// 【Role C仕様書 Step 4「リアルタイムアラートの3Dマッピング」との対応】
// ここで決める設置位置(cameraMount)・向き(cameraYawDeg)・視野角(cameraFovDeg)が、
// 仕様書の「カメラの外部パラメータ(3D空間内での位置・姿勢行列)」に相当し、
// Three.jsシーン内の仮想カメラ配置(CameraMount.jsx)に使われる。ただし歪み係数等の
// 内部パラメータやRole Aからのキャリブレーション行列を用いた逆投影/Raycasterでの
// 座標算出は未実装(詳細はROLE_C_SPEC_ALIGNMENT.md参照)。
// 「壁に固定」モードでは間取り図の中をクリックすると、一番近い壁にカメラが
// 自動的に吸着配置される(実機は壁掛けカメラのため)。「自由配置」モードでは
// 部屋の中の好きな位置に置き、向き(角度)を自由に設定できる。
// 視野角(FOV)はスライダーで調整でき、間取り図・3Dプレビューの両方に反映される。
export default function CameraSetupPage() {
  const {
    footprint, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraMode, zones,
    setCameraPlacement, setCameraPitch, setCameraFov, defaults,
  } = useRoomConfig();
  const { theme } = useTheme();

  const [draftMount, setDraftMount] = useState(cameraMount);
  const [draftYaw, setDraftYaw] = useState(cameraYawDeg);
  const [draftPitch, setDraftPitch] = useState(cameraPitchDeg);
  const [draftFov, setDraftFov] = useState(cameraFovDeg);
  const [draftMode, setDraftMode] = useState(cameraMode || 'wall');
  const [saved, setSaved] = useState(false);
  const [previewMode, setPreviewMode] = useState('overview');

  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const scale = useMemo(() => {
    const spanX = bounds.width + 1.2;
    const spanZ = bounds.depth + 1.2;
    return Math.min((SVG_W - PAD * 2) / spanX, (SVG_H - PAD * 2) / spanZ);
  }, [bounds]);
  const originX = SVG_W / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const originY = SVG_H / 2 - ((bounds.minZ + bounds.maxZ) / 2) * scale;
  const roomToSvg = (x, z) => ({ sx: originX + x * scale, sy: originY + z * scale });
  const svgToRoom = (sx, sy) => ({ x: (sx - originX) / scale, z: (sy - originY) / scale });

  const polygonPoints = footprint.map((p) => {
    const { sx, sy } = roomToSvg(p.x, p.z);
    return `${sx},${sy}`;
  }).join(' ');

  // クリック(またはドラッグ)された部屋座標を、現在の設置モードに応じて
  // カメラの位置(・壁固定モードでは向きも)に反映する共通処理。
  const applyRoomPosition = (roomX, roomZ) => {
    if (draftMode === 'wall') {
      const nearest = nearestEdgePoint(roomX, roomZ, footprint);
      if (!nearest) return;
      setDraftMount((prev) => ({ x: nearest.x, y: prev.y, z: nearest.z }));
      setDraftYaw(normalToYawDeg(nearest.normalX, nearest.normalZ));
    } else {
      const cx = clamp(roomX, bounds.minX + 0.05, bounds.maxX - 0.05);
      const cz = clamp(roomZ, bounds.minZ + 0.05, bounds.maxZ - 0.05);
      setDraftMount((prev) => ({ x: cx, y: prev.y, z: cz }));
    }
  };

  // clientX/clientYからSVGのビューボックス座標→部屋座標に変換するヘルパー。
  const clientToRoom = (clientX, clientY) => {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const sx = (clientX - rect.left) * (SVG_W / rect.width);
    const sy = (clientY - rect.top) * (SVG_H / rect.height);
    return svgToRoom(sx, sy);
  };

  const handleClick = (e) => {
    setSaved(false);
    const { x: roomX, z: roomZ } = clientToRoom(e.clientX, e.clientY);
    applyRoomPosition(roomX, roomZ);
  };

  // カメラマーカー自体をマウスでドラッグして移動できるようにする
  // (Pointer Events APIを使用。家具・エリアの設定ページと同じパターン)。
  const handleMarkerPointerDown = (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
  };

  const handleMarkerPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setSaved(false);
    const { x: roomX, z: roomZ } = clientToRoom(e.clientX, e.clientY);
    applyRoomPosition(roomX, roomZ);
  };

  const handleMarkerPointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // ドラッグせず単純にクリックしただけの場合は、その位置にもカメラを移動する
    // (マーカーをクリックしても違和感がないよう、背景クリックと同じ挙動にする)。
    if (!drag.moved) {
      setSaved(false);
      const { x: roomX, z: roomZ } = clientToRoom(e.clientX, e.clientY);
      applyRoomPosition(roomX, roomZ);
    }
  };

  const handleModeChange = (mode) => {
    setSaved(false);
    setDraftMode(mode);
  };

  const handleHeightChange = (value) => {
    setSaved(false);
    setDraftMount((prev) => ({ ...prev, y: Number(value) }));
  };

  const handleYawChange = (value) => {
    setSaved(false);
    setDraftYaw(Number(value));
  };

  const handlePitchChange = (value) => {
    setSaved(false);
    setDraftPitch(Number(value));
  };

  const handleFovChange = (value) => {
    setSaved(false);
    setDraftFov(Number(value));
  };

  const handleSave = () => {
    setCameraPlacement(draftMount, draftYaw, draftMode);
    setCameraPitch(draftPitch);
    setCameraFov(draftFov);
    setSaved(true);
  };

  const handleReset = () => {
    setDraftMount(defaults.cameraMount);
    setDraftYaw(defaults.cameraYawDeg);
    setDraftPitch(defaults.cameraPitchDeg);
    setDraftFov(defaults.cameraFovDeg);
    setDraftMode('wall');
    setCameraPlacement(defaults.cameraMount, defaults.cameraYawDeg, 'wall');
    setCameraPitch(defaults.cameraPitchDeg);
    setCameraFov(defaults.cameraFovDeg);
    setSaved(false);
  };

  const markerPos = roomToSvg(draftMount.x, draftMount.z);
  const dir = yawDegToDir(draftYaw);
  const visRange = Math.max(bounds.width, bounds.depth) * 0.4 + 0.6;
  const yawRad = (draftYaw * Math.PI) / 180;
  const halfFovRad = (draftFov * Math.PI) / 360;
  const wedgeSegments = 12;
  const wedgeSvgPoints = [markerPos];
  for (let i = 0; i <= wedgeSegments; i++) {
    const t = yawRad - halfFovRad + (2 * halfFovRad * i) / wedgeSegments;
    const wx = draftMount.x + visRange * Math.sin(t);
    const wz = draftMount.z + visRange * Math.cos(t);
    wedgeSvgPoints.push(roomToSvg(wx, wz));
  }
  const wedgePathStr = wedgeSvgPoints.map((p) => `${p.sx},${p.sy}`).join(' ');
  const arrowEnd = roomToSvg(draftMount.x + dir.x * (visRange * 0.55), draftMount.z + dir.z * (visRange * 0.55));

  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <div style={s.page}>
      <h2 style={s.h2}>カメラ位置の設定</h2>
      <p style={s.lead}>
        見守りカメラを実際にどこへ設置するか決めるページです。「壁に固定」では間取り図内をクリックすると
        一番近い壁にカメラが自動的に吸着して配置されます(実機は壁掛けカメラのため)。「自由配置」では
        部屋の中の好きな位置にカメラを置き、向き(角度)を自由に回転させられます。視野角(FOV)は
        水色の扇形で表示されます。
      </p>

      <div style={s.grid}>
        <section style={s.card}>
          <h3 style={s.h3}>設置方法</h3>
          <div style={s.shapeTabs}>
            <button onClick={() => handleModeChange('wall')} style={{ ...s.shapeTab, ...(draftMode === 'wall' ? s.shapeTabActive : {}) }}>壁に固定</button>
            <button onClick={() => handleModeChange('free')} style={{ ...s.shapeTab, ...(draftMode === 'free' ? s.shapeTabActive : {}) }}>自由配置</button>
          </div>

          <h3 style={s.h3}>間取り図(真上から見た図)</h3>
          <p style={s.desc}>部屋の中をクリック/タップしてカメラの位置を選んでください。水色の扇形が視野角(FOV)の目安です。</p>

          <svg ref={svgRef} width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={s.svg} onClick={handleClick}>
            <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={s.svgBg} />
            <polygon points={polygonPoints} fill={theme.mode === 'dark' ? '#161c28' : '#ffffff'} stroke={theme.borderSoft} strokeWidth={2} />

            {(Array.isArray(zones) ? zones : []).map((zone) => {
              const tl = roomToSvg(zone.x - zone.width / 2, zone.z - zone.depth / 2);
              const br = roomToSvg(zone.x + zone.width / 2, zone.z + zone.depth / 2);
              return (
                <rect
                  key={zone.id}
                  x={tl.sx} y={tl.sy} width={br.sx - tl.sx} height={br.sy - tl.sy}
                  fill={zone.type === 'danger' ? 'rgba(244,63,94,0.25)' : 'rgba(245,158,11,0.22)'}
                  stroke={zone.type === 'danger' ? '#f43f5e' : '#f59e0b'}
                  strokeWidth={1}
                />
              );
            })}

            {/* 視野角(FOV)の扇形 */}
            <polygon points={wedgePathStr} fill={theme.accent} opacity={0.18} />

            {/* 向き(矢印) */}
            <line x1={markerPos.sx} y1={markerPos.sy} x2={arrowEnd.sx} y2={arrowEnd.sy} stroke={theme.accent} strokeWidth={2} markerEnd="url(#arrowhead)" />
            <defs>
              <marker id="arrowhead" markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill={theme.accent} />
              </marker>
            </defs>
            {/* カメラマーカー(ドラッグして移動可能) */}
            <circle
              cx={markerPos.sx}
              cy={markerPos.sy}
              r={10}
              fill={theme.mode === 'dark' ? '#0e7490' : '#0891b2'}
              stroke={theme.accent}
              strokeWidth={2}
              style={{ cursor: 'grab', touchAction: 'none' }}
              onPointerDown={handleMarkerPointerDown}
              onPointerMove={handleMarkerPointerMove}
              onPointerUp={handleMarkerPointerUp}
            />
          </svg>
          <p style={s.hint}>カメラのマーカー(水色の丸)は、間取り図上でドラッグしても移動できます。</p>

          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>高さ</span>
            <input
              type="range" min={HEIGHT_LIMITS.min} max={HEIGHT_LIMITS.max} step={HEIGHT_LIMITS.step}
              value={draftMount.y} onChange={(e) => handleHeightChange(e.target.value)} style={s.range}
            />
            <span style={s.unit}>{draftMount.y.toFixed(1)}m</span>
          </div>

          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>向き</span>
            <input
              type="range" min={0} max={359} step={1} value={Math.round(draftYaw)} disabled={draftMode === 'wall'}
              onChange={(e) => handleYawChange(e.target.value)} style={s.range}
            />
            <span style={s.unit}>{Math.round(draftYaw)}°</span>
          </div>
          {draftMode === 'wall' && (
            <p style={s.hint}>「壁に固定」では向きは壁の内向きに自動設定されます。「自由配置」に切り替えると自由に回転できます。</p>
          )}

          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>上下角度</span>
            <input
              type="range" min={PITCH_LIMITS.min} max={PITCH_LIMITS.max} step={PITCH_LIMITS.step}
              value={draftPitch} onChange={(e) => handlePitchChange(e.target.value)} style={s.range}
            />
            <span style={s.unit}>{draftPitch > 0 ? `↓${draftPitch}°` : draftPitch < 0 ? `↑${-draftPitch}°` : '0°'}</span>
          </div>
          <p style={s.hint}>カメラの上下の傾き(チルト角)です。値が大きいほど下向きに、小さい(マイナス)ほど上向きになります。「カメラの視点」プレビューに反映されます。</p>

          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>視野角</span>
            <input
              type="range" min={FOV_LIMITS.min} max={FOV_LIMITS.max} step={FOV_LIMITS.step}
              value={draftFov} onChange={(e) => handleFovChange(e.target.value)} style={s.range}
            />
            <span style={s.unit}>{draftFov}°</span>
          </div>

          <div style={s.btnRow}>
            <button style={s.primaryBtn} onClick={handleSave}>この位置で保存</button>
            <button style={s.ghostBtn} onClick={handleReset}>初期設定(短辺中央)に戻す</button>
          </div>
          {saved && <div style={s.savedNote}>保存しました。見守りダッシュボードに反映されています。</div>}
        </section>

        <section style={s.card}>
          <div style={s.previewHeader}>
            <h3 style={{ ...s.h3, margin: 0 }}>プレビュー</h3>
            <div style={s.toggleGroup}>
              <button
                onClick={() => setPreviewMode('overview')}
                style={{ ...s.toggleBtn, ...(previewMode === 'overview' ? s.toggleBtnActive : {}) }}
              >
                俯瞰3D
              </button>
              <button
                onClick={() => setPreviewMode('pov')}
                style={{ ...s.toggleBtn, ...(previewMode === 'pov' ? s.toggleBtnActive : {}) }}
              >
                カメラの視点
              </button>
            </div>
          </div>
          <p style={s.desc}>保存前でもここに反映されます。「カメラの視点」で実際の見え方を確認できます。</p>
          <div style={s.previewWrap}>
            <RoomScene
              viewMode={previewMode}
              people={[]}
              previewCameraMount={draftMount}
              previewCameraYawDeg={draftYaw}
              previewCameraPitchDeg={draftPitch}
              previewCameraFovDeg={draftFov}
              solidWalls
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function makeStyles(theme) {
  const svgBg = theme.mode === 'dark' ? '#0a0e16' : '#eef2f8';
  return {
    svgBg,
    page: { padding: '24px 32px 48px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' },
    h2: { marginTop: 0, marginBottom: 6, color: theme.textStrong, fontSize: 22 },
    h3: { margin: '14px 0 8px', fontSize: 15.5, color: theme.textStrong },
    lead: { color: theme.textMuted, maxWidth: 1100, lineHeight: 1.7, fontSize: 14.5, marginBottom: 24 },
    // 他の設定画面(部屋の設定・接続状況など)と統一感を持たせるため、
    // カードは3列のグリッドに並べる(このページはカードが2枚のため、
    // 3列目は空くが、それでよい)。
    grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'start' },
    card: { background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 20, minWidth: 0 },
    desc: { fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 14 },
    hint: { fontSize: 12.5, color: theme.textFaint, lineHeight: 1.6, margin: '4px 0 8px' },
    shapeTabs: { display: 'flex', gap: 8, marginBottom: 8 },
    shapeTab: { flex: 1, fontSize: 13, padding: '10px 8px', borderRadius: 8, border: `1px solid ${theme.borderSoft}`, background: 'transparent', color: theme.textMuted, cursor: 'pointer' },
    shapeTabActive: { background: theme.accentSoft, color: theme.accent, borderColor: theme.accentBorder },
    svg: { background: svgBg, borderRadius: 10, cursor: 'crosshair', width: '100%', height: 'auto' },
    fieldRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 },
    fieldLabel: { width: 48, fontSize: 13.5, color: theme.textMuted },
    range: { flex: 1 },
    unit: { fontSize: 13, color: theme.accent, width: 48, textAlign: 'right' },
    btnRow: { display: 'flex', gap: 10, marginTop: 16 },
    primaryBtn: { padding: '10px 18px', fontSize: 13.5, fontWeight: 700, background: theme.accent, color: theme.mode === 'dark' ? '#04222a' : '#ffffff', border: `1px solid ${theme.accentBorder}`, borderRadius: 8, cursor: 'pointer' },
    ghostBtn: { padding: '10px 18px', fontSize: 13.5, background: 'transparent', color: theme.textMuted, border: `1px solid ${theme.borderSoft}`, borderRadius: 8, cursor: 'pointer' },
    savedNote: { marginTop: 12, fontSize: 13, color: theme.accent },
    previewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    toggleGroup: { display: 'flex', gap: 6 },
    toggleBtn: { fontSize: 12.5, padding: '6px 12px', borderRadius: 6, border: `1px solid ${theme.borderSoft}`, background: 'transparent', color: theme.textMuted, cursor: 'pointer' },
    toggleBtnActive: { background: theme.accentSoft, color: theme.accent, borderColor: theme.accentBorder },
    previewWrap: { width: '100%', height: 460, background: theme.panelBgAlt, borderRadius: 10, overflow: 'hidden', marginTop: 14 },
  };
}
