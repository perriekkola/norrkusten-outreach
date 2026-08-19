/** Newline-delimited JSON progress events, shared by the server routes and the client. */
export type Progress = { phase: string; detail?: string }
export type StreamEvent<T> =
  | { type: 'progress'; phase: string; detail?: string }
  | { type: 'done'; result: T }
  | { type: 'error'; message: string }

export function progressStream<T>(
  work: (report: (event: Progress) => void) => Promise<T>,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent<T>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      try {
        const result = await work((event) => send({ type: 'progress', ...event }))
        send({ type: 'done', result })
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Proxies that buffer would defeat the point of streaming at all.
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Reads a progressStream, calling onProgress as events arrive, resolving with the result. */
export async function readProgress<T>(
  url: string,
  body: unknown,
  onProgress: (event: Progress) => void,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) throw new Error(`Request failed (${response.status})`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // A chunk can split a line, so keep the tail until its newline arrives.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as StreamEvent<T>
      if (event.type === 'progress') onProgress({ phase: event.phase, detail: event.detail })
      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'done') return event.result
    }
  }
  throw new Error('The server closed the connection before finishing')
}
