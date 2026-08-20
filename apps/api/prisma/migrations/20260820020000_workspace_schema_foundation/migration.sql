-- EVT-39: workspace schema foundation (multi-tenancy row-scoping, phase 1
-- of the tenancy ladder — operator decision 2026-08-20: shared-DB row
-- scoping with memberships; Postgres RLS is a later hardening task, EVT-44).
--
-- Adds a non-null `workspaceId` FK (`ON DELETE RESTRICT`) to every domain
-- table — Item, Location, Category, Tag, Project, StockMovement,
-- ShoppingListEntry, Photo. `BomLine` deliberately does NOT get its own
-- column; it inherits scope transitively via its required `Project`
-- relation. Every `ADD COLUMN` below carries `DEFAULT
-- '00000000-0000-0000-0000-000000000001'`, which Postgres applies to every
-- existing row in the same statement (fast path, no separate UPDATE pass
-- needed) — that literal is the fixed, well-known id of the "Default
-- Workspace" row this migration creates below, kept in sync with
-- `DEFAULT_WORKSPACE_ID` in apps/api/src/workspace/default-workspace.ts and
-- every `workspaceId` field's `@default(...)` in schema.prisma (see that
-- file's header note). The default is intentionally left in place (not
-- dropped after backfill) so pre-EVT-40 code paths that create rows without
-- an explicit `workspaceId` keep compiling and behaving exactly as before —
-- per-request tenant context/enforcement is EVT-40's job, not this task's.
--
-- Also re-scopes uniqueness: `Tag.name` and `Location`/`Category.path` move
-- from a bare UNIQUE to UNIQUE(workspaceId, <col>) — two workspaces may now
-- reuse the same tag name / location path. `qrCode` on Item/Location is
-- untouched (stays globally unique — physical QR labels resolve globally,
-- authorization comes in EVT-40). `ShoppingListEntry`'s partial "one open
-- entry per item" unique index is already item-scoped and is untouched.

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'member', 'viewer');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the Default Workspace at a fixed, well-known id (see the header note
-- above for the three places this literal must stay in sync).
INSERT INTO "Workspace" ("id", "name", "createdAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Workspace', CURRENT_TIMESTAMP);

-- Membership backfill: one row per approved user, role derived from their
-- existing UserRole (admin -> owner, user -> member). Pending/rejected
-- users are skipped — they can't reach any authenticated route yet, and the
-- approval flow itself (User.status/.role) is unaffected by this task.
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT uuid_generate_v4(),
       '00000000-0000-0000-0000-000000000001',
       "id",
       CASE WHEN "role" = 'admin' THEN 'owner'::"WorkspaceRole" ELSE 'member'::"WorkspaceRole" END,
       CURRENT_TIMESTAMP
FROM "User"
WHERE "status" = 'approved';

-- AlterTable: Item
ALTER TABLE "Item" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateIndex
CREATE INDEX "Item_workspaceId_idx" ON "Item"("workspaceId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Location (re-scope path uniqueness)
ALTER TABLE "Location" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- DropIndex
DROP INDEX "Location_path_key";

-- CreateIndex
CREATE INDEX "Location_workspaceId_idx" ON "Location"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_workspaceId_path_key" ON "Location"("workspaceId", "path");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Category (re-scope path uniqueness)
ALTER TABLE "Category" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- DropIndex
DROP INDEX "Category_path_key";

-- CreateIndex
CREATE INDEX "Category_workspaceId_idx" ON "Category"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_workspaceId_path_key" ON "Category"("workspaceId", "path");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Tag (re-scope name uniqueness)
ALTER TABLE "Tag" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- DropIndex
DROP INDEX "Tag_name_key";

-- CreateIndex
CREATE INDEX "Tag_workspaceId_idx" ON "Tag"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Project
ALTER TABLE "Project" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: StockMovement
ALTER TABLE "StockMovement" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateIndex
CREATE INDEX "StockMovement_workspaceId_idx" ON "StockMovement"("workspaceId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: ShoppingListEntry
ALTER TABLE "ShoppingListEntry" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateIndex
CREATE INDEX "ShoppingListEntry_workspaceId_idx" ON "ShoppingListEntry"("workspaceId");

-- AddForeignKey
ALTER TABLE "ShoppingListEntry" ADD CONSTRAINT "ShoppingListEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Photo
ALTER TABLE "Photo" ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateIndex
CREATE INDEX "Photo_workspaceId_idx" ON "Photo"("workspaceId");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
