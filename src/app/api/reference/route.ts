import { db } from '@/server/db'
import { json, worldRoute } from '@/server/http'
import { listBuyers, listDepots, listFarmers, listTransporters } from '@/server/reference'

/** Depots, buyers, transporters and farmers this sandbox can see (shared ones plus its own). */
export const GET = worldRoute(async (_request, { world }) => {
  const [depots, buyers, transporters, farmers] = await Promise.all([listDepots(db, world.id), listBuyers(db, world.id), listTransporters(db, world.id), listFarmers(db, world.id)])
  return json({
    depots: depots.map((d) => ({ ...d.depot, districtName: d.districtName, provinceName: d.provinceName })),
    buyers,
    transporters,
    farmers: farmers.map((f) => ({ id: f.id, code: f.code, name: f.name, phone: f.phone, depotId: f.depotId, districtId: f.districtId, language: f.language, registeredHere: f.worldId === world.id })),
  })
})
