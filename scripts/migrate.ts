import path from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { closeDb, db } from '../src/server/db'

async function main() {
  const migrationsFolder = path.join(process.cwd(), 'drizzle')
  await migrate(db, { migrationsFolder })
  console.log('Database is up to date.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closeDb())
