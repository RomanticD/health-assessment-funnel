import type { Metadata } from 'next'

import './globals.css'
import './studio.css'

export const metadata: Metadata = {
  title: {
    default: 'Kindred Health · Your Space. Your Pace.',
    template: '%s · Kindred Health',
  },
  description:
    'Find a personal starting point for Pilates-inspired movement, everyday habits, and your wellness goals.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
