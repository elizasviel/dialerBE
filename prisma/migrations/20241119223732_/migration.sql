/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `Business` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Business_phone_key" ON "Business"("phone");
