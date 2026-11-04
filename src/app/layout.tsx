import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { site } from '@/content'
import './globals.css'

// One family. Width is the expressive axis: 62% for statements, 125% for the wordmark.
const archivo = localFont({
  src: './fonts/archivo-wdth.woff2',
  variable: '--font-archivo',
  weight: '100 900',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
})

// Social cards need absolute URLs. Set NEXT_PUBLIC_SITE_URL; Vercel, Netlify and Cloudflare Pages supply one at build time.
const siteUrl = [
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.URL,
  process.env.CF_PAGES_URL,
].find((u) => u?.startsWith('http'))

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: site.title,
  description: site.description,
  applicationName: 'AIGROW',
  openGraph: {
    type: 'website',
    siteName: 'AIGROW',
    title: site.title,
    description: site.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: site.title,
    description: site.description,
  },
}

export const viewport: Viewport = {
  themeColor: '#04050a',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  )
}
