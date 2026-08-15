import React, { useMemo, useRef, useState } from 'react';
import RoomScene from '../room-scene/RoomScene';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintBounds } from '../../roomShapes';

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;
const DRAG_THRESHOLD_PX = 3;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// 「開閉センサーの設定」タブ。
// 【Role C仕様書との対応】仕様書の共通JSONスキーマ(ROLE_C_SPEC_ALIGNMENT.md参照)
// では、実際のセンサーからのイベントは
// `{ device_id, room_id, timestamp, event_type: "sensor_alert",
//    details: { sensor_type: "door", status, battery_level } }`
// という形で届く想定になっている。このページでは、実際に玄関・勝手口などに
// 取り付けている開閉センサーが「間取り図上のどこにあるか」「実機のdevice_idは
// 何か」を登録・管理する(=Role Aから届くイベントのdevice_idと、この画面で
// 登録した位置情報を突き合わせるための台帳)。
// 「現在の状態」はテスト用にこの画面から手動で開/閉を切り替えられるが、
// 実際の運用では実機からのMQTT/IoT Coreイベント(sensor_alert)によって
// 更新される想定(そちらのUI配線はまだ、ROLE_C_SPEC_ALIGNMENT.md参照)。
export default function DoorSensorSetupPage() {
  const {
    footprint, furniture, zones, doorSensors,
    addDoorSensor, updateDoorSensor, removeDoorSensor, resetDoorSensors,
  } = useRoomConfig();
  const { theme } = useTheme();

  const [selectedId, setSelectedId] = useState(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [dragPos, setDragPos] = useState(null);

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

  const selectItem = (id) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const eventToRoom = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (SVG_W / rect.width);
    const sy = (e.clientY - rect.top) * (SVG_H / rect.height);
    const { x, z } = svgToRoom(sx, sy);
    return { x: clamp(x, bounds.minX, bounds.maxX), z: clamp(z, bounds.minZ, bounds.maxZ) };
  };

  const handleBgClick = (e) => {
    const { x: cx, z: cz } = eventToRoom(e);
    if (selectedId) {
      updateDoorSensor(selectedId, { x: cx, z: cz });
      return;
    }
    const id = addDoorSensor({ x: cx, z: cz });
    setSelectedId(id);
  };

  const handleItemPointerDown = (id) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id, moved: false, startClientX: e.clientX, startClientY: e.clientY };
  };

  const handleItemPointerMove = (id) => (e) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const { x, z } = eventToRoom(e);
    setDragPos({ id, x, z });
  };

  const handleItemPointerUp = (id) => (e) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    if (drag.moved) {
      const { x, z } = eventToRoom(e);
      updateDoorSensor(id, { x, z });
    } else {
      selectItem(id);
    }
    dragRef.current = null;
    setDragPos(null);
  };

  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <div style={s.page}>
      <h2 style={s.h2}>開閉センサーの設定</h2>
      <p style={s.lead}>
        玄関・勝手口などに取り付ける開閉センサー(仕様書の共通JSONスキーマにおける
        <code style={s.code}>sensor_type: "door"</code>)を、間取り図上のどこに設置したかと、
        実機と対応する device_id を登録・管理するページです。間取り図の何もない場所をクリックすると
        新しく追加されます。一覧から項目を選んでから間取り図をクリックすると、その項目をクリックした
        位置へ移動できます。「状態」は実際にはRole A側のセンサー本体から届くイベントで自動更新される
        想定ですが、この画面からもテスト用に手動で切り替えられます。
      </p>

      <div style={s.grid}>
        <section style={s.card}>
          <p style={s.desc}>
            {selectedId
              ? '項目を選択中です。間取り図をクリックすると、その項目をクリックした位置へ移動します。'
              : '間取り図をクリックすると、その位置に新しい開閉センサーを追加します。'}
          </p>

          <svg ref={svgRef} width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={s.svg}>
            <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={s.svgBg} onClick={handleBgClick} />
            <polygon
              points={polygonPoints}
              fill={theme.mode === 'dark' ? '#161c28' : '#ffffff'}
              stroke={theme.borderSoft}
              strokeWidth={2}
              onClick={handleBgClick}
              style={{ cursor: 'crosshair' }}
            />

            {/* 家具・エリアは位置関係が分かるよう薄く表示するのみ(編集はできない)。 */}
            {(Array.isArray(zones) ? zones : []).map((zone) => {
              const tl = roomToSvg(zone.x - zone.width / 2, zone.z - zone.depth / 2);
              const br = roomToSvg(zone.x + zone.width / 2, zone.z + zone.depth / 2);
              return (
                <rect
                  key={`ctx-zone-${zone.id}`}
                  x={tl.sx} y={tl.sy} width={Math.max(2, br.sx - tl.sx)} height={Math.max(2, br.sy - tl.sy)}
                  fill={zone.type === 'danger' ? 'rgba(244,63,94,0.18)' : 'rgba(245,158,11,0.16)'}
                  stroke={zone.type === 'danger' ? '#f43f5e' : '#f59e0b'} strokeWidth={1} strokeDasharray="4 3"
                  style={{ pointerEvents: 'none' }} opacity={0.6}
                />
              );
            })}
            {(Array.isArray(furniture) ? furniture : []).map((f) => {
              const tl = roomToSvg(f.x - f.width / 2, f.z - f.depth / 2);
              const br = roomToSvg(f.x + f.width / 2, f.z + f.depth / 2);
              const center = roomToSvg(f.x, f.z);
              return (
                <rect
                  key={`ctx-furniture-${f.id}`}
                  x={tl.sx} y={tl.sy} width={Math.max(2, br.sx - tl.sx)} height={Math.max(2, br.sy - tl.sy)}
                  fill={f.color || '#8b6b47'} stroke={theme.borderSoft} strokeWidth={1} strokeDasharray="4 3" rx={3}
                  style={{ pointerEvents: 'none' }} opacity={0.35}
                  transform={`rotate(${f.rotationDeg || 0} ${center.sx} ${center.sy})`}
                />
              );
            })}

            {/* 開閉センサー本体(クリック・ドラッグで編集可能) */}
            {doorSensors.map((sensor) => {
              const isDragging = dragPos && dragPos.id === sensor.id;
              const sx = isDragging ? dragPos.x : sensor.x;
              const sz = isDragging ? dragPos.z : sensor.z;
              const center = roomToSvg(sx, sz);
              const isSel = selectedId === sensor.id;
              const isOpen = sensor.status === 'open';
              return (
                <g
                  key={sensor.id}
                  onPointerDown={handleItemPointerDown(sensor.id)}
                  onPointerMove={handleItemPointerMove(sensor.id)}
                  onPointerUp={handleItemPointerUp(sensor.id)}
                  style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                >
                  <circle
                    cx={center.sx} cy={center.sy} r={11}
                    fill={isOpen ? 'rgba(244,63,94,0.85)' : 'rgba(34,197,94,0.85)'}
                    stroke={isSel ? theme.accent : '#ffffff'}
                    strokeWidth={isSel || isDragging ? 3 : 1.5}
                  />
                  <text
                    x={center.sx} y={center.sy - 16} fontSize={11.5} textAnchor="middle" fontWeight={700}
                    fill={theme.mode === 'dark' ? '#fff' : '#1f2937'} style={{ pointerEvents: 'none' }}
                  >
                    🚪 {sensor.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {selectedId && (
            <div style={s.btnRow}>
              <button style={s.ghostBtn} onClick={() => setSelectedId(null)}>選択解除</button>
            </div>
          )}
        </section>

        <section style={s.card}>
          <h3 style={s.h3}>3Dプレビュー</h3>
          <p style={s.desc}>緑=閉、赤=開。配置・編集した内容は保存操作なしですぐにここと見守りダッシュボードに反映されます。</p>
          <div style={s.previewWrap}>
            <RoomScene viewMode="overview" people={[]} solidWalls />
          </div>
        </section>
      </div>

      <div style={s.listGrid}>
        <section style={s.card}>
          <h3 style={s.h3}>🚪 開閉センサー一覧({doorSensors.length})</h3>
          {doorSensors.length === 0 && <p style={s.emptyNote}>まだ開閉センサーがありません。上の間取り図をクリックして追加してください。</p>}
          <div style={s.rowList}>
            {doorSensors.map((sensor) => (
              <SensorRow
                key={sensor.id}
                item={sensor}
                s={s}
                selected={selectedId === sensor.id}
                onSelect={() => selectItem(sensor.id)}
                onChange={(patch) => updateDoorSensor(sensor.id, patch)}
                onRemove={() => { removeDoorSensor(sensor.id); if (selectedId === sensor.id) setSelectedId(null); }}
              />
            ))}
          </div>
        </section>
      </div>

      <div style={s.btnRow}>
        <button style={s.ghostBtn} onClick={() => { resetDoorSensors(); setSelectedId(null); }}>初期設定(玄関・勝手口)に戻す</button>
      </div>
    </div>
  );
}

function SensorRow({ item, s, selected, onSelect, onChange, onRemove }) {
  const isOpen = item.status === 'open';
  return (
    <div style={{ ...s.row, ...(selected ? s.rowSelected : {}) }} onClick={onSelect}>
      <input
        type="text" value={item.label} onChange={(e) => onChange({ label: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.labelInput} placeholder="ラベル(例: 玄関ドア)"
      />
      <input
        type="text" value={item.deviceId || ''} onChange={(e) => onChange({ deviceId: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.deviceIdInput} placeholder="device_id"
        title="実機のdevice_id。Role Aから届くイベントのdevice_idと一致させてください。"
      />
      <button
        onClick={(e) => { e.stopPropagation(); onChange({ status: isOpen ? 'closed' : 'open' }); }}
        style={{ ...s.statusBtn, ...(isOpen ? s.statusBtnOpen : s.statusBtnClosed) }}
        title="テスト用に状態を切り替えます(実際にはセンサー本体からのイベントで自動更新される想定です)"
      >
        {isOpen ? '🔴 開' : '🟢 閉'}
      </button>
      <button style={s.deleteBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }} title="削除">✕</button>
    </div>
  );
}

function makeStyles(theme) {
  const svgBg = theme.mode === 'dark' ? '#0a0e16' : '#eef2f8';
  return {
    svgBg,
    page: { padding: '24px 32px 48px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' },
    h2: { marginTop: 0, marginBottom: 6, color: theme.textStrong, fontSize: 22 },
    h3: { margin: '0 0 12px', fontSize: 15.5, color: theme.textStrong },
    lead: { color: theme.textMuted, maxWidth: 1100, lineHeight: 1.7, fontSize: 14.5, marginBottom: 24 },
    code: {
      background: theme.panelBgAlt, border: `1px solid ${theme.borderSoft}`, borderRadius: 5,
      padding: '1px 6px', fontSize: 13, color: theme.accent,
    },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'start' },
    card: { background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 20, minWidth: 0 },
    desc: { fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 14 },
    svg: { background: svgBg, borderRadius: 10, width: '100%', height: 'auto' },
    btnRow: { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' },
    ghostBtn: { padding: '10px 18px', fontSize: 13.5, background: 'transparent', color: theme.textMuted, border: `1px solid ${theme.borderSoft}`, borderRadius: 8, cursor: 'pointer' },
    previewWrap: { width: '100%', height: 460, background: theme.panelBgAlt, borderRadius: 10, overflow: 'hidden' },
    listGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'start', marginTop: 24 },
    emptyNote: { fontSize: 13, color: theme.textFaint, lineHeight: 1.6 },
    rowList: { display: 'flex', flexDirection: 'column', gap: 8 },
    row: {
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`, background: theme.panelBgAlt, cursor: 'pointer', flexWrap: 'wrap',
    },
    rowSelected: { borderColor: theme.accentBorder, background: theme.accentSoft },
    labelInput: {
      flex: '1 1 120px', minWidth: 100, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.text, padding: '6px 8px', fontSize: 12.5,
    },
    deviceIdInput: {
      flex: '1 1 140px', minWidth: 120, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.textMuted, padding: '6px 8px', fontSize: 12, fontFamily: 'monospace',
    },
    statusBtn: {
      padding: '7px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid transparent',
    },
    statusBtnClosed: { background: 'rgba(34,197,94,0.14)', color: '#16a34a', borderColor: 'rgba(34,197,94,0.35)' },
    statusBtnOpen: { background: 'rgba(244,63,94,0.14)', color: '#e11d48', borderColor: 'rgba(244,63,94,0.35)' },
    deleteBtn: {
      marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: `1px solid ${theme.borderSoft}`,
      background: 'transparent', color: theme.danger, cursor: 'pointer', fontSize: 13, lineHeight: 1,
    },
  };
}
