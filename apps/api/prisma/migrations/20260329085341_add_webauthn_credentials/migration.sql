-- CreateTable
CREATE TABLE "UserWebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "label" TEXT NOT NULL DEFAULT 'Clé de sécurité',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "UserWebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserWebAuthnCredential_credentialId_key" ON "UserWebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "UserWebAuthnCredential_userId_idx" ON "UserWebAuthnCredential"("userId");

-- AddForeignKey
ALTER TABLE "UserWebAuthnCredential" ADD CONSTRAINT "UserWebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
