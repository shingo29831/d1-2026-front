import React, { useMemo, useState } from 'react';
import RoomScene from '../room-scene/RoomScene';
import { useRoomConfig } from '../../roomConfigContext';
import { useTheme } from '../../themeContext';
import { rectFootprint, lShapeFootprint, footprintBounds } from '../../roomShapes';
import { exportLivingRoomAsGlb } from '../../exportRoomGlb';

const SVG_W = 560;
const SVG_H = 420;
const PAD = 36;

const NUM_LIMITS = {
  width: { min: 1.5, max: 12, step: 0.1 },
  depth: { min: 1.5, max: 12, step: 0.1 },
  height: { min: 2.0, max: 4.0, step: 0.1 },
  cutW: { min: 0.3, max: 8, step: 0.1 },
  cutD: { min: 0.3, max: 8, step: 0.1 },
};

const SHAPE_LABELS = { rect: '長方形', lshape: 'L字型', custom: '自由な多角形' };

function clampNum(v, key) {
  const { min, max } = NUM_LIMITS[key];
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function defaultCustomStart() {
  return rectFootprint(3.6, 3.0);
}

// 「部屋の設定」タブ。
// 【Role C仕様書 Step 2「React + Three.jsによる3D空間の構築」との対応】
// ②のGLTF/GLBアップロードが、仕様書の「Polycamでスキャンした部屋の3Dモデルを
// `useGLTF`で読み込みシーンに配置する」に相当する。ただしBlenderでのポリゴン数
// 削減(Decimate)・Draco圧縮は事前加工の前提であり、このアプリ側では行っていない
// (アップロードするファイル自体を軽量化してから読み込む想定。詳細はROLE_C_SPEC_ALIGNMENT.md参照)。
// ①長方形/L字型/自由な多角形のいずれかで部屋の形を作成するか、
// ②お手持ちのGLTF/GLBファイルを読み込むか、のどちらかで
// 見守りダッシュボードに表示する部屋の形を設定できるようにするページ。
export default function RoomSetupPage() {
  const {
    roomShapeType, roomShapeParams, footprint: savedFootprint, height: savedHeight,
    walls, furniture, zones,
    customModelUrl, customModelName, modelLoading, modelError,
    setRoomShape, setRoomHeight, uploadModel, resetModel, resetRoomAndCamera, defaults,
    addWall, updateWall, removeWall, resetWalls,
  } = useRoomConfig();
  const { theme } = useTheme();

  const [shapeType, setShapeType] = useState(roomShapeType);
  const [params, setParams] = useState(roomShapeParams);
  const [customPoints, setCustomPoints] = useState(
    roomShapeType === 'custom' && Array.isArray(savedFootprint) && savedFootprint.length >= 3
      ? savedFootprint
      : defaultCustomStart(),
  );
  const [height, setHeightDraft] = useState(savedHeight);
  const [saved, setSaved] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState(null);
  const [exportDone, setExportDone] = useState(false);

  // 「自由な多角形」用の下絵(トレース用の間取り図画像)。実際の部屋の形には保存されない、
  // あくまで頂点をクリックする際の目安として画像をSVGの背景に薄く表示するための機能。
  const [bgImageUrl, setBgImageUrl] = useState(null);
  const [bgImageName, setBgImageName] = useState(null);
  const [bgImageAspect, setBgImageAspect] = useState(1); // height / width
  const [bgImageWidthM, setBgImageWidthM] = useState(4);
  const [bgImageOpacity, setBgImageOpacity] = useState(0.55);

  // 「④ 室内の壁を配置する」用。壁は「1点+サイズ」ではなく「始点・終点の2点(線分)」
  // で表すため、間取り図を2回クリックする(1回目=始点、2回目=終点)操作にしている。
  // wallDraftStartが null のときは次のクリックを「始点」として扱い、
  // 値がある間は次のクリックを「終点」として扱ってその場で壁を1本追加する。
  // 家具・エリア・開閉センサーと違い、この壁の変更はドラフト(保存前プレビュー)を
  // 経由せず、追加・削除のたびに即座にコンテキストへ反映される。
  const [wallDraftStart, setWallDraftStart] = useState(null);

  const draftFootprint = useMemo(() => {
    if (shapeType === 'rect') {
      return rectFootprint(clampNum(Number(params.width), 'width'), clampNum(Number(params.depth), 'depth'));
    }
    if (shapeType === 'lshape') {
      return lShapeFootprint(
        clampNum(Number(params.width), 'width'),
        clampNum(Number(params.depth), 'depth'),
        clampNum(Number(params.cutW), 'cutW'),
        clampNum(Number(params.cutD), 'cutD'),
      );
    }
    return customPoints;
  }, [shapeType, params, customPoints]);

  const previewFootprint = draftFootprint.length >= 3 ? draftFootprint : rectFootprint(3, 3);
  const bounds = useMemo(() => footprintBounds(previewFootprint), [previewFootprint]);

  const scale = useMemo(() => {
    const spanX = bounds.width + 1.2;
    const spanZ = bounds.depth + 1.2;
    return Math.min((SVG_W - PAD * 2) / spanX, (SVG_H - PAD * 2) / spanZ);
  }, [bounds]);
  const originX = SVG_W / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const originY = SVG_H / 2 - ((bounds.minZ + bounds.maxZ) / 2) * scale;
  const roomToSvg = (x, z) => ({ sx: originX + x * scale, sy: originY + z * scale });
  const svgToRoom = (sx, sy) => ({ x: (sx - originX) / scale, z: (sy - originY) / scale });

  const polygonPoints = previewFootprint.map((p) => {
    const { sx, sy } = roomToSvg(p.x, p.z);
    return `${sx},${sy}`;
  }).join(' ');

  const handleSvgClick = (e) => {
    if (shapeType !== 'custom') return;
    setSaved(false);
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (SVG_W / rect.width);
    const sy = (e.clientY - rect.top) * (SVG_H / rect.height);
    const { x, z } = svgToRoom(sx, sy);
    setCustomPoints((prev) => [...prev, { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20 }]);
  };

  const removePoint = (idx) => {
    setSaved(false);
    setCustomPoints((prev) => prev.filter((_, i) => i !== idx));
  };

  const undoPoint = () => {
    setSaved(false);
    setCustomPoints((prev) => prev.slice(0, -1));
  };

  const restartPoints = () => {
    setSaved(false);
    setCustomPoints(defaultCustomStart());
  };

  const handleShapeTypeChange = (type) => {
    setSaved(false);
    setShapeType(type);
    if (type === 'custom' && customPoints.length < 3) setCustomPoints(defaultCustomStart());
  };

  const handleParamChange = (key, value) => {
    setSaved(false);
    setParams((prev) => ({ ...prev, [key]: value === '' ? '' : Number(value) }));
  };

  const canSave = shapeType !== 'custom' || customPoints.length >= 3;

  const handleSave = () => {
    if (!canSave) return;
    setRoomShape({ type: shapeType, params, footprint: draftFootprint });
    setRoomHeight(clampNum(Number(height), 'height'));
    setSaved(true);
  };

  const handleReset = () => {
    setShapeType(defaults.shape.type);
    setParams(defaults.shape.params);
    setCustomPoints(defaultCustomStart());
    setHeightDraft(defaults.roomSize.height);
    resetRoomAndCamera();
    setSaved(false);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadBusy(true);
    setUploadErr(null);
    try {
      await uploadModel(file);
    } catch (err) {
      setUploadErr(err.message || String(err));
    } finally {
      setUploadBusy(false);
      e.target.value = '';
    }
  };

  const handleExportGlb = async () => {
    setExportBusy(true);
    setExportErr(null);
    setExportDone(false);
    try {
      // 現在保存されている(=見守りダッシュボードに反映されている)部屋の内容を書き出す
      await exportLivingRoomAsGlb({ footprint: savedFootprint, height: savedHeight, walls, furniture, zones });
      setExportDone(true);
    } catch (err) {
      setExportErr(err.message || String(err));
    } finally {
      setExportBusy(false);
    }
  };

  const handleBgImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
    const url = URL.createObjectURL(file);
    setBgImageName(file.name);
    setBgImageUrl(url);
    e.target.value = '';
    // SVGの<image>要素にはHTML<img>のnaturalWidth/naturalHeightが無いため、
    // 別途オフスクリーンのImageで実寸比率(縦/横)を読み取ってから反映する
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth > 0) setBgImageAspect(probe.naturalHeight / probe.naturalWidth);
    };
    probe.src = url;
  };

  const clearBgImage = () => {
    if (bgImageUrl) URL.revokeObjectURL(bgImageUrl);
    setBgImageUrl(null);
    setBgImageName(null);
  };

  const bgImageWidthSvg = bgImageWidthM * scale;
  const bgImageHeightSvg = bgImageWidthSvg * bgImageAspect;

  // 「④ 室内の壁を配置する」の間取り図は、①のドラフト(保存前の編集中の形)ではなく
  // 現在保存されている外形(savedFootprint)を背景に使う(壁の追加・削除は保存操作
  // なしに即座に反映されるため、①のドラフトと混在させると分かりにくくなるため)。
  const wallBounds = useMemo(() => footprintBounds(savedFootprint), [savedFootprint]);
  const wallScale = useMemo(() => {
    const spanX = wallBounds.width + 1.2;
    const spanZ = wallBounds.depth + 1.2;
    return Math.min((SVG_W - PAD * 2) / spanX, (SVG_H - PAD * 2) / spanZ);
  }, [wallBounds]);
  const wallOriginX = SVG_W / 2 - ((wallBounds.minX + wallBounds.maxX) / 2) * wallScale;
  const wallOriginY = SVG_H / 2 - ((wallBounds.minZ + wallBounds.maxZ) / 2) * wallScale;
  const wallRoomToSvg = (x, z) => ({ sx: wallOriginX + x * wallScale, sy: wallOriginY + z * wallScale });
  const wallSvgToRoom = (sx, sy) => ({ x: (sx - wallOriginX) / wallScale, z: (sy - wallOriginY) / wallScale });
  const wallPolygonPoints = savedFootprint.map((p) => {
    const { sx, sy } = wallRoomToSvg(p.x, p.z);
    return `${sx},${sy}`;
  }).join(' ');

  const handleWallSvgClick = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (SVG_W / rect.width);
    const sy = (e.clientY - rect.top) * (SVG_H / rect.height);
    const { x, z } = wallSvgToRoom(sx, sy);
    const snapped = { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20 };
    if (!wallDraftStart) {
      setWallDraftStart(snapped);
    } else {
      addWall({ x1: wallDraftStart.x, z1: wallDraftStart.z, x2: snapped.x, z2: snapped.z });
      setWallDraftStart(null);
    }
  };

  const cancelWallDraft = () => setWallDraftStart(null);

  const handleWallFieldChange = (id, key, value) => {
    const num = Number(value);
    updateWall(id, { [key]: Number.isNaN(num) ? 0 : num });
  };

  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <div style={s.page}>
      <h2 style={s.h2}>部屋の設定</h2>
      <p style={s.lead}>
        見守りダッシュボードに表示する部屋の形を設定します。長方形・L字型・自由な多角形から選べるほか、
        ②お手持ちのPolycamなどでスキャンしたGLTF/GLBファイルを読み込むこともできます。
        変更はこの端末のブラウザに保存され、見守りダッシュボードにすぐ反映されます。
      </p>

      <div style={s.grid}>
          <section style={s.card}>
            <h3 style={s.h3}>① 部屋の形を作成する</h3>

            <div style={s.shapeTabs}>
              {Object.keys(SHAPE_LABELS).map((key) => (
                <button
                  key={key}
                  onClick={() => handleShapeTypeChange(key)}
                  style={{ ...s.shapeTab, ...(shapeType === key ? s.shapeTabActive : {}) }}
                >
                  {SHAPE_LABELS[key]}
                </button>
              ))}
            </div>

            {(shapeType === 'rect' || shapeType === 'lshape') && (
              <>
                <label style={s.fieldRow}>
                  <span style={s.fieldLabel}>幅(左右)</span>
                  <input
                    type="number" value={params.width} min={NUM_LIMITS.width.min} max={NUM_LIMITS.width.max} step={NUM_LIMITS.width.step}
                    onChange={(e) => handleParamChange('width', e.target.value)} style={s.numInput}
                  />
                  <span style={s.unit}>m</span>
                </label>
                <label style={s.fieldRow}>
                  <span style={s.fieldLabel}>奥行き</span>
                  <input
                    type="number" value={params.depth} min={NUM_LIMITS.depth.min} max={NUM_LIMITS.depth.max} step={NUM_LIMITS.depth.step}
                    onChange={(e) => handleParamChange('depth', e.target.value)} style={s.numInput}
                  />
                  <span style={s.unit}>m</span>
                </label>
              </>
            )}

            {shapeType === 'lshape' && (
              <>
                <label style={s.fieldRow}>
                  <span style={s.fieldLabel}>欠き取り幅</span>
                  <input
                    type="number" value={params.cutW} min={NUM_LIMITS.cutW.min} max={NUM_LIMITS.cutW.max} step={NUM_LIMITS.cutW.step}
                    onChange={(e) => handleParamChange('cutW', e.target.value)} style={s.numInput}
                  />
                  <span style={s.unit}>m</span>
                </label>
                <label style={s.fieldRow}>
                  <span style={s.fieldLabel}>欠き取り奥行き</span>
                  <input
                    type="number" value={params.cutD} min={NUM_LIMITS.cutD.min} max={NUM_LIMITS.cutD.max} step={NUM_LIMITS.cutD.step}
                    onChange={(e) => handleParamChange('cutD', e.target.value)} style={s.numInput}
                  />
                  <span style={s.unit}>m</span>
                </label>
                <p style={s.hint}>長方形の右奥の角を欠き取ってL字型にします。</p>
              </>
            )}

            {shapeType === 'custom' && (
              <>
                <p style={s.hint}>右の間取り図をクリックして頂点を追加してください(3点以上で保存できます)。頂点(丸印)をクリックすると削除できます。</p>
                <div style={s.btnRow}>
                  <button style={s.ghostBtn} onClick={undoPoint}>ひとつ戻す</button>
                  <button style={s.ghostBtn} onClick={restartPoints}>やり直す</button>
                </div>
                {!canSave && (
                  <div style={s.warnNote}>あと{Math.max(0, 3 - customPoints.length)}点、頂点を追加してください。</div>
                )}

                <div style={s.traceBox}>
                  <p style={s.hint}>
                    お手持ちの間取り図の画像(JPG/PNG)を下絵として薄く表示し、その上をなぞって頂点をクリックできます。
                    画像は保存されず、あくまで形を作る際の目安として使われます。
                  </p>
                  <input type="file" accept="image/*" onChange={handleBgImageChange} style={s.fileInput} />
                  {bgImageUrl && (
                    <>
                      <label style={s.fieldRow}>
                        <span style={s.fieldLabel}>画像の幅</span>
                        <input
                          type="number" value={bgImageWidthM} min={0.5} max={20} step={0.1}
                          onChange={(e) => setBgImageWidthM(e.target.value === '' ? '' : Number(e.target.value))}
                          style={s.numInput}
                        />
                        <span style={s.unit}>m</span>
                      </label>
                      <label style={s.fieldRow}>
                        <span style={s.fieldLabel}>透明度</span>
                        <input
                          type="range" min={0.1} max={1} step={0.05} value={bgImageOpacity}
                          onChange={(e) => setBgImageOpacity(Number(e.target.value))} style={{ flex: 1 }}
                        />
                      </label>
                      <div style={s.statusLine}>
                        {bgImageName}
                        <button style={s.linkBtn} onClick={clearBgImage}>下絵を削除</button>
                      </div>
                      <p style={s.hint}>「画像の幅」は画像の実寸(横幅)をメートルで入力すると、間取り図とスケールを合わせやすくなります。</p>
                    </>
                  )}
                </div>
              </>
            )}

            <label style={s.fieldRow}>
              <span style={s.fieldLabel}>天井高</span>
              <input
                type="number" value={height} min={NUM_LIMITS.height.min} max={NUM_LIMITS.height.max} step={NUM_LIMITS.height.step}
                onChange={(e) => { setSaved(false); setHeightDraft(e.target.value === '' ? '' : Number(e.target.value)); }}
                style={s.numInput}
              />
              <span style={s.unit}>m</span>
            </label>

            <div style={s.btnRow}>
              <button style={{ ...s.primaryBtn, ...(canSave ? {} : s.btnDisabled) }} onClick={handleSave} disabled={!canSave}>この内容で保存</button>
              <button style={s.ghostBtn} onClick={handleReset}>初期設定に戻す</button>
            </div>
            {saved && <div style={s.savedNote}>保存しました。見守りダッシュボードに反映されています。</div>}
          </section>

          <section style={s.card}>
            <h3 style={s.h3}>② GLTF/GLBファイルを読み込む</h3>
            <p style={s.desc}>
              Polycamなどでスキャンした部屋データ(.glb / .gltf)を読み込むと、①の形状設定の代わりに
              その3Dモデルが見守りダッシュボードに表示されます(表示サイズは①の数値に自動フィットします)。
              このファイルはこの端末のブラウザ内に保存されます。
            </p>
            <input type="file" accept=".glb,.gltf" onChange={handleFileChange} disabled={uploadBusy} style={s.fileInput} />
            {uploadBusy && <div style={s.statusLine}>読み込み中...</div>}
            {uploadErr && <div style={s.errorLine}>⚠ {uploadErr}</div>}
            {!modelLoading && customModelUrl && (
              <div style={s.statusLine}>
                現在のモデル: {customModelName || '(名称不明)'}
                <button style={s.linkBtn} onClick={() => resetModel()}>削除して既定の部屋に戻す</button>
              </div>
            )}
            {!modelLoading && !customModelUrl && (
              <div style={s.statusLineMuted}>現在は①で作成した部屋モデルを使用しています。</div>
            )}
            {modelError && <div style={s.errorLine}>⚠ {modelError}</div>}
          </section>

          <section style={s.card}>
            <h3 style={s.h3}>③ リビングを3Dデータとして書き出す</h3>
            <p style={s.desc}>
              現在保存されている部屋(床・壁・家具・危険/注意エリア)を、リビングの3Dデータとして
              GLB形式(.glb)でこの端末にダウンロードします。Blenderなど他の3Dソフトで開いて
              確認・編集できます。
            </p>
            <div style={s.btnRow}>
              <button style={s.ghostBtn} onClick={handleExportGlb} disabled={exportBusy}>
                {exportBusy ? '書き出し中...' : 'リビングを3Dデータ(GLB)として書き出す'}
              </button>
            </div>
            {exportDone && <div style={s.savedNote}>ダウンロードしました(living_room.glb)。</div>}
            {exportErr && <div style={s.errorLine}>⚠ {exportErr}</div>}
          </section>

          <section style={s.card}>
            <h3 style={s.h3}>④ 室内の壁を配置する</h3>
            <p style={s.desc}>
              ①では部屋の外形(輪郭)だけを設定できますが、ここでは部屋の中の間仕切り壁を
              追加できます。下の間取り図を2回クリックすると、1回目の点(始点)から2回目の点
              (終点)まで壁が1本追加されます。変更は保存操作なしにすぐ見守りダッシュボードに
              反映されます。
            </p>
            {wallDraftStart && (
              <div style={s.statusLine}>
                壁の始点を指定しました。間取り図をもう一度クリックして終点を指定してください。
                <button style={s.linkBtn} onClick={cancelWallDraft}>取り消す</button>
              </div>
            )}
            <svg
              width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              style={{ ...s.svg, cursor: 'crosshair' }}
              onClick={handleWallSvgClick}
            >
              <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={s.svgBg} />
              <polygon points={wallPolygonPoints} fill={theme.mode === 'dark' ? '#161c28' : '#ffffff'} stroke={theme.borderSoft} strokeWidth={2} />
              {(Array.isArray(walls) ? walls : []).map((w) => {
                const a = wallRoomToSvg(w.x1, w.z1);
                const b = wallRoomToSvg(w.x2, w.z2);
                return (
                  <line
                    key={w.id}
                    x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy}
                    stroke={theme.accent} strokeWidth={5} strokeLinecap="round"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); removeWall(w.id); }}
                  >
                    <title>{w.label || '壁'}(クリックして削除)</title>
                  </line>
                );
              })}
              {wallDraftStart && (() => {
                const { sx, sy } = wallRoomToSvg(wallDraftStart.x, wallDraftStart.z);
                return <circle cx={sx} cy={sy} r={6} fill={theme.accent} stroke={theme.panelBg} strokeWidth={2} />;
              })()}
            </svg>
            <p style={s.hint}>壁(太い線)をクリックすると、その壁を削除します。</p>

            {walls.length > 0 && (
              <div style={s.wallList}>
                {walls.map((w) => (
                  <div key={w.id} style={s.wallRow}>
                    <input
                      type="text" value={w.label || ''} placeholder="壁"
                      onChange={(e) => updateWall(w.id, { label: e.target.value })}
                      style={s.wallLabelInput}
                    />
                    <input type="number" step={0.05} value={w.x1} onChange={(e) => handleWallFieldChange(w.id, 'x1', e.target.value)} style={s.numInputSmall} title="始点X" />
                    <input type="number" step={0.05} value={w.z1} onChange={(e) => handleWallFieldChange(w.id, 'z1', e.target.value)} style={s.numInputSmall} title="始点Z" />
                    <span style={s.wallArrow}>→</span>
                    <input type="number" step={0.05} value={w.x2} onChange={(e) => handleWallFieldChange(w.id, 'x2', e.target.value)} style={s.numInputSmall} title="終点X" />
                    <input type="number" step={0.05} value={w.z2} onChange={(e) => handleWallFieldChange(w.id, 'z2', e.target.value)} style={s.numInputSmall} title="終点Z" />
                    <button style={s.wallDeleteBtn} onClick={() => removeWall(w.id)}>削除</button>
                  </div>
                ))}
              </div>
            )}
            <div style={s.btnRow}>
              <button style={s.ghostBtn} onClick={resetWalls}>初期設定の間仕切り壁に戻す</button>
            </div>
          </section>

          <section style={s.card}>
            <h3 style={s.h3}>間取り図{shapeType === 'custom' ? '(クリックして頂点を追加)' : '(プレビュー)'}</h3>
            <svg
              width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              style={{ ...s.svg, cursor: shapeType === 'custom' ? 'crosshair' : 'default' }}
              onClick={handleSvgClick}
            >
              <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={s.svgBg} />
              {shapeType === 'custom' && bgImageUrl && (
                <image
                  href={bgImageUrl}
                  x={SVG_W / 2 - bgImageWidthSvg / 2}
                  y={SVG_H / 2 - bgImageHeightSvg / 2}
                  width={bgImageWidthSvg}
                  height={bgImageHeightSvg}
                  opacity={bgImageOpacity}
                  preserveAspectRatio="none"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {previewFootprint.length >= 3 && (
                <polygon points={polygonPoints} fill={theme.accentSoft} stroke={theme.accent} strokeWidth={2} fillOpacity={bgImageUrl ? 0.35 : 1} />
              )}
              {shapeType === 'custom' && customPoints.map((p, i) => {
                const { sx, sy } = roomToSvg(p.x, p.z);
                return (
                  <circle
                    key={i} cx={sx} cy={sy} r={6} fill={theme.panelBg} stroke={theme.accent} strokeWidth={2}
                    onClick={(e) => { e.stopPropagation(); removePoint(i); }} style={{ cursor: 'pointer' }}
                  />
                );
              })}
            </svg>
          </section>

          <section style={s.card}>
            <h3 style={s.h3}>3Dプレビュー</h3>
            <p style={s.desc}>①の内容を変更すると、保存前でもここに反映されます。</p>
            <div style={s.previewWrap}>
              <RoomScene
                viewMode="overview"
                people={[]}
                previewFootprint={previewFootprint}
                previewHeight={clampNum(Number(height) || 2.6, 'height')}
                previewShapeType={shapeType}
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
    h3: { margin: '0 0 8px', fontSize: 15.5, color: theme.textStrong },
    lead: { color: theme.textMuted, maxWidth: 1100, lineHeight: 1.7, fontSize: 14.5, marginBottom: 24 },
    // カード(①②③…)を3列のグリッドに並べる。カード数が3の倍数でない場合は
    // 最後の行が埋まりきらないが、それでよい(空欄が残るだけで崩れない)。
    grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'start' },
    card: { background: theme.panelBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 20, minWidth: 0 },
    desc: { fontSize: 13, color: theme.textMuted, lineHeight: 1.6, marginBottom: 14 },
    hint: { fontSize: 12.5, color: theme.textMuted, lineHeight: 1.6, margin: '6px 0 10px' },
    traceBox: { marginTop: 14, padding: 12, borderRadius: 10, background: theme.panelBgAlt, border: `1px dashed ${theme.borderSoft}` },
    shapeTabs: { display: 'flex', gap: 8, marginBottom: 16 },
    shapeTab: { flex: 1, fontSize: 13, padding: '10px 8px', borderRadius: 8, border: `1px solid ${theme.borderSoft}`, background: 'transparent', color: theme.textMuted, cursor: 'pointer' },
    shapeTabActive: { background: theme.accentSoft, color: theme.accent, borderColor: theme.accentBorder },
    fieldRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
    fieldLabel: { width: 100, fontSize: 13.5, color: theme.textMuted },
    numInput: { flex: 1, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6, color: theme.text, padding: '8px 10px', fontSize: 14 },
    unit: { fontSize: 13, color: theme.textFaint, width: 16 },
    btnRow: { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' },
    primaryBtn: { padding: '10px 18px', fontSize: 13.5, fontWeight: 700, background: theme.accent, color: theme.mode === 'dark' ? '#04222a' : '#ffffff', border: `1px solid ${theme.accentBorder}`, borderRadius: 8, cursor: 'pointer' },
    btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
    ghostBtn: { padding: '10px 18px', fontSize: 13.5, background: 'transparent', color: theme.textMuted, border: `1px solid ${theme.borderSoft}`, borderRadius: 8, cursor: 'pointer' },
    savedNote: { marginTop: 12, fontSize: 13, color: theme.accent },
    warnNote: { marginTop: 6, fontSize: 12.5, color: theme.warning },
    fileInput: { color: theme.textMuted, fontSize: 13, marginBottom: 10 },
    statusLine: { fontSize: 13, color: theme.accent, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    statusLineMuted: { fontSize: 13, color: theme.textFaint },
    errorLine: { fontSize: 13, color: theme.danger, marginTop: 6 },
    linkBtn: { fontSize: 12.5, color: theme.danger, background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 },
    svg: { background: svgBg, borderRadius: 10, width: '100%', height: 'auto' },
    previewWrap: { width: '100%', height: 460, background: theme.panelBgAlt, borderRadius: 10, overflow: 'hidden' },
    wallList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, maxHeight: 200, overflowY: 'auto', paddingRight: 4 },
    wallRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: theme.panelBgAlt, border: `1px solid ${theme.borderSoft}` },
    wallLabelInput: { width: 84, flexShrink: 0, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6, color: theme.text, padding: '6px 8px', fontSize: 12 },
    numInputSmall: { width: 56, background: theme.inputBg, border: `1px solid ${theme.borderSoft}`, borderRadius: 6, color: theme.text, padding: '6px 6px', fontSize: 12 },
    wallArrow: { color: theme.textFaint, fontSize: 12, flexShrink: 0 },
    wallDeleteBtn: { marginLeft: 'auto', flexShrink: 0, fontSize: 11.5, color: theme.danger, background: 'transparent', border: `1px solid ${theme.borderSoft}`, borderRadius: 6, padding: '5px 9px', cursor: 'pointer' },
  };
}
