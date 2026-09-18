-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "comment" TEXT NOT NULL,
    "authorName" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "testimonials_mechanicId_key" ON "testimonials"("mechanicId");

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

