/**
 * The depot device's outbox, in IndexedDB so it survives a reload or a dead battery. Each delivery keeps the id it
 * was given on the device; the server uses that id to recognise a record it has already received.
 */
export interface OutboxItem {
  id: string
  worldId: string
  depotId: string
  farmerName: string
  payload: Record<string, unknown>
  savedAt: string
  refused?: string
}

const DB = 'agrios-depot'
const STORE = 'outbox'
const memory = new Map<string, OutboxItem>()

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveToOutbox(item: OutboxItem): Promise<void> {
  memory.set(item.id, item)
  await run('readwrite', (s) => s.put(item)).catch(() => undefined)
}

export async function readOutbox(worldId: string): Promise<OutboxItem[]> {
  const stored = await run<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>).catch(() => undefined)
  const all = stored ?? [...memory.values()]
  return all.filter((i) => i.worldId === worldId).sort((a, b) => a.savedAt.localeCompare(b.savedAt))
}

export async function dropFromOutbox(ids: string[]): Promise<void> {
  for (const id of ids) {
    memory.delete(id)
    await run('readwrite', (s) => s.delete(id)).catch(() => undefined)
  }
}

export async function markRefused(id: string, message: string): Promise<void> {
  const item = memory.get(id) ?? (await run<OutboxItem>('readonly', (s) => s.get(id) as IDBRequest<OutboxItem>).catch(() => undefined))
  if (!item) return
  await saveToOutbox({ ...item, refused: message })
}
