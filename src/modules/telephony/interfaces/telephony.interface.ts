export interface CallInitiateDto {
  callerNumber: string;
  receiverNumber: string;
  assistantId: string;
  organizationId: string;
  customData?: Record<string, any>;
}

export interface TelephonyCallInfo {
  providerCallId: string;
  status: string;
  duration?: number;
}

export interface TelephonyProvider {
  /**
   * Triggers an outbound phone call through the telephony gateway
   */
  initiateCall(dto: CallInitiateDto): Promise<TelephonyCallInfo>;

  /**
   * Aborts/Hangs up an active call session
   */
  hangupCall(providerCallId: string): Promise<void>;

  /**
   * Transfers the call to another phone number (e.g. transfer to human support)
   */
  transferCall(providerCallId: string, destinationNumber: string): Promise<void>;

  /**
   * Streams/plays a pre-recorded audio file or IVR prompt to the caller
   */
  playAudio(providerCallId: string, audioUrl: string): Promise<void>;
}
export const TELEPHONY_PROVIDER = Symbol('TelephonyProvider');
