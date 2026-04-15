-- CreateTable
CREATE TABLE "ExportLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userDisplayName" TEXT NOT NULL,
    "templateName" TEXT,
    "templateId" TEXT,
    "ruleLabelMatched" TEXT,
    "destinationName" TEXT,
    "conflictStrategy" TEXT,
    "finalPath" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "fileSizeBytes" INTEGER,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportLog_createdAt_idx" ON "ExportLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExportLog_userId_idx" ON "ExportLog"("userId");
