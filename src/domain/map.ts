import map from '@/data/zambia-map.json'

/**
 * Zambia's provinces and districts as SVG paths (geoBoundaries gbOpen, CC BY 4.0), with the projection used to draw
 * them, so any latitude/longitude (a depot, a plant) lands in the right place on the same map.
 */
export interface MapDistrict {
  id: string
  name: string
  province: string
  d: string
  cx: number
  cy: number
  lat: number
  lng: number
}

export interface MapProvince {
  id: string
  name: string
  d: string
}

export const ZAMBIA_MAP = map as {
  viewBox: string
  width: number
  height: number
  projection: { type: 'equirectangular'; lonMin: number; latMax: number; kx: number; scale: number }
  provinces: MapProvince[]
  districts: MapDistrict[]
  source: { name: string; url: string; license: string; attribution: string; retrieved: string }
}

export function project(lat: number, lng: number): { x: number; y: number } {
  const p = ZAMBIA_MAP.projection
  return { x: (lng - p.lonMin) * p.kx * p.scale, y: (p.latMax - lat) * p.scale }
}

export const PROVINCE_NAMES: Record<string, string> = Object.fromEntries(ZAMBIA_MAP.provinces.map((p) => [p.id, p.name]))
