ALTER TABLE `reseller_profiles` ADD COLUMN `username_suffix` text;
--> statement-breakpoint
ALTER TABLE `reseller_profiles` ADD COLUMN `price_per_gb_toman` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `reseller_profiles`
SET `username_suffix` = 'r' || lower(hex(randomblob(3)))
WHERE `username_suffix` IS NULL OR `username_suffix` = '';
--> statement-breakpoint
CREATE UNIQUE INDEX `reseller_profiles_username_suffix_unique` ON `reseller_profiles` (`username_suffix`);
