import type { Clock } from '@/server/application/ports/clock'

export const systemClock: Clock = {
  now: () => new Date(),
}
