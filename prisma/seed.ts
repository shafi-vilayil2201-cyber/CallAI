import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const API_KEY_PREFIX = 'cai_live_';

async function main() {
  console.log('Seeding CallAI database with default testing tenant, user, and assistant...');

  // 1. Create Organization
  const org = await prisma.organization.create({
    data: {
      name: 'Default Test Org',
    },
  });
  console.log(`  ✓ Organization created: ${org.id}`);

  // 2. Create Org Settings
  await prisma.organizationSettings.create({
    data: {
      organizationId: org.id,
      recordingEnabled: true,
      defaultLanguage: 'en-US',
    },
  });
  console.log('  ✓ Organization settings created');

  // 3. Create Admin User (admin@callai.com / admin123456)
  const defaultPassword = 'admin123456';
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  const user = await prisma.user.create({
    data: {
      email: 'admin@callai.com',
      passwordHash,
      role: 'ADMIN',
      organizationId: org.id,
    },
  });
  console.log(`  ✓ Admin user created: ${user.email} (password: ${defaultPassword})`);

  // 4. Create Default API Key
  const rawApiKey = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

  await prisma.apiKey.create({
    data: {
      name: 'Default Development Key',
      keyHash,
      organizationId: org.id,
      isActive: true,
    },
  });
  console.log(`  ✓ API Key created: ${rawApiKey}`);
  console.log('    ⚠️  Save this key — it cannot be retrieved again!');

  // 5. Create Default AI Provider Config (OpenAI)
  const aiProvider = await prisma.aiProviderConfig.create({
    data: {
      organizationId: org.id,
      providerName: 'openai',
      apiKey: process.env.OPENAI_API_KEY || 'mock-openai-key',
      isDefault: true,
    },
  });
  console.log('  ✓ AI Provider config created (OpenAI)');

  // 6. Create Default Assistant
  const assistant = await prisma.assistant.create({
    data: {
      name: 'Realtime Voice Assistant',
      systemInstruction: 'You are CallAI customer service agent. Speak clearly, concisely, and keep your answers brief. Help the caller book an appointment or process a payment if they request.',
      voiceId: 'alloy',
      model: 'gpt-realtime-2.1',
      language: 'en-US',
      isPublished: true,
      organizationId: org.id,
      aiProviderConfigId: aiProvider.id,
    },
  });
  console.log(`  ✓ Assistant created: ${assistant.name}`);

  // 7. Create Feature Flags
  await prisma.featureFlag.createMany({
    data: [
      {
        name: 'ENABLE_RECORDING',
        description: 'Enable call recording and S3 upload',
        isEnabledGlobally: true,
      },
      {
        name: 'ENABLE_BILLING',
        description: 'Enable cost tracking and billing calculations',
        isEnabledGlobally: true,
      },
      {
        name: 'ENABLE_WEBHOOKS',
        description: 'Enable webhook dispatching for domain events',
        isEnabledGlobally: true,
      },
      {
        name: 'ENABLE_MEMORY',
        description: 'Enable long-term caller memory and context retrieval',
        isEnabledGlobally: true,
      },
    ],
  });
  console.log('  ✓ Feature flags created (4 flags)');

  // 8. Create Billing record
  await prisma.billing.create({
    data: {
      organizationId: org.id,
      balance: 100.00, // $100 starting credits
      currency: 'USD',
    },
  });
  console.log('  ✓ Billing record created ($100 starting balance)');

  // 9. Create Subscription
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      planName: 'STARTER',
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });
  console.log('  ✓ Subscription created (STARTER plan)');

  console.log('\n✅ Seeding completed successfully!');
  console.log('\nLogin credentials:');
  console.log(`  Email:    ${user.email}`);
  console.log(`  Password: ${defaultPassword}`);
  console.log(`  API Key:  ${rawApiKey}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

