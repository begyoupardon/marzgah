CREATE TABLE `telegram_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`flow` text NOT NULL,
	`step_index` integer NOT NULL,
	`data_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `telegram_bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telegram_flows_due_idx` ON `telegram_flows` (`expires_at`);