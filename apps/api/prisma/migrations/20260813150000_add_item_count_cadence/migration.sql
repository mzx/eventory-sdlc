-- Count cadence + opportunistic verification (EVT-27). `countIntervalDays`
-- null = not on a count schedule (never appears on the verification queue).
-- `lastVerifiedAt` null = never explicitly counted.
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "countIntervalDays" INTEGER,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3);
