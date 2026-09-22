import { notFound } from 'next/navigation'

import { PersonalQuiz } from '@/components/quiz/personal-quiz'
import { assessmentStepKeySchema } from '@/shared/contracts'

type QuizStepPageProps = {
  params: Promise<{ stepKey: string }>
}

export default async function QuizStepPage({ params }: QuizStepPageProps) {
  const { stepKey } = await params

  const parsedStep = assessmentStepKeySchema.safeParse(stepKey)
  if (!parsedStep.success && stepKey !== 'review') notFound()

  return <PersonalQuiz />
}
