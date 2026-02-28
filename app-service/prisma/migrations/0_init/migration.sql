-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT,
    "systemTag" TEXT,
    "autoproxyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLink" (
    "matrixId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AccountLink_pkey" PRIMARY KEY ("matrixId")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "pronouns" TEXT,
    "description" TEXT,
    "color" TEXT,
    "proxyTags" JSONB NOT NULL,
    "matrixId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "System_slug_key" ON "System"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Member_systemId_slug_key" ON "Member"("systemId", "slug");

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_autoproxyId_fkey" FOREIGN KEY ("autoproxyId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLink" ADD CONSTRAINT "AccountLink_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

