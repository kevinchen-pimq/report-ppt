// Persistent song storage in the browser (IndexedDB), on the player's own device.
// Two stores: 'index' holds small metadata (title, cover, size, last played) for
// listing; 'blobs' holds each song's zip archive, read only when the song is opened.

const DB_NAME = 'webxr-saber-songs';
const VERSION = 2; // v2: + playlists
export const CACHE_LIMIT = 1024 * 1024 * 1024; // 1 GB

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('此瀏覽器不支援 IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('index')) db.createObjectStore('index', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(stores, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        Promise.resolve(fn(tx)).then((r) => (result = r));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('儲存失敗（空間可能不足）'));
      }),
  );
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

let persistAsked = false;
async function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (e) {
    /* best effort */
  }
}

export const songCache = {
  /** All saved songs' metadata, most recently played first. */
  async list() {
    try {
      const all = await run(['index'], 'readonly', (tx) => req2p(tx.objectStore('index').getAll()));
      return (all || []).sort((a, b) => (b.lastPlayed || b.addedAt) - (a.lastPlayed || a.addedAt));
    } catch (e) {
      console.warn('song cache unavailable', e);
      return [];
    }
  },

  /** Saves a song: meta = { key, title, artist, mapper, label, beatsaverId, cover, coverType }, zip = ArrayBuffer. */
  async put(meta, zip) {
    askPersist();
    const now = Date.now();
    const record = { ...meta, size: zip.byteLength, addedAt: meta.addedAt || now, lastPlayed: meta.lastPlayed || now };
    await run(['index', 'blobs'], 'readwrite', (tx) => {
      tx.objectStore('index').put(record);
      tx.objectStore('blobs').put(zip, meta.key);
    });
    return record;
  },

  async getZip(key) {
    return run(['blobs'], 'readonly', (tx) => req2p(tx.objectStore('blobs').get(key)));
  },

  async touch(key) {
    try {
      await run(['index'], 'readwrite', async (tx) => {
        const store = tx.objectStore('index');
        const rec = await req2p(store.get(key));
        if (rec) {
          rec.lastPlayed = Date.now();
          store.put(rec);
        }
      });
    } catch (e) {
      /* ignore */
    }
  },

  async remove(key) {
    await run(['index', 'blobs'], 'readwrite', (tx) => {
      tx.objectStore('index').delete(key);
      tx.objectStore('blobs').delete(key);
    });
  },

  async listPlaylists() {
    try {
      const all = await run(['playlists'], 'readonly', (tx) => req2p(tx.objectStore('playlists').getAll()));
      return (all || []).sort((a, b) => b.addedAt - a.addedAt);
    } catch (e) {
      return [];
    }
  },

  putPlaylist(pl) {
    askPersist();
    return run(['playlists'], 'readwrite', (tx) => tx.objectStore('playlists').put(pl));
  },

  removePlaylist(id) {
    return run(['playlists'], 'readwrite', (tx) => tx.objectStore('playlists').delete(id));
  },

  async clear() {
    await run(['index', 'blobs'], 'readwrite', (tx) => {
      tx.objectStore('index').clear();
      tx.objectStore('blobs').clear();
    });
  },
};
