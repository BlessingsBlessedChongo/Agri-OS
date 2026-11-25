export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6371

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Roads are longer than the straight line; 1.15 matches main routes such as Chipata–Lusaka closely enough to price haulage. */
export const ROAD_FACTOR = 1.15

export function roadKm(a: LatLng, b: LatLng): number {
  return Math.max(1, Math.round(haversineKm(a, b) * ROAD_FACTOR))
}
