import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from '../../common/observability/observability.service';
import { StructuredLogger } from '../../common/logger/logger.service';
import Redis from 'ioredis';

export interface ExtractedFact {
  key: string;
  value: string;
}

@Injectable()
export class MemoryService implements OnModuleInit, OnModuleDestroy {
  private redisClient!: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly observability: ObservabilityService,
    private readonly logger: StructuredLogger
  ) {
    this.logger.setContext('MemoryService');
  }

  onModuleInit() {
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
    });
    this.logger.log('Redis client for Memory Service connected successfully.');
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }

  /**
   * Normalizes raw phone numbers to E.164 standard.
   */
  normalizePhoneNumber(raw: string): string {
    let clean = raw.replace(/[^\d+]/g, '');
    if (clean.startsWith('0') && !clean.startsWith('+')) {
      clean = '+91' + clean.slice(1); // default India context
    } else if (!clean.startsWith('+')) {
      clean = '+' + clean;
    }
    return clean;
  }

  /**
   * Filters out junk/unwanted memory blocks and prevents sensitive data leaks (OTPs, PINs, passwords).
   */
  shouldStoreMemory(key: string, value: string): boolean {
    const blockedKeys = ['otp', 'password', 'credit_card', 'pin', 'cvv', 'card_number', 'ssn', 'secret'];
    const normalizedKey = key.toLowerCase().trim();
    if (blockedKeys.some(blocked => normalizedKey.includes(blocked))) return false;
    if (value.trim().length < 3) return false;
    return true;
  }

  /**
   * Fetches user context by phone number, checking Redis first before falling back to PostgreSQL.
   */
  async loadUserContext(phoneNumber: string): Promise<{ id: string; phoneNumber: string; name: string | null; preferences: any; memories: { key: string; value: string }[] }> {
    const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
    const cacheKey = `memory:user:${normalizedNumber}`;

    try {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT for caller: ${normalizedNumber}`);
        this.observability.recordMemoryHit();
        return JSON.parse(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Redis fetch failed for ${normalizedNumber}: ${err.message}`);
    }

    this.logger.debug(`Cache MISS for caller: ${normalizedNumber}. Fetching from DB...`);
    this.observability.recordMemoryMiss();

    // 1. Get or create Caller
    const caller = await this.prisma.caller.upsert({
      where: { phoneNumber: normalizedNumber },
      update: {},
      create: { phoneNumber: normalizedNumber },
    });

    // 2. Fetch associated memories sorted by priority (weight desc, recency desc)
    const dbMemories = await this.prisma.callerMemory.findMany({
      where: { callerId: caller.id },
      orderBy: [
        { weight: 'desc' },
        { lastUsed: 'desc' },
      ],
      take: 10,
    });

    const result = {
      id: caller.id,
      phoneNumber: caller.phoneNumber,
      name: caller.name,
      preferences: caller.preferences || {},
      memories: dbMemories.map(m => ({ key: m.key, value: m.value })),
    };

    // 3. Populate Redis cache (15 min TTL)
    try {
      await this.redisClient.set(cacheKey, JSON.stringify(result), 'EX', 900);
    } catch (err: any) {
      this.logger.warn(`Redis save failed for ${normalizedNumber}: ${err.message}`);
    }

    return result;
  }

  /**
   * Helper to fetch historic summaries for compatibility with the conversation engine.
   */
  async retrieveLongTermContext(organizationId: string, callerNumber: string): Promise<string> {
    const normalized = this.normalizePhoneNumber(callerNumber);
    const context = await this.loadUserContext(normalized);
    if (!context.memories || context.memories.length === 0) {
      return '';
    }
    return context.memories.map(m => `${m.key}: ${m.value}`).join('\n');
  }

  /**
   * Calls the Gemini API to extract structured facts/preferences from the conversation transcript.
   */
  async extractMemory(transcript: string): Promise<ExtractedFact[]> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('Skipping memory extraction: GEMINI_API_KEY is not defined.');
      return [];
    }

    if (!transcript || transcript.trim().length < 10) {
      return [];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const prompt = `Analyze the following voice call transcript. Extract key personalization facts about the caller (e.g., name, preferences, favorite things, repeated habits, dietary restrictions, general background info).
Do NOT extract sensitive financial details, passwords, credit card numbers, or temporary OTPs.
Respond with a JSON array where each item is an object with "key" and "value" fields. Use lowercase letters and underscores for keys (e.g., "name", "favorite_food", "prefers_email").

Transcript:
"""
${transcript}
"""`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  key: { type: 'STRING' },
                  value: { type: 'STRING' },
                },
                required: ['key', 'value'],
              },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini API returned status ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return [];
      }

      const extracted: ExtractedFact[] = JSON.parse(text);
      this.logger.log(`Gemini Extracted ${extracted.length} raw memory facts.`);
      return extracted;
    } catch (err: any) {
      this.logger.error(`Failed to extract memories via Gemini API: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Persists extracted facts/memories to PostgreSQL, increments weights for recurring keys, and updates names.
   */
  async storeMemory(callerId: string, memories: ExtractedFact[]): Promise<void> {
    const validMemories = memories.filter(m => this.shouldStoreMemory(m.key, m.value));
    if (validMemories.length === 0) return;

    this.logger.log(`Storing ${validMemories.length} memories for caller ID: ${callerId}`);

    for (const m of validMemories) {
      await this.prisma.$transaction(async (tx) => {
        // Upsert the specific CallerMemory key-value pair
        const existing = await tx.callerMemory.findUnique({
          where: {
            callerId_key: {
              callerId,
              key: m.key,
            },
          },
        });

        if (existing) {
          // If value is unchanged, increment weight slightly. Otherwise, update value.
          const weightIncrement = existing.value === m.value ? 0.2 : 0.0;
          await tx.callerMemory.update({
            where: { id: existing.id },
            data: {
              value: m.value,
              lastUsed: new Date(),
              weight: existing.weight + weightIncrement,
            },
          });
        } else {
          await tx.callerMemory.create({
            data: {
              callerId,
              key: m.key,
              value: m.value,
              weight: 1.0,
            },
          });
        }

        // If the key is 'name', update the parent caller name directly
        if (m.key.toLowerCase().trim() === 'name') {
          await tx.caller.update({
            where: { id: callerId },
            data: { name: m.value },
          });
        }
      });
    }

    this.observability.recordMemoriesExtracted(validMemories.length);
  }

  /**
   * Analyzes a completed call transcript, extracts structured memory facts, persists logs, and evicts cache.
   */
  async generateAndSaveSessionSummary(callSessionId: string): Promise<void> {
    this.logger.log(`Running post-call memory extraction pipeline for session: ${callSessionId}`);

    // 1. Fetch the call session
    const callSession = await this.prisma.callSession.findUnique({
      where: { id: callSessionId },
    });
    if (!callSession) {
      this.logger.warn(`Call session ${callSessionId} not found.`);
      return;
    }

    // 2. Fetch the caller
    const normalizedNumber = this.normalizePhoneNumber(callSession.callerNumber);
    const caller = await this.prisma.caller.findUnique({
      where: { phoneNumber: normalizedNumber },
    });
    if (!caller) {
      this.logger.warn(`Caller profile for ${normalizedNumber} not found.`);
      return;
    }

    // 3. Compile transcript
    const messages = await this.prisma.conversationMessage.findMany({
      where: { callSessionId },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length === 0) {
      this.logger.debug('Call session contains no conversational turns. Skipping memory.');
      return;
    }

    const transcript = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // 4. Check if caller opted out of memory storage
    const preferences: any = caller.preferences || {};
    if (preferences.memoryDisabled === true) {
      this.logger.log(`Opt-out memory flag detected for caller ${normalizedNumber}. Skipping memory extraction.`);
      return;
    }

    // 5. Extract structured memory facts
    const facts = await this.extractMemory(transcript);
    if (facts.length > 0) {
      await this.storeMemory(caller.id, facts);
    }

    // 6. Save CallerCallLog summary
    const summaryText = `Call on ${new Date().toDateString()}. Total turns: ${messages.length}. Facts extracted: ${facts.length}`;
    await this.prisma.callerCallLog.create({
      data: {
        callerId: caller.id,
        summary: summaryText,
      },
    });

    // 7. Evict Redis cache to invalidate stale record
    const cacheKey = `memory:user:${normalizedNumber}`;
    try {
      await this.redisClient.del(cacheKey);
      this.logger.debug(`Evicted memory cache for caller: ${normalizedNumber}`);
    } catch (err: any) {
      this.logger.warn(`Failed to evict cache key ${cacheKey}: ${err.message}`);
    }
  }
}

