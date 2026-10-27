ALTER TABLE `vpn_users` ADD COLUMN `removed_at` integer;
--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`reseller_id` text NOT NULL,
	`vpn_user_id` text NOT NULL,
	`marzban_username` text NOT NULL,
	`type` text NOT NULL,
	`data_limit_gb` integer NOT NULL,
	`duration_months` integer,
	`price_per_gb_toman` integer NOT NULL,
	`amount_toman` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`claimed_paid_at` integer,
	`claimed_by_user_id` text,
	`settled_at` integer,
	`settled_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reseller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vpn_user_id`) REFERENCES `vpn_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`settled_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billing_events_reseller_idx` ON `billing_events` (`reseller_id`);
--> statement-breakpoint
CREATE INDEX `billing_events_vpn_user_idx` ON `billing_events` (`vpn_user_id`);
--> statement-breakpoint
CREATE INDEX `billing_events_settled_idx` ON `billing_events` (`settled_at`);
--> statement-breakpoint
CREATE INDEX `billing_events_created_idx` ON `billing_events` (`created_at`);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_role` text DEFAULT 'system' NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`vpn_username` text,
	`reseller_id` text,
	`payload_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reseller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `audit_logs_reseller_idx` ON `audit_logs` (`reseller_id`);
--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);
