import {
  pgTable,
  text,
  timestamp,
  date,
  boolean,
  integer,
  serial,
  jsonb,
  unique,
  numeric,
} from "drizzle-orm/pg-core"

// ---- Better Auth tables (camelCase columns to match Better Auth defaults) ----

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  idToken: text("idToken"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// ---- App tables ----

export const packages = pgTable("packages", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  // 'monthly' | 'once-off'
  period: text("period").notNull().default("monthly"),
  tagline: text("tagline").notNull().default(""),
  features: jsonb("features").notNull().default([]),
  description: text("description").notNull().default(""),
  popular: boolean("popular").notNull().default(false),
  published: boolean("published").notNull().default(true),
  // 'standard' | 'custom'
  slotType: text("slotType").notNull().default("standard"),
  sortOrder: integer("sortOrder").notNull().default(0),
  // If true, this package is for school programs — wizard shows school picker instead of club picker
  isSchool: boolean("isSchool").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const clubs = pgTable("clubs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  description: text("description"),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  hours: text("hours").notNull(),
  features: jsonb("features").notNull().default([]),
  image: text("image"),
  imageUrl: text("imageUrl"),
  contactPerson: text("contactPerson"),
  contactEmail: text("contactEmail"),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// ---- Schools ----
export const schools = pgTable("schools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  website: text("website").notNull().default(""),
  description: text("description").notNull().default(""),
  logoUrl: text("logoUrl"),
  contactPerson: text("contactPerson").notNull().default(""),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type School = typeof schools.$inferSelect

export const AGE_GROUPS = ["4-8", "9-13", "14-17"] as const
export type AgeGroup = (typeof AGE_GROUPS)[number]

export const clubSlots = pgTable(
  "club_slots",
  {
    id: serial("id").primaryKey(),
    clubId: integer("clubId").notNull(),
    // 0 = Sunday ... 6 = Saturday
    weekday: integer("weekday").notNull(),
    // Start hour as decimal: 8 = 08:00, 8.5 = 08:30, 13.5 = 13:30 etc.
    hour: numeric("hour", { precision: 4, scale: 1 }).notNull(),
    capacity: integer("capacity").notNull().default(0),
    // Age group this slot is available for
    ageGroup: text("ageGroup").notNull().default("4-8"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => ({
    uniqueSlot: unique("club_slots_unique").on(t.clubId, t.weekday, t.hour, t.ageGroup),
  }),
)

export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  userId: text("userId").notNull(),
  referenceNumber: text("referenceNumber").notNull(),
  // Parent / guardian
  parentName: text("parentName").notNull(),
  parentEmail: text("parentEmail").notNull(),
  parentMobile: text("parentMobile").notNull(),
  // Child
  childName: text("childName").notNull(),
  childDob: text("childDob").notNull(),
  childAge: integer("childAge").notNull(),
  // Program
  packageName: text("packageName").notNull(),
  club: text("club").notNull(),
  clubId: integer("clubId"),
  // School program (null for standard club-based packages)
  schoolId: integer("schoolId"),
  schoolName: text("schoolName"),
  slotWeekday: integer("slotWeekday"),
  slotHour: numeric("slotHour", { precision: 4, scale: 1 }),
  slotAgeGroup: text("slotAgeGroup"),
  // Slot 2 for advanced packages (2 sessions per week on different days)
  slotWeekday2: integer("slotWeekday2"),
  slotHour2: numeric("slotHour2", { precision: 4, scale: 1 }),
  slotAgeGroup2: text("slotAgeGroup2"),
  // True once an admin has manually customized this client's time slot(s) away from the default
  scheduleCustomized: boolean("scheduleCustomized").notNull().default(false),
  // Debit order
  debitAccountHolder: text("debitAccountHolder"),
  debitBankName: text("debitBankName"),
  debitAccountNumber: text("debitAccountNumber"),
  debitAccountType: text("debitAccountType"),
  debitDay: integer("debitDay"),
  // Emergency contact
  emergencyContactName: text("emergencyContactName"),
  emergencyContactPhone: text("emergencyContactPhone"),
  // Terms, consent & signature
  agreedTerms: boolean("agreedTerms").notNull().default(false),
  consentMedia: boolean("consentMedia").notNull().default(false),
  signatureData: text("signatureData"),
  signedName: text("signedName"),
  signedAt: timestamp("signedAt"),
  contractUrl: text("contractUrl"),
  // Communication preferences
  prefEmail: boolean("prefEmail").notNull().default(true),
  prefWhatsapp: boolean("prefWhatsapp").notNull().default(false),
  prefSessionReminders: boolean("prefSessionReminders").notNull().default(true),
  prefAnnouncements: boolean("prefAnnouncements").notNull().default(true),
  prefEvents: boolean("prefEvents").notNull().default(false),
  prefHolidayClinics: boolean("prefHolidayClinics").notNull().default(false),
  // Payment
  // 'monthly' | 'once-off'
  paymentType: text("paymentType").notNull().default("monthly"),
  // 'pending' | 'complete' | 'failed' | 'cancelled'
  paymentStatus: text("paymentStatus").notNull().default("pending"),
  payfastPaymentId: text("payfastPaymentId"),
  // Coach assignment — for slot 1 (slotWeekday/slotHour)
  coachId: integer("coachId"),
  coachName: text("coachName"),
  // Coach assignment for slot 2 (slotWeekday2/slotHour2), when an advanced
  // package's two weekly sessions are split between two different coaches.
  // Falls back to coachId/coachName when null (single coach covers both).
  coachId2: integer("coachId2"),
  coachName2: text("coachName2"),
  // Status
  status: text("status").notNull().default("pending"),
  accountStatus: text("accountStatus").notNull().default("active"),
  onboardingComplete: boolean("onboardingComplete").notNull().default(false),
  // Referral discount — set when a referral voucher is earned, cleared once applied to next payment
  // e.g. 10 means the referrer gets 10% off their next month's debit order
  pendingDiscountPercent: integer("pending_discount_percent").notNull().default(0),
  discountAppliedAt: timestamp("discount_applied_at"),
  // Voucher applied during enrollment (redeemed only after first payment succeeds).
  // FK to vouchers(id) ON DELETE SET NULL — expressed in DB but not in Drizzle
  // schema to avoid a circular reference (vouchers is declared after enrollments).
  pendingVoucherId: integer("pending_voucher_id"),
  // Multi-child cart checkout: all sibling enrollments share the same orderReference.
  // This is the p3 reference sent to Netcash and stored on the orders.netcashOrderId column.
  orderReference: text("orderReference"),
  // Cart items JSON — stored for receipt / admin view, not used for payment logic.
  orderItems: jsonb("orderItems"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const packageSlots = pgTable(
  "package_slots",
  {
    id: serial("id").primaryKey(),
    packageId: integer("packageId").notNull(),
    // 0 = applies to all clubs (legacy / no restriction); any other value = specific club
    clubId: integer("clubId").notNull().default(0),
    weekday: integer("weekday").notNull(),
    // Start hour as decimal: 8 = 08:00, 8.5 = 08:30
    hour: numeric("hour", { precision: 4, scale: 1 }).notNull(),
    capacity: integer("capacity").notNull().default(10),
    // Age group this package slot is available for
    ageGroup: text("ageGroup").notNull().default("4-8"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    uniqueSlot: unique("package_slots_unique").on(t.packageId, t.clubId, t.weekday, t.hour, t.ageGroup),
  }),
)

export type Enrollment = typeof enrollments.$inferSelect
export type Club = typeof clubs.$inferSelect
export type ClubSlot = typeof clubSlots.$inferSelect
export type PackageRow = typeof packages.$inferSelect
export type PackageSlot = typeof packageSlots.$inferSelect

// ---- Site settings (contact details, etc.) ----

export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type SiteSetting = typeof siteSettings.$inferSelect

// ---- Coaches ----

export const coaches = pgTable("coaches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default(""),
  bio: text("bio").notNull().default(""),
  imageUrl: text("imageUrl"),
  sortOrder: integer("sortOrder").notNull().default(0),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  // Coach portal login access — managed via app/actions/coach-auth.ts.
  // These columns already exist on the live coaches table; adding them
  // here keeps Drizzle's schema in sync so getCoaches() can surface the
  // current login email / account status back to the admin UI.
  email: text("email"),
  passwordHash: text("passwordHash"),
  accountStatus: text("accountStatus").notNull().default("active"),
})

export type Coach = typeof coaches.$inferSelect

// ---- Coach ↔ Club assignments ----

export const coachClubs = pgTable(
  "coach_clubs",
  {
    id: serial("id").primaryKey(),
    coachId: integer("coachId")
      .notNull()
      .references(() => coaches.id, { onDelete: "cascade" }),
    clubId: integer("clubId")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
  },
  (t) => ({
    uniqueAssignment: unique("coach_clubs_unique").on(t.coachId, t.clubId),
  }),
)

export type CoachClub = typeof coachClubs.$inferSelect

// ---- Package ↔ Club restrictions ----

export const packageClubs = pgTable(
  "package_clubs",
  {
    id: serial("id").primaryKey(),
    packageId: integer("packageId")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    clubId: integer("clubId")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
  },
  (t) => ({
    uniqueRestriction: unique("package_clubs_unique").on(t.packageId, t.clubId),
  }),
)

export type PackageClub = typeof packageClubs.$inferSelect

// ---- Referral system ----

// One referral profile per user — auto-created on first dashboard visit
export const referralProfiles = pgTable("referral_profiles", {
  id: serial("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  // Short code used in the referral URL, e.g. "AB12C"
  code: text("code").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export type ReferralProfile = typeof referralProfiles.$inferSelect

// Tracks each referral attempt — one row per referred enrollment
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  // The parent who shared the referral link
  referrerId: text("referrerId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  referralCode: text("referralCode").notNull(),
  // The enrollment that used the code
  enrollmentId: integer("enrollmentId").references(() => enrollments.id, { onDelete: "set null" }),
  // 'pending' | 'complete'
  // pending = registered but not yet paid first month; complete = first payment confirmed
  status: text("status").notNull().default("pending"),
  // Set when status becomes 'complete'
  completedAt: timestamp("completedAt"),
  // Voucher issued to referrer after completion
  voucherId: integer("voucherId"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type Referral = typeof referrals.$inferSelect

// ---- Voucher campaigns ----

export const voucherCampaigns = pgTable("voucher_campaigns", {
  id: serial("id").primaryKey(),
  // 'referral' | 'bootcamp' | 'custom'
  type: text("type").notNull().default("custom"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Discount percent (e.g. 20 = 20%)
  discountPercent: integer("discountPercent").notNull().default(20),
  // Which package periods this applies to: 'monthly' | 'once-off' | 'both'
  appliesTo: text("appliesTo").notNull().default("monthly"),
  // Configurable expiry relative to issuance (days); null = no expiry
  expiryDays: integer("expiryDays"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type VoucherCampaign = typeof voucherCampaigns.$inferSelect

// ---- Individual vouchers ----

export const vouchers = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => voucherCampaigns.id, { onDelete: "cascade" }),
  // The parent who owns this voucher
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  discountPercent: integer("discountPercent").notNull(),
  // 'active' | 'used' | 'expired'
  status: text("status").notNull().default("active"),
  // Enrollment this voucher was redeemed against (set on redemption)
  redeemedOnEnrollmentId: integer("redeemedOnEnrollmentId").references(() => enrollments.id, {
    onDelete: "set null",
  }),
  // Referral that triggered this voucher issuance (null for bootcamp vouchers)
  referralId: integer("referralId").references(() => referrals.id, { onDelete: "set null" }),
  expiresAt: timestamp("expiresAt"),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export type Voucher = typeof vouchers.$inferSelect

// ---- Netcash payment tables ----

/**
 * orders — one row per checkout attempt.
 * Created immediately when the parent clicks "Pay" before they leave the site.
 */
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollmentId")
    .notNull()
    .references(() => enrollments.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  packageType: text("packageType").notNull(), // 'once-off' | 'monthly'
  amount: integer("amount").notNull(),         // cents
  currency: text("currency").notNull().default("ZAR"),
  // 'pending' | 'awaiting_payment' | 'paid' | 'failed' | 'refunded' | 'cancelled'
  status: text("status").notNull().default("pending"),
  netcashOrderId: text("netcashOrderId"),       // Netcash-assigned order reference
  netcashCheckoutId: text("netcashCheckoutId"), // Netcash checkout session token
  failureReason: text("failureReason"),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type Order = typeof orders.$inferSelect

/**
 * payments — one row per successful (or failed) payment attempt.
 */
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  enrollmentId: integer("enrollmentId")
    .notNull()
    .references(() => enrollments.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(), // cents
  currency: text("currency").notNull().default("ZAR"),
  provider: text("provider").notNull().default("netcash"),
  // 'pending' | 'awaiting_payment' | 'paid' | 'failed' | 'refunded' | 'cancelled'
  status: text("status").notNull().default("pending"),
  netcashTransactionId: text("netcashTransactionId"),
  netcashSubscriptionRef: text("netcashSubscriptionRef"),
  failureReason: text("failureReason"),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type Payment = typeof payments.$inferSelect

/**
 * subscriptions — one row per active recurring subscription.
 * Only created for monthly packages.
 */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollmentId")
    .notNull()
    .references(() => enrollments.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("netcash"),
  netcashSubscriptionRef: text("netcashSubscriptionRef"), // Netcash recurring token
  // 'active' | 'pending' | 'paused' | 'cancelled' | 'expired' | 'payment_failed'
  status: text("status").notNull().default("pending"),
  billingFrequency: text("billingFrequency").notNull().default("monthly"),
  amount: integer("amount").notNull(), // cents
  currency: text("currency").notNull().default("ZAR"),
  nextBillingDate: timestamp("nextBillingDate"),
  lastPaymentDate: timestamp("lastPaymentDate"),
  failureReason: text("failureReason"),
  cancelledAt: timestamp("cancelledAt"),
  cancelReason: text("cancelReason"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type Subscription = typeof subscriptions.$inferSelect

/**
 * subscription_months — one row per enrollment per billing month.
 * Tracks the payment status of every monthly period for a given enrollment.
 * Idempotently generated: generating the same year+month twice is a no-op
 * (unique constraint on enrollmentId+year+month).
 */
export const subscriptionMonths = pgTable(
  "subscription_months",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollmentId")
      .notNull()
      .references(() => enrollments.id, { onDelete: "cascade" }),
    // Calendar year, e.g. 2026
    year: integer("year").notNull(),
    // Calendar month 1–12
    month: integer("month").notNull(),
    // Amount due in cents (copied from package price at generation time)
    amountCents: integer("amountCents").notNull().default(0),
    // 'outstanding' | 'paid' | 'partial'
    status: text("status").notNull().default("outstanding"),
    // Discount percentage applied to this month (0–100)
    discountPct: integer("discountPct").notNull().default(0),
    // Human-readable reason for the discount, e.g. "Sibling discount", "Bursary"
    discountReason: text("discountReason"),
    // For partial payments: amount actually received in cents
    paidCents: integer("paidCents"),
    // Netcash/payment reference that settled this month (if any)
    paymentReference: text("paymentReference"),
    // Notes added by admin
    notes: text("notes"),
    // When the status was last changed
    paidAt: timestamp("paidAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => ({
    uniqueMonth: unique("subscription_months_unique").on(t.enrollmentId, t.year, t.month),
  }),
)

export type SubscriptionMonth = typeof subscriptionMonths.$inferSelect

/**
 * payment_events — immutable audit log; one row per significant event.
 */
export const paymentEvents = pgTable("payment_events", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").references(() => orders.id, { onDelete: "set null" }),
  paymentId: integer("paymentId").references(() => payments.id, { onDelete: "set null" }),
  subscriptionId: integer("subscriptionId").references(() => subscriptions.id, { onDelete: "set null" }),
  enrollmentId: integer("enrollmentId").references(() => enrollments.id, { onDelete: "set null" }),
  eventType: text("eventType").notNull(), // 'order_created' | 'payment_complete' | 'payment_failed' | 'subscription_created' | 'subscription_cancelled' | etc.
  payload: jsonb("payload"),              // raw data for the event
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export type PaymentEvent = typeof paymentEvents.$inferSelect

/**
 * webhook_logs — raw incoming webhook bodies for auditing.
 */
export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("netcash"),
  eventType: text("eventType"),
  rawBody: text("rawBody").notNull(),
  headers: jsonb("headers"),
  processed: boolean("processed").notNull().default(false),
  processingError: text("processingError"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export type WebhookLog = typeof webhookLogs.$inferSelect

// ---- Impersonation audit log ----

export const impersonationLog = pgTable("impersonation_log", {
  id: serial("id").primaryKey(),
  adminUser: text("admin_user").notNull(),
  parentId: text("parent_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  parentEmail: text("parent_email").notNull(),
  reason: text("reason"),
  // 'view-only' | 'full'
  mode: text("mode").notNull().default("view-only"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
})

export type ImpersonationLog = typeof impersonationLog.$inferSelect

// ---- Next Gen Moments (gallery) ----

export const moments = pgTable("moments", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  caption: text("caption"),
  mediaUrl: text("media_url").notNull(),
  // 'image' | 'video'
  mediaType: text("media_type").notNull().default("image"),
  thumbnailUrl: text("thumbnail_url"),
  // 'general' | 'clubs' | 'schools' | 'tournaments'
  category: text("category").notNull().default("general"),
  published: boolean("published").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export type Moment = typeof moments.$inferSelect

// ---- Site Images (admin-managed images for Home and About pages) ----

export const siteImages = pgTable("site_images", {
  id: serial("id").primaryKey(),
  // Stable key that the page code references, e.g. 'hero-kids'
  imageKey: text("image_key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  // Null means "use the local /images/<key>.png fallback"
  blobUrl: text("blob_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export type SiteImage = typeof siteImages.$inferSelect

// ---- Session Attendance (coaching portal) ----

/**
 * session_attendance — one row per child per session date.
 * status: 'present' | 'absent' | 'excused'
 * A record exists once the coach marks the session (no record = not yet marked).
 */
export const sessionAttendance = pgTable("session_attendance", {
  id: serial("id").primaryKey(),
  coachId: integer("coachId")
    .notNull()
    .references(() => coaches.id, { onDelete: "cascade" }),
  enrollmentId: integer("enrollmentId")
    .notNull()
    .references(() => enrollments.id, { onDelete: "cascade" }),
  // Stored as DATE in Postgres — Drizzle date() returns a "YYYY-MM-DD" string directly
  sessionDate: date("sessionDate").notNull(),
  // 'present' | 'absent' | 'excused'
  status: text("status").notNull().default("present"),
  note: text("note"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export type SessionAttendance = typeof sessionAttendance.$inferSelect
