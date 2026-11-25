import type { Metadata, Viewport } from 'next'
import { Atkinson_Hyperlegible_Next, Big_Shoulders } from 'next/font/google'
import { WorldProvider } from '@/lib/world'
import { SiteFooter, SiteHeader } from '@/ui/site-header'
import './globals.css'

const text = Atkinson_Hyperlegible_Next({ subsets: ['latin'], variable: '--font-text-family', display: 'swap' })
const display = Big_Shoulders({ subsets: ['latin'], variable: '--font-display-family', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Agri-OS: a harvest, settled to the ngwee', template: '%s | Agri-OS' },
  description:
    'Trade infrastructure for smallholder farmers in Zambia: USSD offers on basic phones, depot weighing that works offline, escrowed mobile-money settlement, reverse invoicing and a tax-authority view.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfa' },
    { media: '(prefers-color-scheme: dark)', color: '#141e18' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${text.variable} ${display.variable}`}>
      <body className="min-h-screen antialiased">
        <WorldProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-maize focus:px-3 focus:py-2 focus:text-maize-ink">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="mx-auto max-w-[1320px] px-4 pt-8 sm:px-6">
            {children}
          </main>
          <SiteFooter />
        </WorldProvider>
      </body>
    </html>
  )
}
