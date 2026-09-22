import { notFound } from 'next/navigation'

import { ResultExperience } from '@/components/results/result-experience'
import { uuidSchema } from '@/shared/contracts'

type ResultPageProps = {
  params: Promise<{ assessmentId: string }>
}

export default async function ResultPage({ params }: ResultPageProps) {
  const { assessmentId } = await params
  const parsedId = uuidSchema.safeParse(assessmentId)
  if (!parsedId.success) notFound()

  return <ResultExperience assessmentId={parsedId.data} />
}
