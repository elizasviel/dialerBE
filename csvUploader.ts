import { PrismaClient } from "@prisma/client";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse";
import { Readable } from "stream";
import {
  getTwilioAccountInfo,
  makeCall,
  handleCallResponse,
  generateStandardRecordings,
  generateAndStoreVoice,
} from "./twilioService.js";
import twilio from "twilio";
import { EventEmitter } from "events";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});
const updateEmitter = new EventEmitter();

// First validate environment variables
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const region = process.env.AWS_REGION;
const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

if (!accessKeyId || !secretAccessKey || !region || !BUCKET_NAME) {
  throw new Error("Missing required AWS credentials in environment variables");
}

// Initialize S3 client with validated credentials
const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

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
  const numAttempts = parseInt(req.body.numAttempts || "0");

  if (!speechResult && !isFirstInteraction) {
    const twiml = new twilio.twiml.VoiceResponse();
    if (numAttempts >= 2) {
      // Generate fresh audio URL for the error message
      const audioUrl = await generateAndStoreVoice(
        "I apologize, but I'm having trouble understanding. Thank you for your time."
      );
      twiml.play(audioUrl);
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    const retryAudioUrl = await generateAndStoreVoice(
      "I'm sorry, I didn't catch that. Could you please repeat your response?"
    );
    twiml
      .gather({
        input: ["speech"],
        timeout: 5,
        speechTimeout: "auto",
        action: `https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler?numAttempts=${
          numAttempts + 1
        }`,
        method: "POST",
      })
      .play(retryAudioUrl);
    return res.type("text/xml").send(twiml.toString());
  }

  try {
    const { twiml, analysis } = await handleCallResponse(
      speechResult || "",
      isFirstInteraction
    );

    // Generate fresh audio URL for the response
    const responseText = twiml.toString().match(/<Say>(.*?)<\/Say>/)?.[1];
    if (responseText) {
      const audioUrl = await generateAndStoreVoice(responseText);
      const newTwiml = new twilio.twiml.VoiceResponse();
      if (analysis.shouldEndCall) {
        newTwiml.play(audioUrl);
        newTwiml.hangup();
      } else {
        newTwiml
          .gather({
            input: ["speech"],
            timeout: 5,
            speechTimeout: "auto",
            action:
              "https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler",
            method: "POST",
          })
          .play(audioUrl);
      }
      return res.type("text/xml").send(newTwiml.toString());
    }

    return res.type("text/xml").send(twiml.toString());
  } catch (error) {
    console.error("Error handling call:", error);
    const errorAudioUrl = await generateAndStoreVoice(
      "I apologize for the technical difficulty. Thank you for your time."
    );
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(errorAudioUrl);
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

router.post("/generate-recordings", async (_req, res) => {
  try {
    const recordings = await generateStandardRecordings();
    res.json({
      message: "Recordings generated successfully",
      recordings,
    });
  } catch (error) {
    console.error("Error generating recordings:", error);
    res.status(500).json({
      error: "Failed to generate recordings",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/assets", async (_req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
    });

    const response = await s3Client.send(command);

    const assets =
      response.Contents?.map((item) => ({
        key: item.Key,
        lastModified: item.LastModified,
        url: `https://${BUCKET_NAME}.s3.amazonaws.com/${item.Key}`,
        filename: item.Key,
      })) || [];

    res.json(assets);
  } catch (error) {
    console.error("Error fetching assets:", error);
    res.status(500).json({
      error: "Failed to fetch assets",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.delete("/assets/:key", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);

    res.json({ message: "Asset deleted successfully" });
  } catch (error) {
    console.error("Error deleting asset:", error);
    res.status(500).json({
      error: "Failed to delete asset",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
