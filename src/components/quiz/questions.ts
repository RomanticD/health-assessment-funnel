import type { FunnelKey } from '@/shared/contracts/funnel'

export type Question = {
  key: FunnelKey
  section: string
  title: string
  hint: string
  type?: 'multi' | 'number'
  unit?: string
  options?: readonly (readonly [string, string, string?])[]
}
export const QUESTIONS: readonly Question[] = [
  {
    key: 'motivation',
    section: 'Your goals',
    title: 'What would you love to feel more of?',
    hint: 'Choose what matters to you. You can pick more than one.',
    type: 'multi',
    options: [
      ['strength', 'A stronger body', 'Feel capable in everyday movement'],
      ['flexibility', 'More flexibility', 'Move with a little more ease'],
      ['posture', 'Better posture', 'Build awareness of how you move'],
      ['energy', 'Everyday energy', 'Make time to feel refreshed'],
      ['calm', 'A calmer mind', 'A small moment just for you'],
    ],
  },
  {
    key: 'primaryGoal',
    section: 'Your goals',
    title: 'What is your weight goal?',
    hint: 'There is no one right goal. Choose the direction that feels right for you.',
    options: [
      ['lose_weight', 'Lose weight'],
      ['maintain_weight', 'Maintain my weight'],
      ['gain_weight', 'Gain weight'],
    ],
  },
  {
    key: 'experience',
    section: 'Your starting point',
    title: 'Have you tried Pilates before?',
    hint: 'Every starting point belongs here.',
    options: [
      ['new', 'I’m brand new', 'Let’s start with the basics'],
      ['some', 'I’ve tried it a little', 'Ready to find my rhythm'],
      ['regular', 'I practice regularly', 'Looking for a more consistent routine'],
    ],
  },
  {
    key: 'activityLevel',
    section: 'Your everyday life',
    title: 'How often do you move?',
    hint: 'Think about an ordinary week, including workouts and active days.',
    options: [
      ['sedentary', 'Not very often', 'Mostly seated, little exercise'],
      ['light', '1–3 days a week', 'Walking or light exercise'],
      ['moderate', '3–5 days a week', 'Regular moderate exercise'],
      ['active', '6–7 days a week', 'Challenging workouts or an active job'],
      ['very_active', 'Intensive daily training', 'Very hard training and physical work'],
    ],
  },
  {
    key: 'sitting',
    section: 'Your everyday life',
    title: 'How much of your day is spent sitting?',
    hint: 'Your everyday rhythm matters as much as your workouts.',
    options: [
      ['little', 'Less than 4 hours'],
      ['some', '4–8 hours'],
      ['mostly', 'More than 8 hours'],
    ],
  },
  {
    key: 'focus',
    section: 'Your movement',
    title: 'Where would you like to focus?',
    hint: 'Choose your training interests, or go for a whole-body approach.',
    type: 'multi',
    options: [
      ['whole_body', 'My whole body'],
      ['core', 'Core & stability'],
      ['back', 'Back & posture'],
      ['legs', 'Legs & glutes'],
      ['arms', 'Arms & shoulders'],
    ],
  },
  {
    key: 'barriers',
    section: 'Your movement',
    title: 'What tends to get in the way?',
    hint: 'Let’s make room for real life. Choose all that apply.',
    type: 'multi',
    options: [
      ['time', 'Finding the time'],
      ['consistency', 'Staying consistent'],
      ['confidence', 'Knowing where to start'],
      ['none', 'I’m ready to get going'],
    ],
  },
  {
    key: 'minutes',
    section: 'Your routine',
    title: 'How much time feels realistic?',
    hint: 'A short routine you enjoy is a great place to begin.',
    options: [
      ['10', '10 minutes', 'A little daily reset'],
      ['15', '15 minutes', 'A manageable moment for you'],
      ['20', '20 minutes', 'Room to build your practice'],
      ['30', '30 minutes', 'Time to settle into movement'],
    ],
  },
  {
    key: 'days',
    section: 'Your routine',
    title: 'How many days can you make yours?',
    hint: 'Choose a weekly rhythm you can comfortably come back to.',
    options: [
      ['2', '2 days a week'],
      ['3', '3 days a week'],
      ['4', '4 days a week'],
      ['5', '5 days a week'],
    ],
  },
  {
    key: 'equipment',
    section: 'Your routine',
    title: 'What do you have at home?',
    hint: 'You don’t need a studio to make a start.',
    options: [
      ['none', 'Just me', 'No equipment yet'],
      ['mat', 'An exercise mat', 'A comfortable space to move'],
      ['bands', 'A mat & resistance bands', 'A little extra variety'],
    ],
  },
  {
    key: 'sexForCalorieEstimation',
    section: 'About you',
    title: 'What is your sex?',
    hint: 'This helps personalize your daily energy estimate.',
    options: [
      ['female', 'Female'],
      ['male', 'Male'],
    ],
  },
  {
    key: 'ageYears',
    section: 'About you',
    title: 'How old are you?',
    hint: 'Your needs change with you. Let’s start with your age.',
    type: 'number',
    unit: 'years',
  },
  {
    key: 'heightCm',
    section: 'About you',
    title: 'How tall are you?',
    hint: 'A little context for your personal starting point.',
    type: 'number',
    unit: 'cm',
  },
  {
    key: 'weightKg',
    section: 'About you',
    title: 'What is your current weight?',
    hint: 'This is a starting point, not a measure of your worth.',
    type: 'number',
    unit: 'kg',
  },
  {
    key: 'targetWeightKg',
    section: 'Your next chapter',
    title: 'What weight would you like to work toward?',
    hint: 'Choose a comfortable, gradual goal. You can review it before continuing.',
    type: 'number',
    unit: 'kg',
  },
]
export function answerLabel(key: FunnelKey, value: unknown): string {
  const question = QUESTIONS.find((q) => q.key === key)
  if (Array.isArray(value))
    return value.map((v) => question?.options?.find((o) => o[0] === v)?.[1] ?? String(v)).join(', ')
  return (
    question?.options?.find((o) => o[0] === value)?.[1] ??
    `${String(value ?? '')}${question?.unit ? ` ${question.unit}` : ''}`
  )
}
