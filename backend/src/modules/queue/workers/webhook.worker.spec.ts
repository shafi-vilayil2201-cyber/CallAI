import { Test, TestingModule } from '@nestjs/testing';
import { WebhookWorker } from './webhook.worker';
import { StructuredLogger } from '../../../common/logger/logger.service';
import * as crypto from 'crypto';

describe('WebhookWorker', () => {
  let worker: WebhookWorker;
  let originalFetch: any;

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
        WebhookWorker,
        { provide: StructuredLogger, useValue: mockLogger },
      ],
    }).compile();

    worker = module.get<WebhookWorker>(WebhookWorker);
  });

  it('should be defined', () => {
    expect(worker).toBeDefined();
  });

  it('should sign payload and call fetch successfully', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('OK'),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const mockJob: any = {
      id: 'job_webhook',
      data: {
        webhookId: 'webhook_123',
        url: 'https://webhook.site/endpoint',
        secret: 'super_secret',
        event: {
          type: 'CallStarted',
          callSessionId: 'session_abc',
          organizationId: 'org_abc',
          payload: { text: 'hello' },
        },
      },
    };

    const result = await worker.process(mockJob);

    expect(result).toEqual({ success: true, status: 200 });

    // Compute expected signature
    const payloadString = JSON.stringify(mockJob.data.event);
    const expectedSignature = crypto
      .createHmac('sha256', 'super_secret')
      .update(payloadString)
      .digest('hex');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://webhook.site/endpoint',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CallAI-Signature': expectedSignature,
          'User-Agent': 'CallAI-Webhook-Dispatcher/1.0',
        },
        body: payloadString,
      })
    );
  });

  it('should throw an error if the fetch call fails with non-2xx status code', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

    const mockJob: any = {
      id: 'job_webhook_fail',
      data: {
        webhookId: 'webhook_123',
        url: 'https://webhook.site/endpoint',
        secret: 'super_secret',
        event: { type: 'CallEnded', callSessionId: 'session_abc' },
      },
    };

    await expect(worker.process(mockJob)).rejects.toThrow(
      'Webhook target responded with status 500: Internal Server Error'
    );
  });
});
