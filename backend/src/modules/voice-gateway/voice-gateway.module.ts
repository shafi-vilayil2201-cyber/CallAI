import { Module } from '@nestjs/common';
import { VoiceGateway } from './voice.gateway';
import { TwilioMediaStreamService } from './twilio-media-stream.service';
import { ConversationEngineModule } from '../conversation-engine/conversation-engine.module';

@Module({
  imports: [ConversationEngineModule],
  providers: [VoiceGateway, TwilioMediaStreamService],
  exports: [VoiceGateway, TwilioMediaStreamService],
})
export class VoiceGatewayModule {}
