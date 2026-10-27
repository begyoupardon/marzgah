CREATE TABLE `renewal_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`vpn_user_id` text NOT NULL,
	`reseller_id` text NOT NULL,
	`months` integer NOT NULL,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`vpn_user_id`) REFERENCES `vpn_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reseller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `renewal_requests_reseller_idx` ON `renewal_requests` (`reseller_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `renewal_requests_one_pending_idx` ON `renewal_requests` (`vpn_user_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `subscription_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`vpn_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`vpn_user_id`) REFERENCES `vpn_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_tokens_token_hash_unique` ON `subscription_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `subscription_tokens_user_idx` ON `subscription_tokens` (`vpn_user_id`);--> statement-breakpoint
ALTER TABLE `reseller_profiles` ADD `public_name` text;--> statement-breakpoint
ALTER TABLE `reseller_profiles` ADD `support_contact` text;