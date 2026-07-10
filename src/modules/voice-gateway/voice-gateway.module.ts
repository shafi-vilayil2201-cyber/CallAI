import { Module } from '@nestjs/common';
import { VoiceGateway } from './voice.gateway';
import { ConversationEngineModule } from '../conversation-engine/conversation-engine.module';

@Module({
  imports: [ConversationEngineModule],
  providers: [VoiceGateway],
  exports: [VoiceGateway],
})
export class VoiceGatewayModule {}
