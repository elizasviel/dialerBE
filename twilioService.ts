import twilio from "twilio";
import type { Twilio } from "twilio";
import { handleConversation } from "./openaiService.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import OpenAI from "openai";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER as string;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  throw new Error("Missing required Twilio environment variables");
}

const validAccountSid: string = accountSid;
const validAuthToken: string = authToken;

const client: Twilio = twilio(validAccountSid, validAuthToken);

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;

export async function makeCall(phoneNumber: string): Promise<string> {
  try {
    const greeting =
      "Hi, I'm calling on behalf of Valor, a military discount directory. We're creating a list to help service members and their families find military discounts. Could I confirm some quick details about any discount your business might offer?";

    const speechUrl = await generateAndStoreVoice(greeting);

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(speechUrl).gather({
      input: ["speech"],
      timeout: 5,
      speechTimeout: "auto",
      action:
        "https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler",
      method: "POST",
    });

    const call = await client.calls.create({
      twiml: twiml.toString(),
      to: phoneNumber,
      from: twilioPhoneNumber,
    });

    return call.sid;
  } catch (error) {
    console.error("Error making Twilio call:", error);
    throw error;
  }
}

export async function getTwilioAccountInfo() {
  try {
    const account = await client.api.v2010.accounts(validAccountSid).fetch();
    const balance = await client.balance.fetch();

    return {
      friendlyName: account.friendlyName || "Unknown Account",
      status: account.status || "unknown",
      type: account.type || "unknown",
      phoneNumber: twilioPhoneNumber,
      remainingBalance: balance.balance ? parseFloat(balance.balance) : null,
    };
  } catch (error) {
    console.error("Error fetching Twilio account info:", error);
    throw error;
  }
}

export async function handleCallResponse(
  transcript: string,
  isFirstInteraction: boolean
) {
  const result = await handleConversation(transcript, isFirstInteraction);
  const speechUrl = await generateAndStoreVoice(result.response);

  const twiml = new twilio.twiml.VoiceResponse();

  if (result.analysis.shouldEndCall) {
    twiml.play(speechUrl);
    twiml.hangup();
  } else {
    twiml.play(speechUrl).gather({
      input: ["speech"],
      timeout: 5,
      speechTimeout: "auto",
      action:
        "https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler",
      method: "POST",
    });
  }

  return {
    twiml,
    analysis: {
      ...result.analysis,
      discountDetails: transcript,
    },
  };
}

async function generateAndStoreVoice(text: string): Promise<string> {
  // Generate speech using OpenAI
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  const key = `speech-${Date.now()}.mp3`;

  // Upload to S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "audio/mpeg",
    })
  );

  // Generate signed URL
  const getCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
  return url;
}
