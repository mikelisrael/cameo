/** Most times a download that dies mid-body is picked up again where it stopped. */
const MAX_RESUMES = 3

/** `fetch` for the model files: when the connection drops while the body is being read, ask the server for the
 * rest (`Range: bytes=<received>-`) and carry on, so a dropped download doesn't restart from zero. Only a 206
 * answer is used; anything else surfaces the original error and the caller retries the whole file. */
export async function resumableFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status !== 200 || !res.body) return res

  // `received` counts decoded bytes but Range counts wire bytes, so an encoded body can't be resumed.
  const encoding = res.headers.get('Content-Encoding')?.trim().toLowerCase()
  const resumable = !encoding || encoding === 'identity'

  let reader = res.body.getReader()
  let received = 0
  let resumes = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        try {
          const { done, value } = await reader.read()
          if (done) return controller.close()
          received += value.length
          return controller.enqueue(value)
        } catch (err) {
          if (!resumable || received === 0 || resumes >= MAX_RESUMES) return controller.error(err)
          try {
            const headers = new Headers(init?.headers)
            headers.set('Range', `bytes=${received}-`)
            const next = await fetch(input, { ...init, headers })
            const range = next.headers.get('Content-Range')
            if (next.status !== 206 || !next.body || (range && !range.startsWith(`bytes ${received}-`))) {
              void next.body?.cancel().catch(() => undefined)
              return controller.error(err)
            }
            reader = next.body.getReader()
            resumes++
          } catch {
            return controller.error(err)
          }
        }
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}
