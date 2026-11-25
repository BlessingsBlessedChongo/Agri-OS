import type { Metadata } from 'next'
import { DepotView } from './depot-view'

export const metadata: Metadata = { title: 'Depot', manifest: '/depot.webmanifest' }

export default function DepotPage() {
  return <DepotView />
}
