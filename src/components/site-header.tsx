import Link from 'next/link'

import { BrandMark } from '@/components/brand-mark'

type SiteHeaderProps = {
  compact?: boolean
}

export function SiteHeader({ compact = false }: SiteHeaderProps) {
  return (
    <header className={compact ? 'site-header site-header--compact' : 'site-header'}>
      <Link className="brand" href="/" aria-label="Kindred Health home">
        <BrandMark />
        <span>Kindred Health</span>
      </Link>
      {!compact && (
        <Link className="header-note" href="/#how-it-works">
          How it works ↗
        </Link>
      )}
    </header>
  )
}
