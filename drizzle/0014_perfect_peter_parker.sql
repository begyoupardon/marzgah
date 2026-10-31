CREATE TABLE `telegram_bots` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_user_id` text,
	`bot_username` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`webhook_secret_hash` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`legacy_shared` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_bots_webhook_secret_hash_unique` ON `telegram_bots` (`webhook_secret_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_bots_owner_idx` ON `telegram_bots` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_bots_platform_idx` ON `telegram_bots` (`kind`) WHERE "telegram_bots"."kind" = 'platform';--> statement-breakpoint
CREATE INDEX `telegram_bots_enabled_idx` ON `telegram_bots` (`enabled`);--> statement-breakpoint
CREATE TABLE `telegram_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `telegram_bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telegram_confirmations_due_idx` ON `telegram_confirmations` (`expires_at`,`consumed_at`);--> statement-breakpoint
CREATE INDEX `telegram_confirmations_actor_idx` ON `telegram_confirmations` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`bot_id` text NOT NULL,
	`update_id` text NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `telegram_bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_updates_bot_update_idx` ON `telegram_updates` (`bot_id`,`update_id`);--> statement-breakpoint
CREATE INDEX `telegram_updates_received_idx` ON `telegram_updates` (`received_at`);--> statement-breakpoint
ALTER TABLE `telegram_link_codes` ADD `bot_id` text REFERENCES telegram_bots(id);--> statement-breakpoint
ALTER TABLE `telegram_links` ADD `bot_id` text REFERENCES telegram_bots(id);