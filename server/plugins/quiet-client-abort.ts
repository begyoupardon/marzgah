// TanStack Start rejects an in-flight SSR request with the request's
// AbortError when the browser cancels it (refresh, navigation, closed tab).
// h3 then logs that as an unhandled 500 from inside the framework, before any
// app code can intercept it. The client is already gone, so drop just that log.
export default () => {
  const log = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    const [first] = args
    const cause = (first as { cause?: { name?: string } } | undefined)?.cause
    if (args.length === 1 && cause?.name === 'AbortError') return
    log(...args)
  }
}
