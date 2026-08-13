-- AlterTable: BomLine.picked — kitting pick-list check-off state (EVT-29 AC 3).
-- Informational only (not a stock reservation); defaults every existing line
-- to unpicked.
ALTER TABLE "BomLine" ADD COLUMN     "picked" BOOLEAN NOT NULL DEFAULT false;
