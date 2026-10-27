export type JobResult = unknown
export type Job = {
  name: string
  intervalMs: number
  run: () => Promise<JobResult> | JobResult
  /** Delay before the first run, so boot isn't slowed down. */
  initialDelayMs?: number
}

export type JobFailureHandler = (job: string, error: unknown) => void

/**
 * Minimal in-process scheduler. Runs never overlap per job, and one job's
 * failure never stops others. Timers are injectable so tests stay instant.
 */
export function createScheduler(
  options: {
    onFailure?: JobFailureHandler
    setTimer?: typeof setInterval
    clearTimer?: typeof clearInterval
    setDelay?: typeof setTimeout
  } = {},
) {
  const setTimer = options.setTimer ?? setInterval
  const clearTimer = options.clearTimer ?? clearInterval
  const setDelay = options.setDelay ?? setTimeout
  const running = new Set<string>()
  const timers: Array<ReturnType<typeof setInterval>> = []
  const jobs = new Map<string, Job>()

  async function runJob(name: string) {
    const job = jobs.get(name)
    if (!job || running.has(name)) return false
    running.add(name)
    try {
      await job.run()
      return true
    } catch (error) {
      options.onFailure?.(name, error)
      return false
    } finally {
      running.delete(name)
    }
  }

  return {
    register(job: Job) {
      jobs.set(job.name, job)
    },
    runJob,
    isRunning: (name: string) => running.has(name),
    start() {
      for (const job of jobs.values()) {
        const timer = setTimer(() => void runJob(job.name), job.intervalMs)
        ;(timer as { unref?: () => void }).unref?.()
        timers.push(timer)
        const first = setDelay(
          () => void runJob(job.name),
          job.initialDelayMs ?? 5_000,
        )
        ;(first as { unref?: () => void }).unref?.()
      }
    },
    stop() {
      for (const t of timers) clearTimer(t)
      timers.length = 0
    },
  }
}
