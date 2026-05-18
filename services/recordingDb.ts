
const DB_NAME = 'plexdrum_recordings';
const STORE_NAME = 'videos';
export const MAX_LOCAL_RECORDINGS = 10;

export interface Recording {
  id: string;
  blob: Blob;
  createdAt: number;
  duration: number; // in seconds
  songTitle?: string;
}

export class RecordingQuotaError extends Error {
  constructor() {
    super(`Local recording limit reached. Delete a recording to save a new one.`);
    this.name = 'RecordingQuotaError';
  }
}

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e: any) => resolve(e.target.result);
    request.onerror = (e) => reject(e);
  });
};

export const saveRecording = async (recording: Recording) => {
  const existingRecordings = await getRecordings();
  const isReplacingExisting = existingRecordings.some(item => item.id === recording.id);
  if (!isReplacingExisting && existingRecordings.length >= MAX_LOCAL_RECORDINGS) {
    throw new RecordingQuotaError();
  }

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(recording);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject('Save failed');
  });

  return true;
};

export const getRecordings = async (): Promise<Recording[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('Load failed');
  });
};

export const deleteRecording = async (id: string) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject('Delete failed');
  });
};
