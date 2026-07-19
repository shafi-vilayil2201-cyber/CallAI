import { Test, TestingModule } from '@nestjs/testing';
import { TwilioProvider } from './twilio.provider';
import { ConfigService } from '@nestjs/config';
import { StructuredLogger } from '../../../common/logger/logger.service';

describe('TwilioProvider', () => {
  let provider: TwilioProvider;
  let configService: ConfigService;
  let originalFetch: any;

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
      switch (key) {
        case 'TWILIO_ACCOUNT_SID': return 'AC_test_sid';
        case 'TWILIO_AUTH_TOKEN': return 'test_auth_token';
        case 'TWILIO_NUMBER': return '+1234567890';
        case 'API_PUBLIC_URL': return 'https://test-api.callai.com';
        default: return defaultValue;
      }
    }),
  };

  const mockLogger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioProvider,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    provider = module.get<TwilioProvider>(TwilioProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should call Twilio initiate call endpoint and parse response', async () => {
    const mockResponse = {
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ sid: 'CA_test_call_sid', status: 'queued' }),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const dto = {
      callerNumber: '+1234567890',
      receiverNumber: '+1987654321',
      assistantId: 'asst_123',
      organizationId: 'org_123',
    };

    const result = await provider.initiateCall(dto);

    expect(result).toEqual({
      providerCallId: 'CA_test_call_sid',
      status: 'queued',
    });

    const expectedAuth = Buffer.from('AC_test_sid:test_auth_token').toString('base64');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Calls.json',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Basic ${expectedAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: expect.any(URLSearchParams),
      })
    );
  });

  it('should call Twilio hangup call endpoint', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    await provider.hangupCall('CA_test_call_sid');

    const expectedAuth = Buffer.from('AC_test_sid:test_auth_token').toString('base64');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Calls/CA_test_call_sid.json',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': `Basic ${expectedAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: expect.any(URLSearchParams),
      })
    );
  });
});
