-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('area', 'container');

-- AlterTable: Location.kind, defaulting every existing row to 'area' (EVT-30 AC 1).
ALTER TABLE "Location" ADD COLUMN "kind" "LocationKind" NOT NULL DEFAULT 'area';

-- CreateIndex
CREATE INDEX "Location_kind_idx" ON "Location"("kind");

-- AlterTable: StockMovement.itemId becomes nullable so an itemless container
-- move (containerId set instead) can be recorded (EVT-30).
ALTER TABLE "StockMovement" ALTER COLUMN "itemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "containerId" UUID;

-- CreateIndex
CREATE INDEX "StockMovement_containerId_createdAt_idx" ON "StockMovement"("containerId", "createdAt");

-- AddForeignKey
-- ON DELETE SET NULL, not CASCADE (EVT-30 review round 2, finding 4): a
-- deleted container must not silently erase its own move-history ledger
-- rows, matching the "immutable audit trail" contract and the SetNull
-- already used for fromLocationId/toLocationId.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
