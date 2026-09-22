import { DemoPaywallExperience } from '@/components/results/demo-paywall-experience'

export const metadata = {
  title: 'Personal summary · Preview',
  robots: {
    index: false,
    follow: false,
  },
}

export default function DemoPaywallPage() {
  return <DemoPaywallExperience />
}
