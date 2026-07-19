import * as Joi from 'joi';

/**
 * Joi validation schema for environment variables.
 * Used with ConfigModule.forRoot({ validationSchema }) to validate
 * all required env vars at application startup.
 *
 * - Required vars will cause startup failure if missing
 * - Optional vars have sensible defaults
 */
export const envValidationSchema = Joi.object({
  // Server
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  API_PUBLIC_URL: Joi.string().default('http://localhost:3000'),

  // Security (required in production)
  JWT_SECRET: Joi.string()
    .min(16)
    .required()
    .messages({
      'string.min': 'JWT_SECRET must be at least 16 characters for security',
      'any.required': 'JWT_SECRET is required. Set it in your .env file.',
    }),
  JWT_EXPIRATION: Joi.string().default('24h'),
  VOICE_GATEWAY_TOKEN: Joi.string().optional().allow(''),

  // Database (required)
  DATABASE_URL: Joi.string()
    .required()
    .messages({
      'any.required': 'DATABASE_URL is required. Example: postgresql://user:pass@localhost:5432/callai',
    }),

  // Redis (required for BullMQ queues)
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),

  // OpenAI (optional — warns if missing)
  OPENAI_API_KEY: Joi.string().optional().allow(''),

  // Telephony — Exotel (optional)
  EXOTEL_API_KEY: Joi.string().optional().allow(''),
  EXOTEL_API_TOKEN: Joi.string().optional().allow(''),
  EXOTEL_ACCOUNT_SID: Joi.string().optional().allow(''),
  EXOTEL_SUBDOMAIN: Joi.string().default('api.exotel.com'),
  EXOTEL_CALLER_ID: Joi.string().optional().allow(''),

  // Telephony — Twilio (optional)
  TWILIO_ACCOUNT_SID: Joi.string().optional().allow(''),
  TWILIO_AUTH_TOKEN: Joi.string().optional().allow(''),
  TWILIO_NUMBER: Joi.string().optional().allow(''),

  // AWS S3 (optional)
  AWS_REGION: Joi.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: Joi.string().optional().allow(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
  AWS_S3_RECORDINGS_BUCKET: Joi.string().default('call-ai-recordings'),

  // Latency-Aware Intelligence Layer
  ENABLE_LATENCY_LAYER: Joi.boolean().default(false),
  LATENCY_THRESHOLD_FULL_MS: Joi.number().integer().min(0).default(400),
  LATENCY_THRESHOLD_SHORT_MS: Joi.number().integer().min(0).default(800),
  LATENCY_SPIKE_MULTIPLIER: Joi.number().min(1).default(2.0),
  LATENCY_SPIKE_MIN_AVG_MS: Joi.number().integer().min(0).default(200),
  LATENCY_FILLER_COOLDOWN_MS: Joi.number().integer().min(0).default(3000),
});
