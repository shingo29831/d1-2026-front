import React, { useMemo, useRef, useState } from 'react';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { useOperationMode } from '../../operationModeContext';
import { useViewport } from '../../hooks/useViewport';
import { footprintBounds } from '../../roomShapes';
import {
  CATEGORIES,
  getEditableIncidents,
  addIncident,
  updateIncident,
  removeIncident,
  resetIncidents,
} from '../../incidentHistory';
import InfoButton from '../common/InfoButton';

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;
const DRAG_THRESHOLD_PX = 3;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function categoryColor(key) {
  const c = CATEGORIES.find((x) => x.key === key);
  return c ? c.color : '#94a3b8';
}
function categoryLabel(key) {
  const c = CATEGORIES.find((x) => x.key === key);
  return c ? c.label : key;
}

// <input type="datetime-local">は「ローカルタイムゾーンのYYYY-MM-DDTHH:mm」形式の
// 文字列を要求するため、保存しているISO 8601文字列との間で変換する。
function toDatetimeLocalValue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 「危険行為履歴データの編集」ページ(デモ用データモード専用)。
//
// 【ご要望への対応】「デモ環境ではすべてのデータの入力や変更ができるように
// してほしい。普段行かない場所へのアクセス、危険行為履歴...のデータがいる
// ものはすべてデータを修正したり変更できるように」という依頼を受けて新規作成。
// 家具・危険エリア・カメラの設定はすでに専用タブから編集できていたが、
// 「危険行為の履歴」(risk_suggestion=AIリスクサジェストを含む)だけは
// incidentHistory.js内の直書きサンプルデータで、画面から編集する手段が
// 無かったため、このページで追加・編集・削除できるようにした。
//
// 編集内容はこの端末のブラウザ(localStorage)に保存され、「危険行為の履歴」
// ページや見守りダッシュボードのヒートマップにそのまま反映される
// (incidentHistory.jsのgetIncidentsSortedDesc()参照)。履歴API接続時の
// 実データ(historyApi.js経由)には一切影響しない。
//
// 【重要・本番環境モードでは非表示/編集不可】本番環境モードでは、危険行為の
// 履歴はAWS(履歴API・IoT Core)からの実データのみを扱うべきであり、この
// ブラウザだけに保存された編集データを混在させるべきではないため、本番環境
// モードのときはこのページ自体を編集不可の案内表示に切り替える
// (ハンバーガーメニュー側でも、本番環境モードのときはこの項目自体を隠す)。
export default function IncidentDataEditorPage() {
  const { footprint, furniture, zones } = useRoomConfig();
  const { theme } = useTheme();
  const { isProduction } = useOperationMode();
  const { isMobile } = useViewport();

  const [incidents, setIncidents] = useState(() => getEditableIncidents());
  const refresh = () => setIncidents(getEditableIncidents());

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

  const eventToRoom = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (SVG_W / rect.width);
    const sy = (e.clientY - rect.top) * (SVG_H / rect.height);
    const { x, z } = svgToRoom(sx, sy);
    return { x: clamp(x, bounds.minX, bounds.maxX), z: clamp(z, bounds.minZ, bounds.maxZ) };
  };

  const selectItem = (id) => setSelectedId((prev) => (prev === id ? null : id));

  const handleBgClick = (e) => {
    const { x, z } = eventToRoom(e);
    if (selectedId) {
      updateIncident(selectedId, { x, z });
      refresh();
      return;
    }
    const created = addIncident({
      category: 'fall',
      severity: 'danger',
      label: categoryLabel('fall'),
      x,
      z,
      time: new Date().toISOString(),
    });
    refresh();
    setSelectedId(created.id);
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
      updateIncident(id, { x, z });
      refresh();
    } else {
      selectItem(id);
    }
    dragRef.current = null;
    setDragPos(null);
  };

  const s = useMemo(() => makeStyles(theme, isMobile), [theme, isMobile]);

  const sortedIncidents = useMemo(
    () => [...incidents].sort((a, b) => new Date(b.time) - new Date(a.time)),
    [incidents],
  );

  if (isProduction) {
    return (
      <div style={s.page}>
        <h2 style={s.h2}>
          危険行為履歴データの編集
          <InfoButton title="危険行為履歴データの編集について">
            このページはデモ用データモード専用です。本番環境モードでは、危険行為の履歴はAWS(履歴API・IoT Core)から取得した実データのみを扱うため、ここでの編集はできません。編集するには、ハンバーガーメニューから「デモ用データ」モードに切り替えてください。
          </InfoButton>
        </h2>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* 【2026-08-19変更】以前はここに長い説明文を常時表示していたが、
          「タイトルの横にiボタンを追加して、押したら説明をモーダルで画面中央に
          表示するようにしてほしい」というご要望を受け、InfoButton(共通部品)
          経由の表示に変更した。 */}
      <h2 style={s.h2}>
        危険行為履歴データの編集
        <InfoButton title="危険行為履歴データの編集について">
          デモ用データモードで表示する「危険行為の履歴」ページのサンプルデータ(AIリスクサジェスト「普段行かない場所へのアクセス」を含む)を、自由に追加・編集・削除できます。ここでの変更はこの端末のブラウザに保存され、「危険行為の履歴」ページや見守りダッシュボードのヒートマップにそのまま反映されます(履歴API接続時の実データには影響しません)。間取り図の何もない場所をクリックすると、新しい項目(既定は転倒検知)を追加します。一覧または間取り図上の項目を選択してから間取り図をクリックすると、その項目をクリックした位置へ移動できます。
        </InfoButton>
      </h2>

      <div style={s.grid}>
        <div style={s.col}>
          <section style={s.card}>
            <p style={s.desc}>
              {selectedId
                ? '項目を選択中です。間取り図をクリックすると、その項目をクリックした位置へ移動します。'
                : '間取り図をクリックすると、その位置に新しい項目を追加します。'}
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

              {/* 家具・エリアは位置関係が分かるよう薄く表示するのみ(このページでは編集不可)。 */}
              {(Array.isArray(zones) ? zones : []).map((zone) => {
                const tl = roomToSvg(zone.x - zone.width / 2, zone.z - zone.depth / 2);
                const br = roomToSvg(zone.x + zone.width / 2, zone.z + zone.depth / 2);
                return (
                  <rect
                    key={`ctx-zone-${zone.id}`}
                    x={tl.sx} y={tl.sy} width={Math.max(2, br.sx - tl.sx)} height={Math.max(2, br.sy - tl.sy)}
                    fill={zone.type === 'danger' ? 'rgba(244,63,94,0.18)' : 'rgba(245,158,11,0.16)'}
                    stroke={zone.type === 'danger' ? '#f43f5e' : '#f59e0b'} strokeWidth={1} strokeDasharray="4 3"
                    style={{ pointerEvents: 'none' }} opacity={0.5}
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
                    style={{ pointerEvents: 'none' }} opacity={0.3}
                    transform={`rotate(${f.rotationDeg || 0} ${center.sx} ${center.sy})`}
                  />
                );
              })}

              {/* 危険行為履歴データ本体(クリック・ドラッグで編集可能) */}
              {sortedIncidents.map((inc) => {
                const isDragging = dragPos && dragPos.id === inc.id;
                const ix = isDragging ? dragPos.x : inc.x;
                const iz = isDragging ? dragPos.z : inc.z;
                const center = roomToSvg(ix, iz);
                const isSel = selectedId === inc.id;
                return (
                  <g
                    key={inc.id}
                    onPointerDown={handleItemPointerDown(inc.id)}
                    onPointerMove={handleItemPointerMove(inc.id)}
                    onPointerUp={handleItemPointerUp(inc.id)}
                    style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                  >
                    <circle
                      cx={center.sx} cy={center.sy} r={isSel ? 8 : 6}
                      fill={categoryColor(inc.category)}
                      stroke={isSel ? theme.accent : '#ffffff'}
                      strokeWidth={isSel || isDragging ? 3 : 1.2}
                    />
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
            <h3 style={s.h3}>📋 履歴データ一覧({sortedIncidents.length})</h3>
            {sortedIncidents.length === 0 && (
              <p style={s.emptyNote}>まだデータがありません。左の間取り図をクリックして追加してください。</p>
            )}
            <div style={s.rowList}>
              {sortedIncidents.map((inc) => (
                <IncidentRow
                  key={inc.id}
                  item={inc}
                  s={s}
                  selected={selectedId === inc.id}
                  onSelect={() => selectItem(inc.id)}
                  onChange={(patch) => { updateIncident(inc.id, patch); refresh(); }}
                  onRemove={() => { removeIncident(inc.id); if (selectedId === inc.id) setSelectedId(null); refresh(); }}
                />
              ))}
            </div>
            <div style={s.btnRow}>
              <button
                style={s.ghostBtn}
                onClick={() => { resetIncidents(); refresh(); setSelectedId(null); }}
              >
                初期のサンプルデータに戻す
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function IncidentRow({ item, s, selected, onSelect, onChange, onRemove }) {
  return (
    <div style={{ ...s.row, ...(selected ? s.rowSelected : {}) }} onClick={onSelect}>
      <span style={{ ...s.colorDot, background: categoryColor(item.category) }} />
      <select
        value={item.category}
        onChange={(e) => onChange({ category: e.target.value, label: item.label || categoryLabel(e.target.value) })}
        onClick={(e) => e.stopPropagation()}
        style={s.categorySelect}
        title="危険行為の種類(AIリスクサジェストを含む)"
      >
        {CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>{c.label}</option>
        ))}
      </select>
      <input
        type="text" value={item.label} onChange={(e) => onChange({ label: e.target.value })}
        onClick={(e) => e.stopPropagation()} style={s.labelInput} placeholder="ラベル(通知メッセージ相当)"
      />
      <select
        value={item.severity}
        onChange={(e) => onChange({ severity: e.target.value })}
        onClick={(e) => e.stopPropagation()}
        style={s.severitySelect}
      >
        <option value="danger">危険(赤)</option>
        <option value="warning">注意(橙)</option>
      </select>
      <input
        type="datetime-local"
        value={toDatetimeLocalValue(item.time)}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onChange({ time: new Date(v).toISOString() });
        }}
        onClick={(e) => e.stopPropagation()}
        style={s.timeInput}
      />
      <button style={s.deleteBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }} title="削除">✕</button>
    </div>
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
    grid: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 14 : 20, alignItems: 'start' },
    col: { display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 },
    card: { background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 20, minWidth: 0 },
    desc: { fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 14 },
    svg: { background: svgBg, borderRadius: 10, width: '100%', height: 'auto' },
    btnRow: { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' },
    ghostBtn: {
      padding: '10px 18px', fontSize: 13.5, background: 'transparent', color: theme.textMuted,
      border: `1px solid ${theme.borderSoft}`, borderRadius: 8, cursor: 'pointer',
    },
    emptyNote: { fontSize: 13, color: theme.textFaint, lineHeight: 1.6 },
    rowList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 560, overflowY: 'auto', paddingRight: 4 },
    row: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 8,
      border: `1px solid ${theme.borderSoft}`, background: theme.panelBgAlt, cursor: 'pointer', flexWrap: 'wrap',
    },
    rowSelected: { borderColor: theme.accentBorder, background: theme.accentSoft },
    colorDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
    categorySelect: {
      flex: '1 1 130px', minWidth: 110, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.text, padding: '6px 6px', fontSize: 12,
    },
    labelInput: {
      flex: '2 1 160px', minWidth: 140, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.text, padding: '6px 8px', fontSize: 12.5,
    },
    severitySelect: {
      flex: '1 1 90px', minWidth: 90, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.text, padding: '6px 6px', fontSize: 12,
    },
    timeInput: {
      flex: '1 1 160px', minWidth: 150, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6,
      color: theme.textMuted, padding: '6px 6px', fontSize: 11.5,
    },
    deleteBtn: {
      marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: `1px solid ${theme.borderSoft}`,
      background: 'transparent', color: theme.danger, cursor: 'pointer', fontSize: 13, lineHeight: 1,
    },
  };
}
