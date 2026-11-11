import type { Device, RegisterDeviceRequest, RegisterDeviceResponse } from '@campuswatch/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/opaque-token.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { devices } from '../database/schema.js';

type DeviceRow = typeof devices.$inferSelect;

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    extensionVersion: row.extensionVersion,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

/** Every method takes the owner's id from the verified token and scopes all queries by it. */
@Injectable()
export class DevicesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async register(userId: string, input: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    const deviceToken = generateOpaqueToken('cwd');
    const [row] = await this.db
      .insert(devices)
      .values({
        userId,
        name: input.name,
        extensionVersion: input.extensionVersion,
        tokenHash: hashOpaqueToken(deviceToken),
      })
      .returning();
    if (!row) {
      throw new Error('Device insert returned no row');
    }
    return { device: toDevice(row), deviceToken };
  }

  async list(userId: string): Promise<Device[]> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .orderBy(asc(devices.createdAt));
    return rows.map(toDevice);
  }

  /** Revokes a device; its token stops working immediately. */
  async revoke(userId: string, deviceId: string): Promise<void> {
    const revoked = await this.db
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
      .returning({ id: devices.id });
    if (revoked.length === 0) {
      // Same response for "missing" and "owned by someone else": no existence leak.
      throw new NotFoundException('Device not found');
    }
  }
}
