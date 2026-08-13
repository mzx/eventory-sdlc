-- CreateEnum
CREATE TYPE "ShoppingListEntryStatus" AS ENUM ('open', 'done');

-- CreateEnum
CREATE TYPE "ShoppingListEntrySource" AS ENUM ('manual', 'low-stock');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "minQuantity" INTEGER;

-- CreateTable
CREATE TABLE "ShoppingListEntry" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "status" "ShoppingListEntryStatus" NOT NULL DEFAULT 'open',
    "source" "ShoppingListEntrySource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ShoppingListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShoppingListEntry_itemId_idx" ON "ShoppingListEntry"("itemId");

-- CreateIndex
CREATE INDEX "ShoppingListEntry_status_createdAt_idx" ON "ShoppingListEntry"("status", "createdAt");

-- CreateIndex
-- EVT-26 AC 1: at most one OPEN entry per item. This is a PARTIAL unique
-- index (only applies where status = 'open') so an item can accumulate any
-- number of `done` (resolved) entries over time — Prisma's schema DSL has
-- no `@@unique(..., where:)` syntax, so this is hand-written raw SQL rather
-- than generated from schema.prisma (see the schema-header note). This is
-- what makes StockMovementsService's auto-trigger and the manual "Running
-- low" button idempotent under concurrent/racing writes.
CREATE UNIQUE INDEX "ShoppingListEntry_itemId_open_key" ON "ShoppingListEntry"("itemId") WHERE "status" = 'open';

-- AddForeignKey
ALTER TABLE "ShoppingListEntry" ADD CONSTRAINT "ShoppingListEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
