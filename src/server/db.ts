import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

// int8 (bigint) comes back from Postgres as text; every bigint here is ngwee or an id far below 2^53.
pg.types.setTypeParser(20, (value) => Number(value))

const globalForDb = globalThis as unknown as { agriosPool?: pg.Pool }

function makePool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env (or run npm run setup).')
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 10_000,
    ssl: /sslmode=require|neon\.tech|supabase\.co/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  })
  pool.on('error', (error) => console.error('[db] idle client error', error.message))
  return pool
}

export function getPool(): pg.Pool {
  if (!globalForDb.agriosPool) globalForDb.agriosPool = makePool()
  return globalForDb.agriosPool
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

let cachedDb: DrizzleDb | null = null

/** The Drizzle client; the pool is created on first use so importing this module never needs a database. */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    if (!cachedDb) cachedDb = drizzle(getPool(), { schema })
    const value = Reflect.get(cachedDb, prop)
    return typeof value === 'function' ? value.bind(cachedDb) : value
  },
})

export type Db = DrizzleDb
export type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export async function closeDb(): Promise<void> {
  if (globalForDb.agriosPool) {
    await globalForDb.agriosPool.end()
    globalForDb.agriosPool = undefined
    cachedDb = null
  }
}

/** Rows from a raw SQL query. */
export async function rows<T>(runner: DbOrTx, query: Parameters<DbOrTx['execute']>[0]): Promise<T[]> {
  const result = await runner.execute(query)
  return result.rows as T[]
}
