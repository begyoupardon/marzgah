CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_due_idx` ON `notifications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE TABLE `telegram_link_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`linked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_chat_id_unique` ON `telegram_links` (`chat_id`);