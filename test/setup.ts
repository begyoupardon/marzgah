// Unit tests must never touch the on-disk panel database.
process.env.DATABASE_PATH = ':memory:'
process.env.BETTER_AUTH_SECRET ??=
  'test-secret-at-least-thirty-two-characters-long'
