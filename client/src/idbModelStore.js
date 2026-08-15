// ===================================================================
// アップロードしたGLTF/GLBファイル(Blob)をブラウザに永続化するための
// 簡易IndexedDBラッパー。
//
// localStorageは文字列しか保存できず容量も小さい(数MB程度)ため、
// 数MB〜数十MBになりうるGLB/GLTFの保存には向かない。IndexedDBは
// バイナリ(Blob)をそのまま保存でき、容量上限も大幅に大きいのでこちらを使う。
// ===================================================================

const DB_NAME = 'system1-room-config';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MODEL_KEY = 'customRoomModel';

function isSupported() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('このブラウザはIndexedDBに対応していません。'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** アップロードされたファイル(File/Blob)を保存する */
export async function saveCustomModel(file) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ blob: file, name: file.name, savedAt: Date.now() }, MODEL_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** 保存済みのモデルを取得する。無ければnull。 */
export async function loadCustomModel() {
  if (!isSupported()) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(MODEL_KEY);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** 保存済みのモデルを削除する */
export async function clearCustomModel() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(MODEL_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
