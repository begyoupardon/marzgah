import * as z from 'zod'

const optional = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined))

const schema = z.object({
  BETTER_AUTH_URL: optional,
  BETTER_AUTH_SECRET: optional,
  BOOTSTRAP_ADMIN_EMAIL: optional,
  MARZBAN_BASE_URL: optional.transform((v) => v?.replace(/\/$/, '')),
  MARZBAN_USERNAME: optional,
  MARZBAN_PASSWORD: optional,
  MARZBAN_WEBHOOK_SECRET: optional,
  MARZBAN_SUBSCRIPTION_URL_PREFIX: optional,
  DATABASE_PATH: optional,
  BACKUP_DIR: optional,
  BACKUP_KEEP: optional.transform((v) => (v ? Number(v) : 14)),
  SCHEDULER: optional.transform((v) => v !== 'off'),
})

export type Env = z.infer<typeof schema>

/** Parsed on every call so tests and late-set variables are honoured. */
export function getEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return schema.parse(source)
}

/** Human-readable problems that should stop a production boot. */
export function envProblems(env: Env = getEnv()): string[] {
  const problems: string[] = []
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    problems.push('BETTER_AUTH_SECRET must be at least 32 characters')
  }
  if (!env.BETTER_AUTH_URL) problems.push('BETTER_AUTH_URL is required')
  if (env.BACKUP_KEEP !== undefined && !(env.BACKUP_KEEP > 0)) {
    problems.push('BACKUP_KEEP must be a positive number')
  }
  return problems
}

export function assertEnv(env: Env = getEnv()) {
  const problems = envProblems(env)
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
  }
}
