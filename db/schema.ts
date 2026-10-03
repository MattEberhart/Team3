import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  kind: text('kind', { enum: ['donor','community_kitchen','pantry','mutual_aid'] }).notNull(),
  verificationStatus: text('verification_status', { enum: ['unverified','pending','verified'] }).notNull().default('unverified'),
  approximateArea: text('approximate_area').notNull(), address: text('address').notNull(),
  latitude: real('latitude').notNull(), longitude: real('longitude').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, table => [index('idx_organizations_kind').on(table.kind)]);

export const organizationMembers = sqliteTable('organization_members', {
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), role: text('role', { enum: ['owner','manager','pickup_member'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, table => [uniqueIndex('idx_members_org_user').on(table.organizationId, table.userId)]);

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey(), donorOrganizationId: text('donor_organization_id').notNull().references(() => organizations.id),
  title: text('title').notNull(), description: text('description').notNull(),
  category: text('category', { enum: ['prepared_meal','ingredient','produce','bakery','packaged'] }).notNull(),
  readiness: text('readiness', { enum: ['ready_to_eat','reheating_required','cooking_required'] }).notNull(),
  initialQuantity: real('initial_quantity').notNull(), availableQuantity: real('available_quantity').notNull(),
  unit: text('unit', { enum: ['meal','item','box','pound'] }).notNull(), individualLimit: real('individual_limit'),
  eligibility: text('eligibility', { enum: ['individuals','organizations','both'] }).notNull().default('both'),
  status: text('status', { enum: ['active','completed','expired','cancelled'] }).notNull().default('active'),
  pickupStart: integer('pickup_start', { mode: 'timestamp' }).notNull(), pickupEnd: integer('pickup_end', { mode: 'timestamp' }).notNull(),
  storageRequirement: text('storage_requirement').notNull().default('unknown'),
  allergenStatement: text('allergen_statement').notNull().default('unknown'), photoKey: text('photo_key'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, table => [index('idx_listings_active_pickup').on(table.status, table.pickupEnd), index('idx_listings_donor').on(table.donorOrganizationId)]);

export const reservations = sqliteTable('reservations', {
  id: text('id').primaryKey(), listingId: text('listing_id').notNull().references(() => listings.id),
  recipientUserId: text('recipient_user_id').notNull(), recipientOrganizationId: text('recipient_organization_id').references(() => organizations.id),
  quantity: real('quantity').notNull(), status: text('status', { enum: ['active','collected','cancelled','expired','no_show'] }).notNull().default('active'),
  pickupCodeHash: text('pickup_code_hash').notNull(), reservedAt: integer('reserved_at', { mode: 'timestamp' }).notNull(),
  collectedAt: integer('collected_at', { mode: 'timestamp' }), cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
}, table => [index('idx_reservations_listing_status').on(table.listingId, table.status), index('idx_reservations_recipient').on(table.recipientUserId, table.status)]);

export const impactEvents = sqliteTable('impact_events', {
  id: text('id').primaryKey(), listingId: text('listing_id').notNull().references(() => listings.id),
  reservationId: text('reservation_id').notNull().references(() => reservations.id), quantity: real('quantity').notNull(),
  unit: text('unit').notNull(), eventType: text('event_type', { enum: ['collected','reversed'] }).notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
}, table => [index('idx_impact_occurred_at').on(table.occurredAt)]);
