-- EVT-42: workspaces & memberships API — invitations.
--
-- Adds `WorkspaceInvite` (single-use, expiring, SHA-256-hashed token) so an
-- owner can invite a household member at a chosen `WorkspaceRole`
-- (`member`/`viewer` only — see `CreateInviteDto`'s validation, never
-- `owner`). No backfill: this is a brand-new, empty table — EVT-42 also
-- removes the runtime `ensureDefaultWorkspaceMembership` self-heal
-- (apps/api/src/workspace/default-workspace.ts) in favor of explicit
-- self-service workspace creation / invite redemption, but that is an
-- application-code change with no schema impact.

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'redeemed', 'revoked');

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "redeemedById" UUID,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_status_idx" ON "WorkspaceInvite"("status");

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
