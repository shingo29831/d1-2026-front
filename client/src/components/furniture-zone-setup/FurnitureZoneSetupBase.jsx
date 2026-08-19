import React, { useMemo, useRef, useState } from 'react';
import RoomScene from '../room-scene/RoomScene';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { footprintBounds, footprintEdges } from '../../roomShapes';
import { isPositionBlocked } from '../../roomCollision';
import { useViewport } from '../../hooks/useViewport';
import InfoButton from '../common/InfoButton';

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;
const DRAG_THRESHOLD_PX = 3; // これ以上動いたら「クリック」ではなく「ドラッグ」とみなす

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// 家具を、壁・他の家具と重ならない位置にだけ置けるようにする際の「半径」。
// 家具は矩形だが、既存のisPositionBlocked()は点+半径での判定のため、家具自身の
// 矩形を包む円(中心から角までの距離)を半径として使う、やや安全側の近似判定にしている
// (回転によっては実際より少し手前で止まることがあるが、壁・他の家具にめり込む
// ことは確実に防げる)。
function furnitureRadius(item) {
  const halfW = (item?.width || 0.6) / 2;
  const halfD = (item?.depth || 0.5) / 2;
  return Math.hypot(halfW, halfD);
}

// 「家具の設定」「エリアの設定」の共通実装。
// 元々は1つのページ(家具・エリアの設定)で両方をまとめて編集していたが、
// 分かりやすさのため家具とエリアをそれぞれ別のページに分割した。
// このコンポーネントは`kind`('furniture' | 'zone')で「自分がどちらの
// ページか」を受け取り、間取り図上では自分の種類のみクリック・ドラッグで
// 編集でき、もう一方の種類は位置関係が分かるように薄く表示するだけ
// (クリック・ドラッグ不可)にする。
export default function FurnitureZoneSetupBase({ kind, title, lead, icon }) {
  const {
    footprint, furniture, zones, walls, roomShapeType,
    addFurniture, updateFurniture, removeFurniture,
    addZone, updateZone, removeZone,
    resetFurnitureAndZones,
  } = useRoomConfig();
  const { theme } = useTheme();
  const { isMobile } = useViewport();

  const items = kind === 'furniture' ? furniture : zones;
  const otherItems = kind === 'furniture' ? zones : furniture;

  const [selectedId, setSelectedId] = useState(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null); // { id, moved, startClientX, startClientY }
  const [dragPos, setDragPos] = useState(null); // { id, x, z } | null (ドラッグ中のプレビュー位置)

  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);

  // 「設定した家具や壁をすり抜けないようにしてほしい」という要望への対応。
  // 【重要・不具合修正】以前は間取り図上で家具をドラッグ/クリック配置するとき、
  // 部屋の外形の単純なバウンディングボックス(bounds.minX〜maxXなど)にしか
  // クランプしておらず、壁(外壁・間仕切り壁)や他の家具を無視してすり抜けて
  // 配置できてしまっていた(見守りダッシュボード側のダミー人物移動には既に
  // 同様の衝突判定があったが、この家具配置UI側には無かった)。
  // 家具(kind==='furniture')のときだけ、壁・他の家具との重なりを判定する
  // (エリアは物理的な物体ではなく「場所」を示すものなので、家具や壁の上に
  // 設定できて問題ない。従来通りバウンディングボックスのクランプのみ)。
  const exteriorWalls = useMemo(
    () => footprintEdges(footprint).map(([a, b]) => ({ x1: a.x, z1: a.z, x2: b.x, z2: b.z })),
    [footprint]
  );
  const collisionWalls = useMemo(
    () => (roomShapeType === 'custom' ? [...exteriorWalls, ...(Array.isArray(walls) ? walls : [])] : exteriorWalls),
    [exteriorWalls, walls, roomShapeType]
  );
  // 指定の位置(x,z)に、家具itemを置いたら壁または他の家具(自分自身は除く)に
  // 重なってしまうかどうかを判定する。家具の設定ページ以外(kind!=='furniture')では
  // 常にfalse(判定しない=従来通り自由に配置できる)。
  const isFurnitureBlocked = (x, z, item, excludeId) => {
    if (kind !== 'furniture') return false;
    const otherFurniture = furniture.filter((f) => f.id !== excludeId);
    return isPositionBlocked(
      { x, z },
      { walls: collisionWalls, furniture: otherFurniture, includeWalls: true, personRadius: furnitureRadius(item) }
    );
  };
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

  const addItem = (x, z) => (kind === 'furniture' ? addFurniture({ x, z }) : addZone({ x, z }));
  const updateItem = (id, patch) => (kind === 'furniture' ? updateFurniture(id, patch) : updateZone(id, patch));
  const removeItem = (id) => (kind === 'furniture' ? removeFurniture(id) : removeZone(id));

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
      // 選択中の家具をクリックした位置へ移動。壁・他の家具と重なる位置には
      // 移動しない(クリックしても何も起きない=元の位置のまま)。
      const selectedItem = items.find((it) => it.id === selectedId);
      if (isFurnitureBlocked(cx, cz, selectedItem, selectedId)) return;
      updateItem(selectedId, { x: cx, z: cz });
      return;
    }

    // 新規追加(家具は既定サイズの0.6×0.5で判定する)。壁・他の家具と重なる
    // 位置には追加しない。
    if (isFurnitureBlocked(cx, cz, {}, null)) return;
    const id = addItem(cx, cz);
    setSelectedId(id);
  };

  // --- ドラッグ移動(自分の種類のみ操作可能) ---
  // pointerdown時に対象要素へポインタキャプチャすることで、カーソルが要素の
  // 外に出てもmove/upイベントを受け続けられるようにしている。動いた距離が
  // ほぼ無ければ「クリック(選択)」、動いていれば「ドラッグ(移動)」として扱う。
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
    // 壁・他の家具と重なる位置へはドラッグのプレビューも進めない(直前の有効な
    // 位置のまま止まって見える=壁や家具の手前で引っかかるような操作感になる)。
    const item = items.find((it) => it.id === id);
    if (isFurnitureBlocked(x, z, item, id)) return;
    setDragPos({ id, x, z });
  };

  const handleItemPointerUp = (id) => (e) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    if (drag.moved) {
      const { x, z } = eventToRoom(e);
      const item = items.find((it) => it.id === id);
      // 壁・他の家具と重ならない位置のときだけ実際の位置を確定する
      // (重なる位置の場合は何もせず、ドラッグ開始前の位置に戻る)。
      if (!isFurnitureBlocked(x, z, item, id)) {
        updateItem(id, { x, z });
      }
    } else {
      selectItem(id);
    }
    dragRef.current = null;
    setDragPos(null);
  };

  const s = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);

  return (
    <div style={s.page}>
      {/* 【2026-08-19変更】以前はここに長い説明文(lead)を常時表示していたが、
          「タイトルの横にiボタンを追加して、押したら説明をモーダルで画面中央に
          表示するようにしてほしい」というご要望を受け、InfoButton(共通部品)
          経由の表示に変更した。 */}
      <h2 style={s.h2}>
        {title}
        <InfoButton title={title}>{lead}</InfoButton>
      </h2>

      {/* 「左に2D現状の配置、中央に3Dプレビュー、右に詳細設定」の3列レイアウト。
          左列=間取り図(2D。クリック/ドラッグでの追加・移動もここで行う)、
          中央列=3Dプレビュー、右列=一覧(各項目の詳細設定)。 */}
      <div style={s.grid}>
        <div style={s.col}>
        <section style={s.card}>
          <p style={s.desc}>
            {selectedId
              ? '項目を選択中です。間取り図をクリックすると、その項目をクリックした位置へ移動します。'
              : `間取り図をクリックすると、その位置に新しい${kind === 'furniture' ? '家具(箱)' : 'エリア'}を追加します。`}
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

            {/* もう一方の種類(家具⇔エリア)は、位置関係が分かるよう薄く表示するのみ。
                クリック・ドラッグでの編集はできない(そちらは専用ページで行う)。 */}
            {kind === 'furniture'
              ? zones.map((zone) => {
                const tl = roomToSvg(zone.x - zone.width / 2, zone.z - zone.depth / 2);
                const br = roomToSvg(zone.x + zone.width / 2, zone.z + zone.depth / 2);
                return (
                  <g key={`ctx-zone-${zone.id}`} style={{ pointerEvents: 'none' }} opacity={0.35}>
                    <rect
                      x={tl.sx} y={tl.sy} width={Math.max(2, br.sx - tl.sx)} height={Math.max(2, br.sy - tl.sy)}
                      fill={zone.type === 'danger' ? 'rgba(244,63,94,0.30)' : 'rgba(245,158,11,0.26)'}
                      stroke={zone.type === 'danger' ? '#f43f5e' : '#f59e0b'} strokeWidth={1} strokeDasharray="4 3"
                    />
                    <text
                      x={(tl.sx + br.sx) / 2} y={(tl.sy + br.sy) / 2 + 4} fontSize={10.5} textAnchor="middle"
                      fill={theme.mode === 'dark' ? '#fff' : '#3a2a06'}
                    >
                      {zone.type === 'danger' ? '⚠ ' : '△ '}{zone.label}
                    </text>
                  </g>
                );
              })
              : furniture.map((f) => {
                const tl = roomToSvg(f.x - f.width / 2, f.z - f.depth / 2);
                const br = roomToSvg(f.x + f.width / 2, f.z + f.depth / 2);
                const center = roomToSvg(f.x, f.z);
                return (
                  <g key={`ctx-furniture-${f.id}`} style={{ pointerEvents: 'none' }} opacity={0.35}
                    transform={`rotate(${f.rotationDeg || 0} ${center.sx} ${center.sy})`}>
                    <rect
                      x={tl.sx} y={tl.sy} width={Math.max(2, br.sx - tl.sx)} height={Math.max(2, br.sy - tl.sy)}
                      fill={f.color || '#8b6b47'} stroke={theme.borderSoft} strokeWidth={1} strokeDasharray="4 3" rx={3}
                    />
                    <text
                      x={(tl.sx + br.sx) / 2} y={(tl.sy + br.sy) / 2 + 4} fontSize={10.5} textAnchor="middle"
                      fill="#ffffff"
                    >
                      {f.label}
                    </text>
                  </g>
                );
              })}

            {/* 自分の種類の項目(クリック・ドラッグで編集可能) */}
            {items.map((item) => {
              const isDragging = dragPos && dragPos.id === item.id;
              const ix = isDragging ? dragPos.x : item.x;
              const iz = isDragging ? dragPos.z : item.z;
              const tl = roomToSvg(ix - item.width / 2, iz - item.depth / 2);
              const br = roomToSvg(ix + item.width / 2, iz + item.depth / 2);
              const center = roomToSvg(ix, iz);
              const isSel = selectedId === item.id;
              const isZone = kind === 'zone';
              return (
                <g
                  key={item.id}
                  onPointerDown={handleItemPointerDown(item.id)}
                  onPointerMove={handleItemPointerMove(item.id)}
                  onPointerUp={handleItemPointerUp(item.id)}
                  style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                  transform={!isZone ? `rotate(${item.rotationDeg || 0} ${center.sx} ${center.sy})` : undefined}
                >
                  <rect
                    x={tl.sx} y={tl.sy} width={Math.max(2, br.sx - tl.sx)} height={Math.max(2, br.sy - tl.sy)}
                    fill={isZone ? (item.type === 'danger' ? 'rgba(244,63,94,0.30)' : 'rgba(245,158,11,0.26)') : (item.color || '#8b6b47')}
                    fillOpacity={isZone ? 1 : 0.88}
                    stroke={isSel ? theme.accent : (isZone ? (item.type === 'danger' ? '#f43f5e' : '#f59e0b') : theme.borderSoft)}
                    strokeWidth={isSel || isDragging ? 3 : 1.5}
                    rx={isZone ? 0 : 3}
                  />
                  <text
                    x={(tl.sx + br.sx) / 2} y={(tl.sy + br.sy) / 2 + 4} fontSize={11.5} textAnchor="middle"
                    fill={isZone ? (theme.mode === 'dark' ? '#fff' : '#3a2a06') : '#ffffff'} style={{ pointerEvents: 'none' }}
                  >
                    {isZone ? (item.type === 'danger' ? '⚠ ' : '△ ') : ''}{item.label}
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
        </div>

        <div style={s.col}>
        <section style={s.card}>
          <h3 style={s.h3}>3Dプレビュー</h3>
          <p style={s.desc}>配置・編集した内容は保存操作なしですぐにここと見守りダッシュボードに反映されます。</p>
          <div style={s.previewWrap}>
            <RoomScene viewMode="overview" people={[]} solidWalls />
          </div>
        </section>
        </div>

        <div style={s.col}>
        <section style={s.card}>
          <h3 style={s.h3}>{icon} {title.replace('の設定', '')}一覧({items.length})</h3>
          {items.length === 0 && <p style={s.emptyNote}>まだありません。上の間取り図をクリックして追加してください。</p>}
          <div style={s.rowList}>
            {kind === 'furniture'
              ? items.map((f) => (
                <FurnitureRow
                  key={f.id}
                  item={f}
                  s={s}
                  selected={selectedId === f.id}
                  onSelect={() => selectItem(f.id)}
                  onChange={(patch) => updateFurniture(f.id, patch)}
                  onRemove={() => { removeFurniture(f.id); if (selectedId === f.id) setSelectedId(null); }}
                />
              ))
              : items.map((z) => (
                <ZoneRow
                  key={z.id}
                  item={z}
                  s={s}
                  selected={selectedId === z.id}
                  onSelect={() => selectItem(z.id)}
                  onChange={(patch) => updateZone(z.id, patch)}
                  onRemove={() => { removeZone(z.id); if (selectedId === z.id) setSelectedId(null); }}
                />
              ))}
          </div>
          <div style={s.btnRow}>
            <button style={s.ghostBtn} onClick={() => { resetFurnitureAndZones(); setSelectedId(null); }}>初期設定(既定の家具・エリア)に戻す</button>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

function normalizeDeg(v) {
  return ((v % 360) + 360) % 360;
}

function FurnitureRow({ item, s, selected, onSelect, onChange, onRemove }) {
  const rotationDeg = item.rotationDeg || 0;
  return (
    <div style={{ ...s.row, ...(selected ? s.rowSelected : {}) }} onClick={onSelect}>
      <input
        type="text" value={item.label} onChange={(e) => onChange({ label: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.labelInput}
      />
      <NumField s={s} label="幅" value={item.width} onChange={(v) => onChange({ width: v })} />
      <NumField s={s} label="奥行" value={item.depth} onChange={(v) => onChange({ depth: v })} />
      <NumField s={s} label="高さ" value={item.height} onChange={(v) => onChange({ height: v })} />
      <div style={s.rotateGroup}>
        <button
          style={s.rotateBtn}
          onClick={(e) => { e.stopPropagation(); onChange({ rotationDeg: normalizeDeg(rotationDeg - 15) }); }}
          title="15°左回転"
        >
          ↺
        </button>
        <span style={s.rotateValue}>{Math.round(rotationDeg)}°</span>
        <button
          style={s.rotateBtn}
          onClick={(e) => { e.stopPropagation(); onChange({ rotationDeg: normalizeDeg(rotationDeg + 15) }); }}
          title="15°右回転"
        >
          ↻
        </button>
      </div>
      <input
        type="color" value={item.color || '#8b6b47'} onChange={(e) => onChange({ color: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.colorInput} title="色"
      />
      <button style={s.deleteBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }} title="削除">✕</button>
    </div>
  );
}

function ZoneRow({ item, s, selected, onSelect, onChange, onRemove }) {
  return (
    <div style={{ ...s.row, ...(selected ? s.rowSelected : {}) }} onClick={onSelect}>
      <input
        type="text" value={item.label} onChange={(e) => onChange({ label: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.labelInput}
      />
      <select
        value={item.type} onChange={(e) => onChange({ type: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.selectInput}
      >
        <option value="danger">危険(赤)</option>
        <option value="warning">注意(橙)</option>
      </select>
      <NumField s={s} label="幅" value={item.width} onChange={(v) => onChange({ width: v })} />
      <NumField s={s} label="奥行" value={item.depth} onChange={(v) => onChange({ depth: v })} />
      <button style={s.deleteBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }} title="削除">✕</button>
    </div>
  );
}

function NumField({ s, label, value, onChange }) {
  return (
    <label style={s.numField}>
      <span style={s.numFieldLabel}>{label}</span>
      <input
        type="number" min={0.1} max={5} step={0.05} value={value ?? 0}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
        style={s.numFieldInput}
      />
    </label>
  );
}

function makeStyles(theme, isMobile) {
  const svgBg = theme.mode === 'dark' ? '#0a0e16' : '#eef2f8';
  return {
    svgBg,
    page: { padding: isMobile ? '16px 14px 32px' : '24px 32px 48px', background: theme.pageBg, color: theme.text, minHeight: '100vh', fontFamily: 'sans-serif' },
    h2: { marginTop: 0, marginBottom: 6, color: theme.textStrong, fontSize: 22 },
    h3: { margin: '0 0 12px', fontSize: 15.5, color: theme.textStrong },
    lead: { color: theme.textMuted, maxWidth: 1100, lineHeight: 1.7, fontSize: 14.5, marginBottom: 24 },
    // 「左に2D現状の配置、中央に3Dプレビュー、右に詳細設定」の3列レイアウト。スマホ幅では1列に潰す。
    grid: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? 14 : 20, alignItems: 'start' },
    col: { display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20, minWidth: 0 },
    card: { background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: isMobile ? 14 : 20, minWidth: 0 },
    desc: { fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 14 },
    svg: { background: svgBg, borderRadius: 10, width: '100%', height: 'auto' },
    btnRow: { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' },
    ghostBtn: { padding: '10px 18px', fontSize: 13.5, background: 'transparent', color: theme.textMuted, border: `1px solid ${theme.borderSoft}`, borderRadius: 8, cursor: 'pointer' },
    previewWrap: { width: '100%', height: 460, background: theme.panelBgAlt, borderRadius: 10, overflow: 'hidden' },
    emptyNote: { fontSize: 13, color: theme.textFaint, lineHeight: 1.6 },
    // 右列(詳細設定=一覧)は項目数が増えると縦に伸びるため、左右の列(2D/3D)と
    // 高さの釣り合いが取れるよう、上限の高さを設けてスクロールにする。
    rowList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto', paddingRight: 4 },
    row: {
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`, background: theme.panelBgAlt, cursor: 'pointer', flexWrap: 'wrap',
    },
    rowSelected: { borderColor: theme.accentBorder, background: theme.accentSoft },
    labelInput: {
      flex: '1 1 110px', minWidth: 90, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.text, padding: '6px 8px', fontSize: 12.5,
    },
    selectInput: {
      background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6, color: theme.text,
      padding: '6px 6px', fontSize: 12,
    },
    colorInput: { width: 32, height: 30, border: `1px solid ${theme.borderSoft}`, borderRadius: 6, padding: 2, background: 'transparent', cursor: 'pointer' },
    deleteBtn: {
      marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: `1px solid ${theme.borderSoft}`,
      background: 'transparent', color: theme.danger, cursor: 'pointer', fontSize: 13, lineHeight: 1,
    },
    numField: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: theme.textFaint },
    numFieldLabel: { color: theme.textFaint },
    numFieldInput: {
      width: 54, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6, color: theme.text,
      padding: '5px 6px', fontSize: 12,
    },
    rotateGroup: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: theme.textFaint },
    rotateBtn: {
      width: 24, height: 24, borderRadius: 6, border: `1px solid ${theme.borderSoft}`, background: 'transparent',
      color: theme.text, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0,
    },
    rotateValue: { width: 34, textAlign: 'center', fontSize: 11.5, color: theme.textMuted },
  };
}
