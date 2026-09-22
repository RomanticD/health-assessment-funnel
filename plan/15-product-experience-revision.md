# Product experience revision

## Product manager review

The first UI exposed engineering concerns (server persistence, formulas, algorithm versions) in consumer copy. The review also identified repeated session restoration, premature progress percentages, and a duplicate-click window. This revision replaces the old four-block UI with a 15-question experience.

## Visual direction

UI/UX Pro Max was read and queried for a wellness editorial design system. The useful recommendations were a photographic hero, generous spacing, clear hierarchy, consistent interaction states, and accessible controls. The generic dashboard-style palette was not adopted wholesale: Kindred uses warm ivory, terracotta actions, restrained serif accents, and an original generated Pilates studio image. The image is illustrative, not a customer testimonial or claim of an actual trainer.

## Questions and use

Motivation, weight direction, Pilates experience, activity, sitting, focus areas, barriers, duration, days, equipment, sex, age, height, current weight, and target weight are persisted independently. Core measurements still feed the existing versioned server algorithm. Preferences feed a transparent starting-routine summary; we do not claim to deliver classes or a bespoke clinical program. Focus areas mean movement interests, not spot-fat reduction.

## Persistence and interaction

- `assessment_funnel_answers` is a companion draft with its own revision; GET/PUT `/api/v1/assessments/{id}/funnel` resolves the existing session and ownership.
- Every question saves before advancing. Measurements support kg/lb and cm/in; persisted values remain metric.
- `If-Match` prevents conflicting writes; a same-value retry returns the saved state without incrementing revision.
- Questionnaire state stays in React memory between questions. It is never placed in Web Storage. Entry can reuse the in-memory core assessment obtained by the landing button.
- Only a cold load uses a matching question skeleton. Save and submit show feedback in the selected answer/button.
- Reload resumes at the first unanswered question. Review offers direct edits and returns to review after saving.
- Final confirmation synchronizes the four validated core steps then submits through the existing algorithm. A network failure retains all draft answers and can be retried. Core result creation remains transactional and immutable.
- The original four-step API remains compatible with existing integrations. Preference questions are required by this UI, but not retroactively required of existing API clients.

## Copy placement

Home explains benefits; questions explain relevance; results explain the user's starting point. Technical details belong in engineering documents. Privacy/storage details have their own `/privacy` page. The checkout explicitly states that it is a free simulation. Brief estimation/medical context stays at the end of the result.

## Verification

Added real database/API coverage for partial measurement recovery, repeat saves, simultaneous revisions, invalid values, conflicting multi-select options and ownership. Updated the mobile browser E2E to traverse all 15 questions, refresh midway, edit review, check that session creation is not repeated per question, and complete mock checkout.
