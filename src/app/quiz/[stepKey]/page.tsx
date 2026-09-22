import { notFound } from 'next/navigation'

import { QuizFlow } from '@/components/quiz/quiz-flow'
import { assessmentStepKeySchema } from '@/shared/contracts'

type QuizStepPageProps = {
  params: Promise<{ stepKey: string }>
}

export default async function QuizStepPage({ params }: QuizStepPageProps) {
  const { stepKey } = await params

  const parsedStep = assessmentStepKeySchema.safeParse(stepKey)
  if (!parsedStep.success && stepKey !== 'review') notFound()

  return <QuizFlow stepKey={parsedStep.success ? parsedStep.data : 'review'} />
}
