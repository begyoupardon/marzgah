import { relations, sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .default(false)
    .notNull(),
  image: text('image'),
  role: text('role', { enum: ['admin', 'reseller'] })
    .default('reseller')
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', {
    mode: 'timestamp_ms',
  }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', {
    mode: 'timestamp_ms',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$onUpdate(() => new Date())
    .notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const resellerProfiles = sqliteTable(
  'reseller_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
      .unique(),
    status: text('status', { enum: ['active', 'disabled'] })
      .default('active')
      .notNull(),
    /** Prepended to VPN usernames: `{usernameSuffix}_{localName}` */
    usernameSuffix: text('username_suffix').notNull().unique(),
    /** Reseller sell price per GB in Iranian toman */
    pricePerGbToman: integer('price_per_gb_toman').notNull(),
    /** When true, this reseller may create/renew VPN users with no expiry */
    allowUnlimitedExpire: integer('allow_unlimited_expire', { mode: 'boolean' })
      .default(false)
      .notNull(),
    /**
     * Max unsettled debt (toman) beyond wallet balance. NULL keeps the legacy
     * post-paid behaviour (no limit).
     */
    creditLimitToman: integer('credit_limit_toman'),
    /** Caps on active (non-removed) users / allocated GB. NULL = unlimited. */
    /** Shown on the customer's public page. */
    publicName: text('public_name'),
    supportContact: text('support_contact'),
    maxUsers: integer('max_users'),
    maxTotalGb: integer('max_total_gb'),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('reseller_profiles_status_idx').on(t.status)],
)

export const vpnUsers = sqliteTable(
  'vpn_users',
  {
    id: text('id').primaryKey(),
    resellerId: text('reseller_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    marzbanUsername: text('marzban_username').notNull().unique(),
    /** Which VPN server hosts this account (see src/lib/backends). */
    backend: text('backend').default('marzban').notNull(),
    status: text('status', {
      enum: ['active', 'disabled', 'limited', 'expired', 'on_hold'],
    })
      .default('active')
      .notNull(),
    dataLimitBytes: integer('data_limit_bytes', { mode: 'number' }),
    usedTrafficBytes: integer('used_traffic_bytes', { mode: 'number' })
      .default(0)
      .notNull(),
    expireAt: integer('expire_at', { mode: 'timestamp_ms' }),
    subscriptionUrl: text('subscription_url'),
    note: text('note'),
    contactPhone: text('contact_phone'),
    contactTelegram: text('contact_telegram'),
    /** JSON array of short strings, e.g. ["vip","friend"] */
    labels: text('labels'),
    /** Set when disabled by a reseller suspension; cleared on resume. */
    suspendedAt: integer('suspended_at', { mode: 'timestamp_ms' }),
    /** Soft-removed locally; row and billing ledger are never hard-deleted. */
    removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('vpn_users_reseller_idx').on(t.resellerId),
    index('vpn_users_status_idx').on(t.status),
  ],
)

export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    resellerId: text('reseller_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    vpnUserId: text('vpn_user_id')
      .notNull()
      .references(() => vpnUsers.id, { onDelete: 'cascade' }),
    marzbanUsername: text('marzban_username').notNull(),
    type: text('type', {
      enum: ['create', 'renew', 'extra_gb'],
    }).notNull(),
    dataLimitGb: integer('data_limit_gb', { mode: 'number' }).notNull(),
    durationMonths: integer('duration_months', { mode: 'number' }),
    pricePerGbToman: integer('price_per_gb_toman').notNull(),
    amountToman: integer('amount_toman').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    claimedPaidAt: integer('claimed_paid_at', { mode: 'timestamp_ms' }),
    claimedByUserId: text('claimed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    settledAt: integer('settled_at', { mode: 'timestamp_ms' }),
    settledByUserId: text('settled_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    index('billing_events_reseller_idx').on(t.resellerId),
    index('billing_events_vpn_user_idx').on(t.vpnUserId),
    index('billing_events_settled_idx').on(t.settledAt),
    index('billing_events_created_idx').on(t.createdAt),
  ],
)

/** Append-only money ledger. Balance = SUM(credit) - SUM(debit). */
export const walletEntries = sqliteTable(
  'wallet_entries',
  {
    id: text('id').primaryKey(),
    resellerId: text('reseller_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['credit', 'debit'] }).notNull(),
    amountToman: integer('amount_toman').notNull(),
    reason: text('reason').notNull(),
    /** Idempotency key within `provider` (payment ref, billing event id, ...). */
    provider: text('provider').notNull(),
    reference: text('reference').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    index('wallet_entries_reseller_idx').on(t.resellerId),
    uniqueIndex('wallet_entries_idempotent_idx').on(t.provider, t.reference),
  ],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  encrypted: integer('encrypted', { mode: 'boolean' }).default(false).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
})

/** One Telegram chat per panel user; created when they confirm a link code. */
export const telegramLinks = sqliteTable('telegram_links', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull().unique(),
  linkedAt: integer('linked_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
})

/** Short-lived, single-use codes. Only the SHA-256 hash is stored. */
export const telegramLinkCodes = sqliteTable('telegram_link_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Transactional outbox: rows are written with the business event, sent later. */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    /** Same key twice = same notification; makes producers safe to re-run. */
    dedupeKey: text('dedupe_key').notNull().unique(),
    text: text('text').notNull(),
    status: text('status', { enum: ['queued', 'sent', 'dead', 'skipped'] })
      .default('queued')
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    /** Also acts as a lease while a worker holds the row. */
    nextAttemptAt: integer('next_attempt_at', {
      mode: 'timestamp_ms',
    }).notNull(),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('notifications_due_idx').on(t.status, t.nextAttemptAt),
    index('notifications_user_idx').on(t.userId),
  ],
)

/** Bearer links for the public customer page. Only a hash is stored. */
export const subscriptionTokens = sqliteTable(
  'subscription_tokens',
  {
    id: text('id').primaryKey(),
    vpnUserId: text('vpn_user_id')
      .notNull()
      .references(() => vpnUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [index('subscription_tokens_user_idx').on(t.vpnUserId)],
)

/** A customer's "please renew me" note; the seller approves or rejects. */
export const renewalRequests = sqliteTable(
  'renewal_requests',
  {
    id: text('id').primaryKey(),
    vpnUserId: text('vpn_user_id')
      .notNull()
      .references(() => vpnUsers.id, { onDelete: 'cascade' }),
    resellerId: text('reseller_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    months: integer('months').notNull(),
    message: text('message'),
    status: text('status', {
      enum: ['pending', 'approved', 'rejected'],
    })
      .default('pending')
      .notNull(),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    index('renewal_requests_reseller_idx').on(t.resellerId, t.status),
    // at most one open request per customer
    uniqueIndex('renewal_requests_one_pending_idx')
      .on(t.vpnUserId)
      .where(sql`status = 'pending'`),
  ],
)

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorRole: text('actor_role', { enum: ['admin', 'reseller', 'system'] })
      .notNull()
      .default('system'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    vpnUsername: text('vpn_username'),
    resellerId: text('reseller_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    payloadJson: text('payload_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_reseller_idx').on(t.resellerId),
    index('audit_logs_action_idx').on(t.action),
  ],
)

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    action: text('action').notNull(),
    enqueuedAt: integer('enqueued_at', { mode: 'number' }).notNull(),
    tries: integer('tries').default(0).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    error: text('error'),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [
    uniqueIndex('webhook_events_idempotent_idx').on(
      t.username,
      t.action,
      t.enqueuedAt,
    ),
  ],
)

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  resellerProfile: one(resellerProfiles, {
    fields: [user.id],
    references: [resellerProfiles.userId],
  }),
  vpnUsers: many(vpnUsers),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const resellerProfilesRelations = relations(
  resellerProfiles,
  ({ one }) => ({
    user: one(user, {
      fields: [resellerProfiles.userId],
      references: [user.id],
    }),
  }),
)

export const vpnUsersRelations = relations(vpnUsers, ({ one, many }) => ({
  reseller: one(user, {
    fields: [vpnUsers.resellerId],
    references: [user.id],
  }),
  billingEvents: many(billingEvents),
}))

export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
  reseller: one(user, {
    fields: [billingEvents.resellerId],
    references: [user.id],
  }),
  vpnUser: one(vpnUsers, {
    fields: [billingEvents.vpnUserId],
    references: [vpnUsers.id],
  }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(user, {
    fields: [auditLogs.actorUserId],
    references: [user.id],
  }),
  reseller: one(user, {
    fields: [auditLogs.resellerId],
    references: [user.id],
  }),
}))
