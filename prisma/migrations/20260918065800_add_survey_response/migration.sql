-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "roles" TEXT[],
    "roleOther" TEXT,
    "worksOn" TEXT[],
    "worksOnOther" TEXT,
    "howYouWork" TEXT[],
    "howYouWorkOther" TEXT,
    "yearsExperience" TEXT NOT NULL,
    "ageRange" TEXT NOT NULL,
    "operationSize" TEXT NOT NULL,
    "whatKeepsRunning" TEXT[],
    "trackingMethods" TEXT[],
    "trackingMethodsOther" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_mechanicId_key" ON "survey_responses"("mechanicId");

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

