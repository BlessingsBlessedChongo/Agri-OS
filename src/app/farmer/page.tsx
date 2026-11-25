import type { Metadata } from 'next'
import { FarmerView } from './farmer-view'

export const metadata: Metadata = { title: 'Farmer' }

export default function FarmerPage() {
  return <FarmerView />
}
