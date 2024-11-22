import { PrismaClient } from "@prisma/client";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse";
import { Readable } from "stream";
import {
  getTwilioAccountInfo,
  makeCall,
  handleCallResponse,
} from "./twilioService.js";
import twilio from "twilio";
import { EventEmitter } from "events";
const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});
const updateEmitter = new EventEmitter();

interface BusinessRow {
  name: string;
  phone: string;
  hasDiscount?: boolean;
  discountAmount?: string;
  discountDetails?: string;
  lastCalled?: Date;
  callStatus?: string;
}

const validatePhone = (phone: string): boolean => {
  const standardized = standardizePhoneNumber(phone);
  // Ensure it matches E.164 format (e.g., +1234567890)
  return /^\+\d{11,}$/.test(standardized);
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
  // Normalize the transcript for easier matching
  const normalizedText = transcript.toLowerCase().trim();

  // Check for discount existence with more variations
  const hasDiscount =
    /\b(yes|yeah|yep|correct|we do|offer|have|gives?|provides?)\b/i.test(
      normalizedText
    ) &&
    !/\b(no|don't|not|doesn't)\s+(?:offer|have|give|provide)\b/i.test(
      normalizedText
    );

  // Enhanced percentage matching
  const percentageMatches = [
    // Match "X percent" or "X %" formats
    ...normalizedText.matchAll(/(\d+)(?:\s*%|\s*percent(?:age)?)/g),
    // Match "X dollars off" format
    ...normalizedText.matchAll(/(\d+)(?:\s*dollars?\s+off)/g),
    // Match written numbers (up to twenty) with percent
    ...(normalizedText.match(/\b(ten|fifteen|twenty)\s*(?:percent|%)/i) || []),
  ];

  let discountAmount = null;
  if (percentageMatches.length > 0) {
    // Get the first match and convert written numbers if necessary
    const match = percentageMatches[0][1];
    const numberMap: Record<string, string> = {
      ten: "10",
      fifteen: "15",
      twenty: "20",
    };
    discountAmount = numberMap[match.toLowerCase()] || match;
    discountAmount += match.includes("dollar") ? " dollars off" : "%";
  }

  return {
    hasDiscount,
    discountAmount,
    discountDetails: transcript, // Store the entire original transcript
  };
};

const standardizePhoneNumber = (phone: string): string => {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // Add +1 prefix if it's a 10-digit US number
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  // If it already has country code (11 digits starting with 1)
  else if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return `+${digits}`;
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
          phone: standardizePhoneNumber(record.phone),
          hasDiscount: record.hasDiscount || false,
          discountAmount: record.discountAmount || null,
          discountDetails: record.discountDetails || null,
          lastCalled: record.lastCalled || null,
          callStatus: record.callStatus || "pending",
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
    const csvHeader =
      "name,phone,hasDiscount,discountAmount,discountDetails,lastCalled,callStatus\n";

    // Convert businesses to CSV rows
    const csvRows = businesses
      .map(
        (business) =>
          `${business.name},${business.phone},${business.hasDiscount},${business.discountAmount},${business.discountDetails},${business.lastCalled},${business.callStatus}`
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
    const businesses = await prisma.business.findMany();

    // Set all businesses to calling status first
    await prisma.business.updateMany({
      where: {
        id: {
          in: businesses.map((b) => b.id),
        },
      },
      data: {
        callStatus: "calling",
      },
    });

    // Emit updates for all businesses with complete business data
    businesses.forEach((business) => {
      updateEmitter.emit("update", {
        ...business,
        callStatus: "calling",
      });
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
  const speechResult = req.body.SpeechResult as string;
  const phoneNumber = req.body.To;
  const isFirstInteraction = !speechResult;

  if (!speechResult && !isFirstInteraction) {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("I'm sorry, I didn't catch that. Thank you for your time.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  try {
    const business = await prisma.business.findFirst({
      where: {
        phone: standardizePhoneNumber(phoneNumber),
      },
    });

    if (!business) {
      console.error(`No business found with phone number: ${phoneNumber}`);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say("Thank you for your time. Goodbye!");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    if (isFirstInteraction) {
      await prisma.business.update({
        where: { id: business.id },
        data: {
          callStatus: "in-progress",
        },
      });
    }

    const { twiml, analysis } = await handleCallResponse(
      speechResult || "",
      isFirstInteraction
    );

    if (analysis.shouldEndCall) {
      await prisma.business.update({
        where: { id: business.id },
        data: {
          hasDiscount: analysis.hasDiscount,
          discountAmount: analysis.discountAmount,
          discountDetails: analysis.discountDetails,
          availabilityInfo: analysis.availabilityInfo,
          eligibilityInfo: analysis.eligibilityInfo,
          lastCalled: new Date(),
          callStatus: "completed",
        },
      });
    }

    return res.type("text/xml").send(twiml.toString());
  } catch (error) {
    console.error("Error handling call:", error);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(
      "I apologize for the technical difficulty. Thank you for your time."
    );
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }
});

router.get("/business-updates", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendUpdate = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  updateEmitter.on("update", sendUpdate);

  req.on("close", () => {
    updateEmitter.off("update", sendUpdate);
  });
});

router.get("/twilio-info", async (_req, res) => {
  try {
    const accountInfo = await getTwilioAccountInfo();
    res.json(accountInfo);
  } catch (error) {
    console.error("Error fetching Twilio info:", error);
    res.status(500).json({
      error: "Failed to fetch Twilio account info",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
