import { json, worldRoute } from '@/server/http'
import { accounts, ledgerHealth, recentEntries } from '@/server/ledger'

/** The books: every account's balance, the latest journal entries with their lines, and the invariants. */
export const GET = worldRoute(async (_request, { world }) => {
  const [list, entries, health] = await Promise.all([accounts(world.id), recentEntries(world.id, 30), ledgerHealth(world.id)])
  return json({ accounts: list, entries, health })
})
