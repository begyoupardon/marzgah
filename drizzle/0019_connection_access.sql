CREATE TABLE `access_assignments` (
	`vpn_user_id` text PRIMARY KEY NOT NULL,
	`selection` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`admin_controlled` integer DEFAULT false NOT NULL,
	`operation_id` text,
	`observed` text,
	`applied` text,
	`error` text,
	FOREIGN KEY (`vpn_user_id`) REFERENCES `vpn_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `access_leases` (
	`vpn_user_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`locked_until` integer NOT NULL,
	FOREIGN KEY (`vpn_user_id`) REFERENCES `vpn_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `access_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`backend` text NOT NULL,
	`request` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `access_policies` (
	`backend` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`document` text NOT NULL,
	`operation_id` text
);
--> statement-breakpoint
CREATE TABLE `access_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`vpn_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`locked_until` integer,
	`error` text,
	FOREIGN KEY (`operation_id`) REFERENCES `access_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vpn_user_id`) REFERENCES `vpn_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_tasks_operation_user_idx` ON `access_tasks` (`operation_id`,`vpn_user_id`);--> statement-breakpoint
CREATE INDEX `access_tasks_due_idx` ON `access_tasks` (`status`,`next_attempt_at`);