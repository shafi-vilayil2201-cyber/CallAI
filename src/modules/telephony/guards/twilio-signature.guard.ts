import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger('TwilioSignatureGuard');

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-twilio-signature'];

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const nodeEnv = process.env.NODE_ENV;

    // Skip validation if auth token is missing in development. Require it in production.
    if (!authToken) {
      if (nodeEnv === 'production') {
        this.logger.error('Twilio validation failed: TWILIO_AUTH_TOKEN is not configured in production environment.');
        return false;
      }
      this.logger.warn('Skipping Twilio signature validation (TWILIO_AUTH_TOKEN is not configured).');
      return true;
    }

    if (!signature) {
      this.logger.warn('Twilio signature validation failed: Missing X-Twilio-Signature header.');
      return false;
    }

    // Reconstruct request URL taking reverse proxies (ngrok/load balancers) into account
    const protocol = request.headers['x-forwarded-proto'] || request.protocol;
    const host = request.headers['x-forwarded-host'] || request.headers.host;
    const url = `${protocol}://${host}${request.originalUrl}`;

    // Sort parameters alphabetically
    const params = request.body || {};
    const sortedKeys = Object.keys(params).sort();

    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    const hmac = crypto.createHmac('sha1', authToken);
    hmac.update(data);
    const hash = hmac.digest('base64');

    const isValid = hash === signature;

    if (!isValid) {
      this.logger.warn(`Twilio signature mismatch. Expected: ${hash}, Received: ${signature}`);
    } else {
      this.logger.log('Twilio request signature verified successfully.');
    }

    return isValid;
  }
}
