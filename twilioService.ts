import twilio from "twilio";
import type { Twilio } from "twilio";
import { handleConversation } from "./openaiService.js";
import {
  S3Client,
  PutObjectCommand,
  waitUntilObjectExists,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
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
    // Generate fresh audio for this specific call
    const introUrl = await generateAndStoreVoice(
      "Hi, I'm calling on behalf of Valor, a military discount directory. We're creating a list to help service members and their families find military discounts. Could I confirm some quick details about any discount your business might offer?"
    );

    const twiml = new twilio.twiml.VoiceResponse();
    twiml
      .gather({
        input: ["speech"],
        timeout: 5,
        speechTimeout: "auto",
        action:
          "https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler",
        method: "POST",
      })
      .play(introUrl);

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
  //const speechUrl = await generateAndStoreVoice(result.response);

  const twiml = new twilio.twiml.VoiceResponse();

  if (result.analysis.shouldEndCall) {
    twiml.play(
      "https://dialer0.s3.us-east-1.amazonaws.com/speech-1732250575331.mp3?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEB0aCXVzLWVhc3QtMSJGMEQCIHkh2ZyBQYXWGn963weQN1SNs65Dy8sSayEaU1kVh9AXAiBnnd1KgmD9%2FpIhFs95ufFyX318%2FylTUMbuLNO5VXsrlSrQAwi2%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F8BEAAaDDkxMTQ0MjQzNDM0OCIMFQ7qWYJAKW8zyzvZKqQDUKJJ2xuyb8ZSN3TlT2ufrEXJI9HhizFAmFOi5z2lAuwgYcfVYb4iZyopt4JpOBzM8UHfxWIQ6a7LXxz9so0qy9cqIbdBOQAkIZe8mcRNzxCETEo%2Fqk%2BqlRlvxMX4nrd8WFnTuFrNdDqwSnn5KzGRKDhxsH9OxeUaqkkNRWzBEk%2BaE2n%2BmCjfbI%2BHc%2BeMZ5v02gOFi1%2F%2B8hhn%2FiZMtC8GfqCcPeapKgR3MklPc3CnZOpooF%2BwkWnsYyHVsSye6kPB3QWYTjv8GW0AhVi%2FDdfeV9Pr5ntwhIKwQCW62ETswsZDPBgfgJ2qcLzmMYlwaGYHM83woLyV4CFnNdkr3ivxEBezh9izS63hf1qcoR0ztG79DL%2BJ%2BWny%2BpJTUO5PLf6CMnOMl%2F6kCUjsCqSgClLfrdRLJTF67eIT0EMpoFOYqBjxX6bENQkAgelgapL8ccH4E0psHfVaM5Kmm1M5babxd2CC5u3T%2FAv%2BQnjSwWydD8YkP9%2Fm3ct0Fz5ZG%2BW1vbkOLV2bcItPN1zcmnchOz5euB0b6W3C7P38Qmse9MZ%2FgJ7OoCwbMMXd%2F7kGOuUCTYiwc2AauJEMcW5DCTnPdaheS5h8wyfhedmEFA8fXyAS0P4wtTdjymoiyBxyVG6VfOtxudbT9t8okWKo%2Bnw2VOzGOPytDksCdQaGtzrs%2BLuHv1ltMPXe8QFxHnU%2Fn7nOIi76NPZL6DDHNWkFeRrtK4JHjWZCrUPPrbYGOYMrZMhP8lZUL7WG7CbqMwVPFoXAODQCc6HZ1ybcCD2L6gOkEcCRdNJPVfafMLJ%2B7r2KRdnIpkMvGvII4%2Fqpr2X0%2FgurKv8f2gJcVt3xMRCrDDJvF0ZtLtX%2Fdr2ADwlxtiOhTxghhqtR3z1N4CgfGCNru0DZucaFpLaXPubx19rvu9I3gjE%2BSeJgIDbeB9lvLWY3NFEbEFxMHtB7LLwei8VPPJzJHIsqQM4QV%2FjFPxplNQbnZwV2SbEsbQ2MgxCyXVF8wCsWMSpfK6DkvPh6pi4P542F1kmJH9JNXh8FY3KdASnfr3jM8gCQ&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA5INRT3EWJPJEKKB7%2F20241122%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20241122T044421Z&X-Amz-Expires=36000&X-Amz-SignedHeaders=host&X-Amz-Signature=e745d8ff4ec86656e9a162d2197748f025b67db3a828d70dfef61aede43f8947"
    );
    twiml.hangup();
  } else {
    twiml
      .gather({
        input: ["speech"],
        timeout: 5,
        speechTimeout: "auto",
        action:
          "https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler",
        method: "POST",
      })
      .play(
        "https://dialer0.s3.us-east-1.amazonaws.com/speech-1732250575331.mp3?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEB0aCXVzLWVhc3QtMSJGMEQCIHkh2ZyBQYXWGn963weQN1SNs65Dy8sSayEaU1kVh9AXAiBnnd1KgmD9%2FpIhFs95ufFyX318%2FylTUMbuLNO5VXsrlSrQAwi2%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F8BEAAaDDkxMTQ0MjQzNDM0OCIMFQ7qWYJAKW8zyzvZKqQDUKJJ2xuyb8ZSN3TlT2ufrEXJI9HhizFAmFOi5z2lAuwgYcfVYb4iZyopt4JpOBzM8UHfxWIQ6a7LXxz9so0qy9cqIbdBOQAkIZe8mcRNzxCETEo%2Fqk%2BqlRlvxMX4nrd8WFnTuFrNdDqwSnn5KzGRKDhxsH9OxeUaqkkNRWzBEk%2BaE2n%2BmCjfbI%2BHc%2BeMZ5v02gOFi1%2F%2B8hhn%2FiZMtC8GfqCcPeapKgR3MklPc3CnZOpooF%2BwkWnsYyHVsSye6kPB3QWYTjv8GW0AhVi%2FDdfeV9Pr5ntwhIKwQCW62ETswsZDPBgfgJ2qcLzmMYlwaGYHM83woLyV4CFnNdkr3ivxEBezh9izS63hf1qcoR0ztG79DL%2BJ%2BWny%2BpJTUO5PLf6CMnOMl%2F6kCUjsCqSgClLfrdRLJTF67eIT0EMpoFOYqBjxX6bENQkAgelgapL8ccH4E0psHfVaM5Kmm1M5babxd2CC5u3T%2FAv%2BQnjSwWydD8YkP9%2Fm3ct0Fz5ZG%2BW1vbkOLV2bcItPN1zcmnchOz5euB0b6W3C7P38Qmse9MZ%2FgJ7OoCwbMMXd%2F7kGOuUCTYiwc2AauJEMcW5DCTnPdaheS5h8wyfhedmEFA8fXyAS0P4wtTdjymoiyBxyVG6VfOtxudbT9t8okWKo%2Bnw2VOzGOPytDksCdQaGtzrs%2BLuHv1ltMPXe8QFxHnU%2Fn7nOIi76NPZL6DDHNWkFeRrtK4JHjWZCrUPPrbYGOYMrZMhP8lZUL7WG7CbqMwVPFoXAODQCc6HZ1ybcCD2L6gOkEcCRdNJPVfafMLJ%2B7r2KRdnIpkMvGvII4%2Fqpr2X0%2FgurKv8f2gJcVt3xMRCrDDJvF0ZtLtX%2Fdr2ADwlxtiOhTxghhqtR3z1N4CgfGCNru0DZucaFpLaXPubx19rvu9I3gjE%2BSeJgIDbeB9lvLWY3NFEbEFxMHtB7LLwei8VPPJzJHIsqQM4QV%2FjFPxplNQbnZwV2SbEsbQ2MgxCyXVF8wCsWMSpfK6DkvPh6pi4P542F1kmJH9JNXh8FY3KdASnfr3jM8gCQ&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA5INRT3EWJPJEKKB7%2F20241122%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20241122T044421Z&X-Amz-Expires=36000&X-Amz-SignedHeaders=host&X-Amz-Signature=e745d8ff4ec86656e9a162d2197748f025b67db3a828d70dfef61aede43f8947"
      );
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
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  const key = `speech-${Date.now()}.mp3`;

  // Upload to S3
  const putCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: "audio/mpeg",
  });

  await s3Client.send(putCommand);

  // Wait for the object to be available
  await waitUntilObjectExists(
    {
      client: s3Client,
      maxWaitTime: 10,
    },
    {
      Bucket: BUCKET_NAME,
      Key: key,
    }
  );

  // Generate signed URL using GetObjectCommand instead of PutObjectCommand
  const getCommand = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
  return url;
}

interface RecordingTexts {
  introduction: string;
  discountInquiry: string;
  confirmation: string;
  closing: string;
}

interface GeneratedUrls {
  [key: string]: string; // Index signature
}

export async function generateStandardRecordings() {
  const recordings: RecordingTexts = {
    introduction:
      "Hi, I'm calling on behalf of Valor, a military discount directory. We're creating a list to help service members and their families find military discounts. Could I confirm some quick details about any discount your business might offer?",
    discountInquiry:
      "Do you offer a military discount, and if so, what is the percentage?",
    confirmation:
      "To confirm, you mentioned a {percentage} discount. We'll ensure it's accurately listed in our directory.",
    closing: "Thank you for your time. Have a great day.",
  };

  const generatedUrls: GeneratedUrls = {};

  for (const [key, text] of Object.entries(recordings)) {
    try {
      const url = await generateAndStoreVoice(text);
      generatedUrls[key] = url;
      console.log(`Generated recording for ${key}`);
    } catch (error) {
      console.error(`Failed to generate recording for ${key}:`, error);
    }
  }

  return generatedUrls;
}
