import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [AppConfig, SupabaseService],
  exports: [AppConfig, SupabaseService],
})
export class CoreModule {}
