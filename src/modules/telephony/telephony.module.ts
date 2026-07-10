import { Module } from '@nestjs/common';
import { TelephonyController } from './telephony.controller';
import { TelephonyService } from './telephony.service';
import { ExotelProvider } from './providers/exotel.provider';
import { TwilioProvider } from './providers/twilio.provider';
import { TELEPHONY_PROVIDER } from './interfaces/telephony.interface';

@Module({
  controllers: [TelephonyController],
  providers: [
    ExotelProvider,
    TwilioProvider,
    TelephonyService,
    {
      provide: TELEPHONY_PROVIDER,
      useClass: TelephonyService,
    },
  ],
  exports: [TelephonyService, ExotelProvider, TwilioProvider],
})
export class TelephonyModule {}
