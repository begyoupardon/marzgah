import { assertEnv } from '../../src/lib/env'
import { startBackground } from '../../src/lib/jobs'

// Fail fast on bad config, then start the in-process scheduler.
export default () => {
  if (process.env.NODE_ENV === 'production') assertEnv()
  startBackground()
}
