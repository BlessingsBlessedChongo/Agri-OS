import type { Metadata } from 'next'
import { BuyerView } from './buyer-view'

export const metadata: Metadata = { title: 'Buyer' }

export default function BuyerPage() {
  return <BuyerView />
}
