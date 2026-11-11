import {
  type DeviceListResponse,
  type RegisterDeviceRequest,
  registerDeviceRequestSchema,
  type RegisterDeviceResponse,
} from '@campuswatch/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/principal.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DevicesService } from './devices.service.js';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('register')
  @HttpCode(201)
  register(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(registerDeviceRequestSchema)) body: RegisterDeviceRequest,
  ): Promise<RegisterDeviceResponse> {
    return this.devices.register(userId, body);
  }

  @Get()
  async list(@CurrentUserId() userId: string): Promise<DeviceListResponse> {
    return { devices: await this.devices.list(userId) };
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) deviceId: string,
  ): Promise<void> {
    return this.devices.revoke(userId, deviceId);
  }
}
