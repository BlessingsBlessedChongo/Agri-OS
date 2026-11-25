import type { Metadata } from 'next'
import { DemoStage } from './demo-stage'

export const metadata: Metadata = { title: 'Run a harvest' }

export default function DemoPage() {
  return <DemoStage />
}
