interface SuccessResponseOptions {
  status?: number
  headers?: HeadersInit
  etag?: string
}

export function successResponse<T>(data: T, options: SuccessResponseOptions = {}): Response {
  const headers = new Headers(options.headers)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Vary', 'Cookie, Authorization')
  if (options.etag !== undefined) headers.set('ETag', options.etag)

  return Response.json(
    { data },
    {
      status: options.status ?? 200,
      headers,
    },
  )
}
