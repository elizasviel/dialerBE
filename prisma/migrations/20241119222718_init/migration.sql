-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "callNotes" TEXT NOT NULL,
    "hasDiscount" BOOLEAN NOT NULL DEFAULT false,
    "discountAmount" TEXT,
    "discountDetails" TEXT,
    "lastCalled" TIMESTAMP(3),
    "callStatus" TEXT,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);
