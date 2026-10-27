ALTER TABLE `user` ADD COLUMN `role` text DEFAULT 'reseller' NOT NULL;
--> statement-breakpoint
CREATE TABLE `reseller_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_users` integer DEFAULT 10 NOT NULL,
	`max_total_data_bytes` integer,
	`max_expire_days` integer,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reseller_profiles_user_id_unique` ON `reseller_profiles` (`user_id`);
--> statement-breakpoint
CREATE INDEX `reseller_profiles_status_idx` ON `reseller_profiles` (`status`);
--> statement-breakpoint
CREATE TABLE `vpn_users` (
	`id` text PRIMARY KEY NOT NULL,
	`reseller_id` text NOT NULL,
	`marzban_username` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`data_limit_bytes` integer,
	`used_traffic_bytes` integer DEFAULT 0 NOT NULL,
	`expire_at` integer,
	`subscription_url` text,
	`note` text,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reseller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vpn_users_marzban_username_unique` ON `vpn_users` (`marzban_username`);
--> statement-breakpoint
CREATE INDEX `vpn_users_reseller_idx` ON `vpn_users` (`reseller_id`);
--> statement-breakpoint
CREATE INDEX `vpn_users_status_idx` ON `vpn_users` (`status`);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`action` text NOT NULL,
	`enqueued_at` integer NOT NULL,
	`tries` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_idempotent_idx` ON `webhook_events` (`username`,`action`,`enqueued_at`);
--> statement-breakpoint
DROP TABLE IF EXISTS `todos`;
