import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Kindred Health · Educational Wellness Snapshot',
    template: '%s · Kindred Health',
  },
  description:
    'A transparent, resumable health assessment demo with server-calculated results and explicit limitations.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
