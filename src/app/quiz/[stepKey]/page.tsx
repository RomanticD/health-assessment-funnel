import { notFound } from 'next/navigation'

import { PersonalQuiz } from '@/components/quiz/personal-quiz'
import { assessmentStepKeySchema } from '@/shared/contracts'
import { FUNNEL_KEYS } from '@/shared/contracts/funnel'

type QuizStepPageProps = {
  params: Promise<{ stepKey: string }>
}

export default async function QuizStepPage({ params }: QuizStepPageProps) {
  const { stepKey } = await params

  const parsedStep = assessmentStepKeySchema.safeParse(stepKey)
  const isQuestionKey = FUNNEL_KEYS.includes(stepKey as (typeof FUNNEL_KEYS)[number])
  if (!parsedStep.success && !isQuestionKey && stepKey !== 'review') notFound()

  return <PersonalQuiz />
}
