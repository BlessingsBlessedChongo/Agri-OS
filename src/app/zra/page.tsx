import type { Metadata } from 'next'
import { ZraView } from './zra-view'

export const metadata: Metadata = { title: 'ZRA' }

export default function ZraPage() {
  return <ZraView />
}
