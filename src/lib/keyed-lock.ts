const tails = new Map<string, Promise<unknown>>()

/**
 * Run `task` after earlier tasks with the same key finish, so check-then-write
 * sequences (quota, credit) can't interleave.
 * shortcut: per process only, add a database guard if panels ever run as several instances.
 */
export function withKeyedLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(task, task)
  const tail = run.catch(() => {})
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return run
}
