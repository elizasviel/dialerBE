import twilio from "twilio";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER as string;

const s3Client = new S3Client({
  region: process.env.AWS_REGION as string,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME as string;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  throw new Error("Missing required Twilio environment variables");
}

const client = twilio(accountSid, authToken);

export async function makeCall(phoneNumber: string): Promise<string> {
  try {
    const currentRecordingUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/current-greeting.mp3`;
    const call = await client.calls.create({
      twiml: `<Response><Play>${currentRecordingUrl}</Play></Response>`,
      to: phoneNumber,
      from: twilioPhoneNumber,
    });
    return call.sid;
  } catch (error) {
    console.error("Error making Twilio call:", error);
    throw error;
  }
}

export async function uploadRecording(audioBuffer: Buffer) {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: "current-greeting.mp3",
      Body: audioBuffer,
      ContentType: "audio/mpeg",
    };

    await s3Client.send(new PutObjectCommand(params));
    const fileUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/current-greeting.mp3`;
    return fileUrl;
  } catch (error) {
    console.error("Error uploading recording to S3:", error);
    throw error;
  }
}

// Optional: If you want to keep track of multiple recordings
export async function listRecordings() {
  try {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: "recordings/",
      })
    );

    return (
      response.Contents?.map((object) => ({
        key: object.Key,
        url: `https://${BUCKET_NAME}.s3.amazonaws.com/${object.Key}`,
        lastModified: object.LastModified,
      })) || []
    );
  } catch (error) {
    console.error("Error listing S3 recordings:", error);
    throw error;
  }
}

export async function deleteRecording(key: string) {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    console.error("Error deleting S3 recording:", error);
    throw error;
  }
}
