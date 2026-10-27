import { z } from 'zod'

export const VpnUserStatusSchema = z.enum([
  'active',
  'disabled',
  'limited',
  'expired',
  'on_hold',
])
