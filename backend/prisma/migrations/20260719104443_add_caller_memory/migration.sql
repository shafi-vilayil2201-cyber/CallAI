-- CreateTable
CREATE TABLE "Caller" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT,
    "preferences" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallerMemory" (
    "id" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallerMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallerCallLog" (
    "id" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallerCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Caller_phoneNumber_key" ON "Caller"("phoneNumber");

-- CreateIndex
CREATE INDEX "CallerMemory_callerId_idx" ON "CallerMemory"("callerId");

-- CreateIndex
CREATE UNIQUE INDEX "CallerMemory_callerId_key_key" ON "CallerMemory"("callerId", "key");

-- CreateIndex
CREATE INDEX "CallerCallLog_callerId_idx" ON "CallerCallLog"("callerId");

-- AddForeignKey
ALTER TABLE "CallerMemory" ADD CONSTRAINT "CallerMemory_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "Caller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallerCallLog" ADD CONSTRAINT "CallerCallLog_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "Caller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
