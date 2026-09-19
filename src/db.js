const DB_NAME = "misuper";
const DB_VERSION = 2;
const STORE = "tickets";
const PRODUCTS_STORE = "products";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains(PRODUCTS_STORE)) {
        db.createObjectStore(PRODUCTS_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function normalizeKey(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Learns a product name the user confirmed/corrected, so future OCR reads
// of similar (noisy) text can be auto-corrected against this personal dictionary.
export async function upsertKnownProduct(name) {
  const key = normalizeKey(name);
  if (key.length < 3) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRODUCTS_STORE, "readwrite");
    const store = tx.objectStore(PRODUCTS_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      store.put({
        key,
        name: name.trim(),
        count: (existing?.count || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getKnownProducts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PRODUCTS_STORE, "readonly");
    const req = tx.objectStore(PRODUCTS_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTicket(ticket) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(ticket);
    tx.oncomplete = () => resolve(ticket);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteTicket(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllTickets() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.date.localeCompare(a.date)));
    req.onerror = () => reject(req.error);
  });
}

export function newId() {
  return "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export async function importTickets(tickets) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const t of tickets) store.put(t);
    tx.oncomplete = () => resolve(tickets.length);
    tx.onerror = () => reject(tx.error);
  });
}
