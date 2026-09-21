export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    {
      data: {
        status: 'ok',
        release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
