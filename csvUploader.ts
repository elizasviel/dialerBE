import { PrismaClient } from "@prisma/client";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse";
import { Readable } from "stream";
import { makeCall } from "./twilioService";
import twilio from "twilio";
const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

interface BusinessRow {
  name: string;
  phone: string;
  callNotes: string;
}

interface SpeechResult {
  confidence: number;
  transcript: string;
}

const validatePhone = (phone: string): boolean => {
  const phoneRegex = /^\+?[\d\s-()]{10,}$/;
  return phoneRegex.test(phone);
};

const validateRow = (row: BusinessRow): string | null => {
  if (!row.name || row.name.length < 2) {
    return "Name must be at least 2 characters long";
  }
  if (!validatePhone(row.phone)) {
    return "Invalid phone number format";
  }
  return null;
};

const analyzeSpeechResponse = (transcript: string) => {
  const hasDiscount = /yes|yeah|we do|correct/i.test(transcript);
  const percentageMatch = transcript.match(/(\d+)(?:\s*%|\s*percent)/);
  const discountAmount = percentageMatch ? percentageMatch[1] + "%" : null;

  const activeDutyOnly = /active\s*duty\s*only/i.test(transcript);
  const availabilityInfo = transcript.match(/available\s*([\w\s,]+)(?=\.|$)/i);

  return {
    hasDiscount,
    discountAmount,
    discountDetails: `${activeDutyOnly ? "Active duty only. " : ""}${
      availabilityInfo ? `Available ${availabilityInfo[1]}` : ""
    }`.trim(),
  };
};

router.post(
  "/upload-csv",
  upload.single("file"),
  async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      if (!req.file.originalname.endsWith(".csv")) {
        return res.status(400).json({ error: "File must be a CSV" });
      }

      const records: BusinessRow[] = [];
      const errors: string[] = [];
      let rowNumber = 0;

      const stream = Readable.from(req.file.buffer.toString());
      const parser = stream.pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        })
      );

      for await (const record of parser) {
        rowNumber++;
        const error = validateRow(record);
        if (error) {
          errors.push(`Row ${rowNumber}: ${error}`);
          continue;
        }
        records.push(record);
      }

      if (errors.length > 0) {
        return res.status(400).json({
          error: "Validation errors found",
          details: errors,
        });
      }

      const result = await prisma.business.createMany({
        data: records.map((record) => ({
          name: record.name.trim(),
          phone: record.phone.trim(),
          callNotes: "",
        })),
        skipDuplicates: true,
      });

      return res.json({
        message: "Upload successful",
        recordsProcessed: result.count,
      });
    } catch (error) {
      console.error("Error uploading CSV:", error);
      return res.status(500).json({
        error: "Failed to process CSV file",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

router.get("/businesses", async (_req, res) => {
  try {
    const businesses = await prisma.business.findMany({
      orderBy: {
        name: "asc",
      },
    });
    res.json(businesses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

router.delete("/clear-database", async (_req: any, res: any) => {
  try {
    await prisma.business.deleteMany({});
    return res.json({ message: "Database cleared successfully" });
  } catch (error) {
    console.error("Error clearing database:", error);
    return res.status(500).json({
      error: "Failed to clear database",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/export-csv", async (_req, res) => {
  try {
    const businesses = await prisma.business.findMany({
      orderBy: { name: "asc" },
    });

    // Create CSV header
    const csvHeader = "name,phone,callNotes\n";

    // Convert businesses to CSV rows
    const csvRows = businesses
      .map(
        (business) => `${business.name},${business.phone},${business.callNotes}`
      )
      .join("\n");

    const csvContent = csvHeader + csvRows;

    // Set headers for file download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=businesses.csv");

    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ error: "Failed to export businesses" });
  }
});

router.post("/call-all", async (_req, res) => {
  try {
    const businesses = await prisma.business.findMany({
      select: { phone: true },
    });

    const callPromises = businesses.map((business) => makeCall(business.phone));
    const results = await Promise.allSettled(callPromises);

    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    res.json({
      message: `Calls initiated: ${successful} successful, ${failed} failed`,
      total: businesses.length,
    });
  } catch (error) {
    console.error("Error initiating calls:", error);
    res.status(500).json({
      error: "Failed to initiate calls",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/call-handler", async (req: any, res: any) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const speechResult = req.body.SpeechResult as string;
  const phoneNumber = req.body.To; // The called phone number

  if (!speechResult) {
    twiml.say("I'm sorry, I didn't catch that. Thank you for your time.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  const analysis = analyzeSpeechResponse(speechResult);

  try {
    // First find the business
    const business = await prisma.business.findFirst({
      where: {
        phone: phoneNumber,
      },
    });

    if (!business) {
      console.error(`No business found with phone number: ${phoneNumber}`);
      twiml.say("Thank you for your time. Goodbye!");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    // Then update it
    await prisma.business.update({
      where: { id: business.id },
      data: {
        hasDiscount: analysis.hasDiscount,
        discountAmount: analysis.discountAmount,
        discountDetails: analysis.discountDetails,
        lastCalled: new Date(),
        callStatus: "completed",
        callNotes: speechResult,
      },
    });

    twiml.say("Thank you for the information. Have a great day!");
    twiml.hangup();

    return res.type("text/xml").send(twiml.toString());
  } catch (error) {
    console.error("Error updating business record:", error);
    twiml.say(
      "I apologize for the technical difficulty. Thank you for your time."
    );
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }
});

export default router;
