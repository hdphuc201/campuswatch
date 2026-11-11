import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiConfig } from './config.js';

export const API_CONFIG = Symbol('API_CONFIG');

@Global()
@Module({})
export class ApiConfigModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ApiConfigModule,
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}
