import { z } from 'zod';

export const NOTIFICATION_CATEGORIES = [
  'grades',
  'tuition',
  'timetable',
  'exams',
  'notices',
] as const;

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const NOTIFICATION_CHANNELS = ['chrome', 'telegram'] as const;

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** `summary` never includes scores, amounts, or course names; `detailed` is opt-in. */
export const detailLevelSchema = z.enum(['summary', 'detailed']);

export type DetailLevel = z.infer<typeof detailLevelSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

const categoryToggles = z.strictObject({
  grades: z.boolean(),
  tuition: z.boolean(),
  timetable: z.boolean(),
  exams: z.boolean(),
  notices: z.boolean(),
});

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const notificationPreferencesSchema = z.strictObject({
  channels: z.strictObject({
    chrome: categoryToggles,
    telegram: categoryToggles,
  }),
  /** IANA time zone used for quiet hours. */
  timezone: z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone'),
  /** Non-urgent notifications wait until `end`. `null` disables quiet hours. */
  quietHours: z.strictObject({ start: hhmm, end: hhmm }).nullable(),
  detailLevel: z.strictObject({
    chrome: detailLevelSchema,
    telegram: detailLevelSchema,
  }),
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    chrome: { grades: true, tuition: true, timetable: true, exams: true, notices: true },
    telegram: { grades: true, tuition: true, timetable: true, exams: true, notices: true },
  },
  timezone: 'Asia/Ho_Chi_Minh',
  quietHours: null,
  detailLevel: { chrome: 'summary', telegram: 'summary' },
};

export const renderedNotificationSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export type RenderedNotification = z.infer<typeof renderedNotificationSchema>;

/** `GET /notifications/pending` (device token): due Chrome notifications, claimed for 5 minutes. */
export const pendingNotificationsResponseSchema = z.object({
  /** One rendered notification for the whole batch, or `null` when nothing is due. */
  notification: renderedNotificationSchema.nullable(),
  deliveryIds: z.array(z.uuid()),
});

export type PendingNotificationsResponse = z.infer<typeof pendingNotificationsResponseSchema>;

export const ackNotificationsRequestSchema = z.strictObject({
  deliveryIds: z.array(z.uuid()).min(1).max(500),
});

export type AckNotificationsRequest = z.infer<typeof ackNotificationsRequestSchema>;

export const DELIVERY_STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'] as const;

export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);

export const deliverySchema = z.object({
  id: z.uuid(),
  changeEventId: z.uuid(),
  channel: notificationChannelSchema,
  category: notificationCategorySchema,
  status: deliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  deliverAfter: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type Delivery = z.infer<typeof deliverySchema>;

export const deliveryListResponseSchema = z.object({ deliveries: z.array(deliverySchema) });

export type DeliveryListResponse = z.infer<typeof deliveryListResponseSchema>;

export const telegramLinkStatusSchema = z.object({
  /** False when this deployment has no Telegram bot configured. */
  available: z.boolean(),
  linked: z.boolean(),
  linkedAt: z.iso.datetime().nullable(),
});

export type TelegramLinkStatus = z.infer<typeof telegramLinkStatusSchema>;

export const telegramLinkStartResponseSchema = z.object({
  /** Opens the bot with a one-time code; never contains a token or chat id. */
  deepLink: z.url(),
  expiresAt: z.iso.datetime(),
});

export type TelegramLinkStartResponse = z.infer<typeof telegramLinkStartResponseSchema>;
