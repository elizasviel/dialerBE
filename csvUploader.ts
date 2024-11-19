import { PrismaClient } from "@prisma/client";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse";
import { Readable } from "stream";
import {
  makeCall,
  uploadRecording,
  listAssets,
  deleteAsset,
} from "./twilioService";

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
  hasDiscount: string;
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
  if (!["true", "false"].includes(row.hasDiscount.toLowerCase())) {
    return "hasDiscount must be true or false";
  }
  return null;
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
          hasDiscount: record.hasDiscount.toLowerCase() === "true",
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
    const csvHeader = "name,phone,hasDiscount\n";

    // Convert businesses to CSV rows
    const csvRows = businesses
      .map(
        (business) =>
          `${business.name},${business.phone},${business.hasDiscount}`
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

router.post(
  "/upload-recording",
  upload.single("file"),
  async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const assetSid = await uploadRecording(req.file.buffer);
      res.json({
        message: "Recording uploaded successfully",
        assetSid,
      });
    } catch (error) {
      console.error("Error uploading recording:", error);
      res.status(500).json({
        error: "Failed to upload recording",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

router.get("/assets", async (_req, res) => {
  try {
    const assets = await listAssets();
    res.json(assets);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch assets",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.delete("/assets/:assetSid", async (req, res) => {
  try {
    await deleteAsset(req.params.assetSid);
    res.json({ message: "Asset deleted successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete asset",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
