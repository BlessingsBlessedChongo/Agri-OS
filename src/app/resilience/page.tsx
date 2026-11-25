import type { Metadata } from 'next'
import { ResilienceView } from './resilience-view'

export const metadata: Metadata = { title: 'Resilience' }

export default function ResiliencePage() {
  return <ResilienceView />
}
