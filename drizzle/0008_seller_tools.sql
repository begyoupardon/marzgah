ALTER TABLE `reseller_profiles` ADD `max_users` integer;--> statement-breakpoint
ALTER TABLE `reseller_profiles` ADD `max_total_gb` integer;--> statement-breakpoint
ALTER TABLE `vpn_users` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `vpn_users` ADD `contact_telegram` text;--> statement-breakpoint
ALTER TABLE `vpn_users` ADD `labels` text;--> statement-breakpoint
ALTER TABLE `vpn_users` ADD `suspended_at` integer;