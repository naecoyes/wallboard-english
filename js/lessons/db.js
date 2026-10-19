// Local-only lesson storage. v2 separates transcript chunks and cheap list summaries.
const DB = 'wallboard-lessons';
const STORES = ['lessons', 'audio', 'chunks', 'summaries', 'guards'];
let dbp = null;
const snapshots = new WeakMap();
const generation = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const stale = () => new DOMException('Lesson was deleted or this task was superseded', 'AbortError');

function summary(lesson) {
  const { chunks = [], notes, ...meta } = lesson;
  return { ...meta, chunkCount: chunks.length,
    completedChunks: chunks.filter(c => c.status === 'done').length,
    turnCount: chunks.reduce((n, c) => n + (c.turns ? c.turns.length : c.text ? 1 : 0), 0) };
}

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result, t = r.transaction;
      if (!db.objectStoreNames.contains('lessons')) db.createObjectStore('lessons', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      const chunks = db.createObjectStore('chunks', { keyPath: ['lessonId', 'index'] });
      chunks.createIndex('lessonId', 'lessonId');
      const summaries = db.createObjectStore('summaries', { keyPath: 'id' });
      const guards = db.createObjectStore('guards', { keyPath: 'id' });
      // Cursor migration stays in the upgrade transaction: failures roll back v1 intact.
      t.objectStore('lessons').openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const lesson = cursor.value;
        const token = generation();
        (lesson.chunks || []).forEach((chunk, index) => chunks.put({ lessonId: lesson.id, index, chunk }));
        summaries.put(summary(lesson));
        const { chunks: oldChunks = [], ...meta } = lesson;
        cursor.update({ ...meta, chunkCount: oldChunks.length, _generation: token });
        guards.put({ id: lesson.id, generation: token, deleted: false });
        cursor.continue();
      };
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
    r.onblocked = () => { /* Another open tab must close before migration can finish. */ };
  });
  return dbp;
}

async function transaction(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result, failure;
    const store = name => t.objectStore(name);
    const fail = error => { failure = error; t.abort(); };
    t.oncomplete = () => resolve(result);
    t.onerror = t.onabort = () => reject(failure || t.error || new Error('Storage transaction aborted'));
    try { fn(store, value => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

export const listLessons = () => transaction(['summaries'], 'readonly', (s, done) => {
  s('summaries').getAll().onsuccess = e => done(e.target.result.sort((a, b) => b.createdAt - a.createdAt));
});

export const getLesson = id => transaction(['lessons', 'chunks'], 'readonly', (s, done) => {
  const meta = s('lessons').get(id);
  const rows = s('chunks').index('lessonId').getAll(id);
  let lesson, chunks;
  const finish = () => {
    if (!lesson || !chunks) return;
    const { chunkCount, ...rest } = lesson;
    const result = { ...rest, chunks: chunks.sort((a, b) => a.index - b.index).map(row => row.chunk) };
    snapshots.set(result, { generation: result._generation, chunks: result.chunks.map(c => JSON.stringify(c)) });
    done(result);
  };
  meta.onsuccess = () => { lesson = meta.result; finish(); };
  rows.onsuccess = () => { chunks = rows.result; finish(); };
});

/** A task may claim a fresh generation before work; old task saves then fail. */
export const beginLessonGeneration = id => transaction(['guards', 'lessons'], 'readwrite', (s, done) => {
  s('guards').get(id).onsuccess = e => {
    const guard = e.target.result;
    if (!guard || guard.deleted) return;
    const token = generation();
    s('guards').put({ ...guard, generation: token });
    s('lessons').get(id).onsuccess = event => {
      if (event.target.result) s('lessons').put({ ...event.target.result, _generation: token });
    };
    done(token);
  };
});

function guarded(s, id, expected, fail, write) {
  s('guards').get(id).onsuccess = e => {
    const guard = e.target.result;
    if (guard?.deleted || (expected !== undefined && (!guard || guard.generation !== expected))) { fail(stale()); return; }
    const token = guard?.generation || generation();
    if (!guard) s('guards').put({ id, generation: token, deleted: false });
    try { write(token); } catch (error) { fail(error); }
  };
}

/** Existing assembled shape accepted; only changed chunk rows are cloned/written. */
export async function putLesson(lesson, { generation: expected = lesson._generation } = {}) {
  const fingerprints = (lesson.chunks || []).map(c => JSON.stringify(c));
  const previous = snapshots.get(lesson);
  let token;
  const result = await transaction(['lessons', 'chunks', 'summaries', 'guards'], 'readwrite', (s, done, fail) => {
    guarded(s, lesson.id, expected, fail, value => {
      token = value;
      const { chunks = [], ...meta } = lesson;
      s('lessons').put({ ...meta, _generation: token, chunkCount: chunks.length });
      s('summaries').put(summary(lesson));
      chunks.forEach((chunk, index) => {
        if (previous?.generation !== token || previous.chunks[index] !== fingerprints[index]) {
          s('chunks').put({ lessonId: lesson.id, index, chunk });
        }
      });
      // Delete trailing chunks after repartitioning or replacing an assembled lesson.
      const range = IDBKeyRange.bound([lesson.id, chunks.length], [lesson.id, Infinity]);
      s('chunks').delete(range);
      done(lesson.id);
    });
  });
  lesson._generation = token;
  snapshots.set(lesson, { generation: token, chunks: fingerprints });
  return result;
}

export const getAudio = id => transaction(['audio'], 'readonly', (s, done) => {
  s('audio').get(id).onsuccess = e => done(e.target.result);
});
export const putAudio = (id, blob, { generation: expected } = {}) => transaction(['audio', 'guards'], 'readwrite', (s, done, fail) => {
  guarded(s, id, expected, fail, () => { s('audio').put(blob, id); done(id); });
});

function removeChunks(store, id) {
  store.delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
}

export const deleteLesson = id => transaction(STORES, 'readwrite', s => {
  s('guards').put({ id, generation: generation(), deleted: true });
  s('lessons').delete(id);
  s('audio').delete(id);
  s('summaries').delete(id);
  removeChunks(s('chunks'), id);
});

export const deleteAllLessons = () => transaction(STORES, 'readwrite', s => {
  // Keep durable tombstones so late promises (including other tabs) cannot revive data.
  s('guards').openCursor().onsuccess = e => {
    const cursor = e.target.result;
    if (!cursor) return;
    cursor.update({ ...cursor.value, generation: generation(), deleted: true });
    cursor.continue();
  };
  for (const name of ['lessons', 'audio', 'chunks', 'summaries']) s(name).clear();
});
