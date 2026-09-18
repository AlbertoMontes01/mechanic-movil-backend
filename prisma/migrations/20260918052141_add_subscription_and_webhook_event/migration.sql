-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_checkout',
    "lemonsqueezyCustomerId" TEXT,
    "lemonsqueezySubscriptionId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "renewsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "cardBrand" TEXT,
    "cardLastFour" TEXT,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "mechanicId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_mechanicId_key" ON "subscriptions"("mechanicId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_lemonsqueezySubscriptionId_key" ON "subscriptions"("lemonsqueezySubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");

-- CreateIndex
CREATE INDEX "webhook_events_mechanicId_idx" ON "webhook_events"("mechanicId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

