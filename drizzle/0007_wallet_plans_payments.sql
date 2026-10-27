CREATE TABLE `payment_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`reseller_id` text NOT NULL,
	`provider` text NOT NULL,
	`amount_toman` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_ref` text,
	`receipt_json` text,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reseller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payment_requests_reseller_idx` ON `payment_requests` (`reseller_id`);--> statement-breakpoint
CREATE INDEX `payment_requests_status_idx` ON `payment_requests` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_external_idx` ON `payment_requests` (`provider`,`external_ref`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data_limit_gb` integer NOT NULL,
	`duration_days` integer,
	`price_toman` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`reseller_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_toman` integer NOT NULL,
	`reason` text NOT NULL,
	`provider` text NOT NULL,
	`reference` text NOT NULL,
	`actor_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reseller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wallet_entries_reseller_idx` ON `wallet_entries` (`reseller_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_entries_idempotent_idx` ON `wallet_entries` (`provider`,`reference`);--> statement-breakpoint
ALTER TABLE `reseller_profiles` ADD `credit_limit_toman` integer;