import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  ROOM_SIZE as DEFAULT_ROOM_SIZE,
  ROOM_FOOTPRINT as DEFAULT_FOOTPRINT,
  CAMERA_MOUNT as DEFAULT_CAMERA_MOUNT,
  CAMERA_YAW_DEG as DEFAULT_YAW_DEG,
  CAMERA_PITCH_DEG as DEFAULT_PITCH_DEG,
  CAMERA_FOV_DEG as DEFAULT_FOV_DEG,
  CAMERA_HEIGHT_M,
  DEFAULT_FURNITURE,
  DEFAULT_ZONES,
  DEFAULT_WALLS,
  DEFAULT_DOOR_SENSORS,
} from './config';
import { footprintBounds } from './roomShapes';
import { saveCustomModel, loadCustomModel, clearCustomModel } from './idbModelStore';

// ===================================================================
// 「部屋の設定」「カメラ位置の設定」「家具・エリアの設定」タブで編集する内容
// (部屋の形・サイズ、カメラの設置位置・向き・視野角、家具の配置、危険/注意
// エリア、読み込んだ独自のGLTF/GLBモデル)をアプリ全体で共有するためのコンテキスト。
//
// ・部屋の形/カメラ設定/家具/エリア → localStorageに保存(小さなJSONなので十分)
// ・独自にアップロードしたGLTF/GLBファイル本体 → IndexedDBに保存
//   (localStorageは大きなバイナリの保存に向かないため)
//
// 部屋の形は「footprint」(部屋を真上から見た多角形の頂点配列)という
// 共通の形式で保持する。長方形/L字型/自由な多角形のどれを選んでも、
// 3D表示・カメラの壁吸着・検出座標のマッピングは同じfootprintを見るだけで
// よいので、部屋の形が増えても他のコードを変更せずに済む(roomShapes.js参照)。
//
// 家具(furniture)・危険/注意エリア(zones)は、どちらも
// { id, label, x, z, width, depth, height?, color?, type? } という
// 共通の「床の上の矩形」の形式で保持し、間取り図クリックで自由に追加・移動・
// サイズ変更できるようにしている(FurnitureSetupPage.jsx参照)。
//
// 見守りダッシュボード(RoomScene/PlaceholderRoom/CameraMount/DangerZoneMarkers)や
// 検出パイプライン(useMonitoringAlerts→poseGeometry)は、config.jsの
// 固定値ではなく、このコンテキスト経由で「現在の」部屋設定を参照する。
// ===================================================================

// 実際の自宅1階の間取り(自由な多角形)をデフォルトにしたため、保存形式のバージョンを
// 上げている(古いv3のデータが残っていても、新しい既定の間取りが使われるようにするため)。
const STORAGE_KEY = 'system1.roomConfig.v4';
const RoomConfigContext = createContext(null);

const DEFAULT_SHAPE = {
  type: 'custom',
  params: { width: DEFAULT_ROOM_SIZE.width, depth: DEFAULT_ROOM_SIZE.depth, cutW: 2.0, cutD: 1.8 },
  footprint: DEFAULT_FOOTPRINT,
};

let localIdSeq = 0;
function nextLocalId(prefix) {
  localIdSeq += 1;
  return `${prefix}_${Date.now()}_${localIdSeq}`;
}

function loadSavedJson() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function RoomConfigProvider({ children }) {
  const saved = useMemo(loadSavedJson, []);

  const [shape, setShapeState] = useState(saved?.shape || DEFAULT_SHAPE);
  const [height, setHeightState] = useState(saved?.height ?? DEFAULT_ROOM_SIZE.height);
  const [cameraMount, setCameraMountState] = useState(saved?.cameraMount || DEFAULT_CAMERA_MOUNT);
  const [cameraYawDeg, setCameraYawDegState] = useState(saved?.cameraYawDeg ?? DEFAULT_YAW_DEG);
  const [cameraPitchDeg, setCameraPitchDegState] = useState(saved?.cameraPitchDeg ?? DEFAULT_PITCH_DEG);
  const [cameraFovDeg, setCameraFovDegState] = useState(saved?.cameraFovDeg ?? DEFAULT_FOV_DEG);
  const [cameraMode, setCameraModeState] = useState(saved?.cameraMode || 'free');
  const [furniture, setFurnitureState] = useState(
    Array.isArray(saved?.furniture) ? saved.furniture : DEFAULT_FURNITURE,
  );
  const [zones, setZonesState] = useState(
    Array.isArray(saved?.zones) ? saved.zones : DEFAULT_ZONES,
  );
  const [doorSensors, setDoorSensorsState] = useState(
    Array.isArray(saved?.doorSensors) ? saved.doorSensors : DEFAULT_DOOR_SENSORS,
  );
  // 室内の間仕切り壁。以前は固定値でUIでの編集機能が無かったが、家具・エリア・
  // 開閉センサーと同じように「部屋の設定」タブから自由に追加・移動・削除できる
  // ようにしている(下のsetWallsList/addWall/updateWall/removeWall参照)。
  const [walls, setWallsState] = useState(
    Array.isArray(saved?.walls) ? saved.walls : DEFAULT_WALLS,
  );

  const [customModelUrl, setCustomModelUrl] = useState(null);
  const [customModelName, setCustomModelName] = useState(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState(null);

  // 起動時にIndexedDBから、以前アップロードした独自モデル(あれば)を復元する
  useEffect(() => {
    let cancelled = false;
    loadCustomModel()
      .then((rec) => {
        if (cancelled) return;
        if (rec && rec.blob) {
          const url = URL.createObjectURL(rec.blob);
          setCustomModelUrl(url);
          setCustomModelName(rec.name || null);
        }
      })
      .catch((err) => {
        if (!cancelled) setModelError(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((next) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても致命的ではないため無視(プライベートブラウズ等で容量制限にかかる場合がある)
    }
  }, []);

  const bounds = useMemo(() => footprintBounds(shape.footprint), [shape.footprint]);
  const roomSize = useMemo(() => ({ width: bounds.width, depth: bounds.depth, height }), [bounds, height]);

  // 部屋の形/サイズを変更したとき、既存の家具・エリア・カメラ位置は「絶対座標」で
  // 保持しているため、そのままだと新しい部屋の外形の外に取り残されてしまう
  // (以前の間取りに合わせた座標が「元のデータ」として残ってしまうバグ)。
  // 新しい外形の範囲内に収まるよう、はみ出した項目だけを座標クランプする。
  const clampToBounds = useCallback((item, nextBounds, margin = 0.15) => {
    const maxX = Math.max(nextBounds.minX + margin, nextBounds.maxX - margin);
    const maxZ = Math.max(nextBounds.minZ + margin, nextBounds.maxZ - margin);
    return {
      ...item,
      x: Math.min(maxX, Math.max(nextBounds.minX + margin, item.x)),
      z: Math.min(maxZ, Math.max(nextBounds.minZ + margin, item.z)),
    };
  }, []);

  // 壁は{x,z}が2組(始点・終点)あるため、clampToBoundsをそれぞれの端点に適用する。
  const clampWallToBounds = useCallback((wall, nextBounds, margin = 0.15) => {
    const p1 = clampToBounds({ x: wall.x1, z: wall.z1 }, nextBounds, margin);
    const p2 = clampToBounds({ x: wall.x2, z: wall.z2 }, nextBounds, margin);
    return { ...wall, x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z };
  }, [clampToBounds]);

  // persist()に渡す共通フィールドをまとめるヘルパー。カメラの上下角度(pitch)や
  // 開閉センサーなど新しく増えた項目も、他のsetXXX関数が個別に持つ最新値を
  // 明示的に渡さないと、無関係な項目を更新しただけでlocalStorageから消えて
  // しまう(=次回起動時に既定値へ巻き戻る)ため、必ずここを経由して保存する。
  const buildPersistPayload = useCallback((overrides) => ({
    shape, height, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraMode,
    furniture, zones, walls, doorSensors,
    ...overrides,
  }), [shape, height, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraMode, furniture, zones, walls, doorSensors]);

  const setRoomShape = useCallback((nextShape) => {
    const nextBounds = footprintBounds(nextShape.footprint);
    const nextFurniture = furniture.map((f) => clampToBounds(f, nextBounds));
    const nextZones = zones.map((z) => clampToBounds(z, nextBounds));
    const nextCameraMount = clampToBounds(cameraMount, nextBounds);
    const nextDoorSensors = doorSensors.map((d) => clampToBounds(d, nextBounds));
    const nextWalls = walls.map((w) => clampWallToBounds(w, nextBounds));
    setShapeState(nextShape);
    setFurnitureState(nextFurniture);
    setZonesState(nextZones);
    setCameraMountState(nextCameraMount);
    setDoorSensorsState(nextDoorSensors);
    setWallsState(nextWalls);
    persist(buildPersistPayload({
      shape: nextShape, cameraMount: nextCameraMount, furniture: nextFurniture, zones: nextZones, doorSensors: nextDoorSensors, walls: nextWalls,
    }));
  }, [furniture, zones, cameraMount, doorSensors, walls, persist, clampToBounds, clampWallToBounds, buildPersistPayload]);

  const setRoomHeight = useCallback((h) => {
    setHeightState(h);
    persist(buildPersistPayload({ height: h }));
  }, [persist, buildPersistPayload]);

  const setCameraPlacement = useCallback((mount, yawDeg, mode) => {
    setCameraMountState(mount);
    setCameraYawDegState(yawDeg);
    if (mode) setCameraModeState(mode);
    persist(buildPersistPayload({ cameraMount: mount, cameraYawDeg: yawDeg, cameraMode: mode || cameraMode }));
  }, [cameraMode, persist, buildPersistPayload]);

  const setCameraPitch = useCallback((deg) => {
    setCameraPitchDegState(deg);
    persist(buildPersistPayload({ cameraPitchDeg: deg }));
  }, [persist, buildPersistPayload]);

  const setCameraFov = useCallback((deg) => {
    setCameraFovDegState(deg);
    persist(buildPersistPayload({ cameraFovDeg: deg }));
  }, [persist, buildPersistPayload]);

  const setFurnitureList = useCallback((nextFurniture) => {
    setFurnitureState(nextFurniture);
    persist(buildPersistPayload({ furniture: nextFurniture }));
  }, [persist, buildPersistPayload]);

  const addFurniture = useCallback((item) => {
    const withId = { id: nextLocalId('f'), label: '家具', width: 0.6, depth: 0.5, height: 0.5, color: '#8b6b47', x: 0, z: 0, ...item };
    setFurnitureList([...furniture, withId]);
    return withId.id;
  }, [furniture, setFurnitureList]);

  const updateFurniture = useCallback((id, patch) => {
    setFurnitureList(furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, [furniture, setFurnitureList]);

  const removeFurniture = useCallback((id) => {
    setFurnitureList(furniture.filter((f) => f.id !== id));
  }, [furniture, setFurnitureList]);

  const setZonesList = useCallback((nextZones) => {
    setZonesState(nextZones);
    persist(buildPersistPayload({ zones: nextZones }));
  }, [persist, buildPersistPayload]);

  const addZone = useCallback((item) => {
    const withId = { id: nextLocalId('z'), label: '危険エリア', type: 'danger', width: 0.8, depth: 0.8, x: 0, z: 0, ...item };
    setZonesList([...zones, withId]);
    return withId.id;
  }, [zones, setZonesList]);

  const updateZone = useCallback((id, patch) => {
    setZonesList(zones.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  }, [zones, setZonesList]);

  const removeZone = useCallback((id) => {
    setZonesList(zones.filter((z) => z.id !== id));
  }, [zones, setZonesList]);

  const resetFurnitureAndZones = useCallback(() => {
    setFurnitureList(DEFAULT_FURNITURE);
    setZonesList(DEFAULT_ZONES);
  }, [setFurnitureList, setZonesList]);

  // --- 開閉センサー(玄関・勝手口などのドアに取り付けるセンサー)の管理 ---
  // 家具・エリアと同じ「間取り図上の1点」の考え方で位置を持つが、サイズは
  // 持たず(ドア1枚に対して1点のマーカー)、代わりに仕様書の共通JSONスキーマ
  // (sensor_alert.details.sensor_type:"door")に合わせて deviceId(実機の
  // device_idと突き合わせるための識別子)と status('closed'|'open')を持つ。
  const setDoorSensorsList = useCallback((nextDoorSensors) => {
    setDoorSensorsState(nextDoorSensors);
    persist(buildPersistPayload({ doorSensors: nextDoorSensors }));
  }, [persist, buildPersistPayload]);

  const addDoorSensor = useCallback((item) => {
    const withId = {
      id: nextLocalId('sensor'),
      label: '開閉センサー',
      deviceId: `door-sensor-${nextLocalId('id')}`,
      status: 'closed',
      x: 0,
      z: 0,
      ...item,
    };
    setDoorSensorsList([...doorSensors, withId]);
    return withId.id;
  }, [doorSensors, setDoorSensorsList]);

  const updateDoorSensor = useCallback((id, patch) => {
    setDoorSensorsList(doorSensors.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, [doorSensors, setDoorSensorsList]);

  const removeDoorSensor = useCallback((id) => {
    setDoorSensorsList(doorSensors.filter((d) => d.id !== id));
  }, [doorSensors, setDoorSensorsList]);

  const resetDoorSensors = useCallback(() => {
    setDoorSensorsList(DEFAULT_DOOR_SENSORS);
  }, [setDoorSensorsList]);

  // --- 室内の間仕切り壁の管理 ---
  // 「部屋の設定」タブの間取り図上で2点をクリックして始点・終点を指定することで
  // 追加する(家具・エリア・開閉センサーと違い「1点+サイズ」ではなく「2点(線分)」
  // で表す形のため、他とは少し異なるデータ形になっている)。
  const setWallsList = useCallback((nextWalls) => {
    setWallsState(nextWalls);
    persist(buildPersistPayload({ walls: nextWalls }));
  }, [persist, buildPersistPayload]);

  const addWall = useCallback((item) => {
    const withId = { id: nextLocalId('wall'), label: '壁', x1: 0, z1: 0, x2: 0, z2: 0, ...item };
    setWallsList([...walls, withId]);
    return withId.id;
  }, [walls, setWallsList]);

  const updateWall = useCallback((id, patch) => {
    setWallsList(walls.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, [walls, setWallsList]);

  const removeWall = useCallback((id) => {
    setWallsList(walls.filter((w) => w.id !== id));
  }, [walls, setWallsList]);

  const resetWalls = useCallback(() => {
    setWallsList(DEFAULT_WALLS);
  }, [setWallsList]);

  const uploadModel = useCallback(async (file) => {
    setModelError(null);
    try {
      await saveCustomModel(file);
      setCustomModelUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setCustomModelName(file.name);
    } catch (err) {
      setModelError(err.message || String(err));
      throw err;
    }
  }, []);

  const resetModel = useCallback(async () => {
    await clearCustomModel().catch(() => {});
    setCustomModelUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCustomModelName(null);
    setModelError(null);
  }, []);

  const resetRoomAndCamera = useCallback(() => {
    setShapeState(DEFAULT_SHAPE);
    setHeightState(DEFAULT_ROOM_SIZE.height);
    setCameraMountState(DEFAULT_CAMERA_MOUNT);
    setCameraYawDegState(DEFAULT_YAW_DEG);
    setCameraPitchDegState(DEFAULT_PITCH_DEG);
    setCameraFovDegState(DEFAULT_FOV_DEG);
    setCameraModeState('free');
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  const value = useMemo(() => ({
    roomShapeType: shape.type,
    roomShapeParams: shape.params,
    footprint: shape.footprint,
    roomSize,
    height,
    cameraMount,
    cameraYawDeg,
    cameraPitchDeg,
    cameraFovDeg,
    cameraMode,
    furniture,
    zones,
    walls,
    doorSensors,
    customModelUrl,
    customModelName,
    modelLoading,
    modelError,
    setRoomShape,
    setRoomHeight,
    setCameraPlacement,
    setCameraPitch,
    setCameraFov,
    addFurniture,
    updateFurniture,
    removeFurniture,
    addZone,
    updateZone,
    removeZone,
    resetFurnitureAndZones,
    addDoorSensor,
    updateDoorSensor,
    removeDoorSensor,
    resetDoorSensors,
    setWallsList,
    addWall,
    updateWall,
    removeWall,
    resetWalls,
    uploadModel,
    resetModel,
    resetRoomAndCamera,
    defaults: {
      shape: DEFAULT_SHAPE,
      roomSize: DEFAULT_ROOM_SIZE,
      cameraMount: DEFAULT_CAMERA_MOUNT,
      cameraYawDeg: DEFAULT_YAW_DEG,
      cameraPitchDeg: DEFAULT_PITCH_DEG,
      cameraFovDeg: DEFAULT_FOV_DEG,
      cameraHeight: CAMERA_HEIGHT_M,
      furniture: DEFAULT_FURNITURE,
      zones: DEFAULT_ZONES,
      walls: DEFAULT_WALLS,
      doorSensors: DEFAULT_DOOR_SENSORS,
    },
  }), [
    shape, roomSize, height, cameraMount, cameraYawDeg, cameraPitchDeg, cameraFovDeg, cameraMode, furniture, zones, walls, doorSensors,
    customModelUrl, customModelName, modelLoading, modelError,
    setRoomShape, setRoomHeight, setCameraPlacement, setCameraPitch, setCameraFov,
    addFurniture, updateFurniture, removeFurniture, addZone, updateZone, removeZone, resetFurnitureAndZones,
    addDoorSensor, updateDoorSensor, removeDoorSensor, resetDoorSensors,
    setWallsList, addWall, updateWall, removeWall, resetWalls,
    uploadModel, resetModel, resetRoomAndCamera,
  ]);

  return (
    <RoomConfigContext.Provider value={value}>
      {children}
    </RoomConfigContext.Provider>
  );
}

export function useRoomConfig() {
  const ctx = useContext(RoomConfigContext);
  if (!ctx) {
    throw new Error('useRoomConfig() はRoomConfigProviderの内側でのみ使用できます。');
  }
  return ctx;
}
