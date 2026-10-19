// db.js — 课堂录音只存本机 IndexedDB（不随 GitHub 同步：文件大、涉及隐私）
//   lessons: { id, title, createdAt, fileName, duration, status, error, model, chunks: [...], notes }
//   audio:   id → 原始录音 Blob
const DB = 'wallboard-lessons';
let dbp = null;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('lessons', { keyPath: 'id' });
      r.result.createObjectStore('audio');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const listLessons = async () => (await tx('lessons', 'readonly', s => s.getAll())).sort((a, b) => b.createdAt - a.createdAt);
export const getLesson = (id) => tx('lessons', 'readonly', s => s.get(id));
export const putLesson = (lesson) => tx('lessons', 'readwrite', s => s.put(lesson));
export const getAudio = (id) => tx('audio', 'readonly', s => s.get(id));
export const putAudio = (id, blob) => tx('audio', 'readwrite', s => s.put(blob, id));
export async function deleteLesson(id) {
  await tx('lessons', 'readwrite', s => s.delete(id));
  await tx('audio', 'readwrite', s => s.delete(id));
}
export async function deleteAllLessons() {
  await tx('lessons', 'readwrite', s => s.clear());
  await tx('audio', 'readwrite', s => s.clear());
}
