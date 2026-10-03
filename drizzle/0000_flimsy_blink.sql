CREATE TABLE `impact_events` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_impact_occurred_at` ON `impact_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`donor_organization_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`readiness` text NOT NULL,
	`initial_quantity` real NOT NULL,
	`available_quantity` real NOT NULL,
	`unit` text NOT NULL,
	`individual_limit` real,
	`eligibility` text DEFAULT 'both' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pickup_start` integer NOT NULL,
	`pickup_end` integer NOT NULL,
	`storage_requirement` text DEFAULT 'unknown' NOT NULL,
	`allergen_statement` text DEFAULT 'unknown' NOT NULL,
	`photo_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`donor_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_listings_active_pickup` ON `listings` (`status`,`pickup_end`);--> statement-breakpoint
CREATE INDEX `idx_listings_donor` ON `listings` (`donor_organization_id`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_org_user` ON `organization_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`approximate_area` text NOT NULL,
	`address` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_organizations_kind` ON `organizations` (`kind`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`recipient_organization_id` text,
	`quantity` real NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pickup_code_hash` text NOT NULL,
	`reserved_at` integer NOT NULL,
	`collected_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reservations_listing_status` ON `reservations` (`listing_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reservations_recipient` ON `reservations` (`recipient_user_id`,`status`);