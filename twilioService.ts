import twilio from "twilio";
import type { Twilio } from "twilio";
import { handleConversation } from "./openaiService.js";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER as string;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  throw new Error("Missing required Twilio environment variables");
}

const validAccountSid: string = accountSid;
const validAuthToken: string = authToken;

const client: Twilio = twilio(validAccountSid, validAuthToken);

export async function makeCall(phoneNumber: string): Promise<string> {
  try {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml
      .play(
        "http://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3"
      )
      .gather({
        input: ["speech"],
        timeout: 5,
        speechTimeout: "auto",
        action:
          "https://dialerbackend-f07ad367d080.herokuapp.com/api/call-handler",
        method: "POST",
      })
      .say(
        "Hi, I'm calling on behalf of Valor, a military discount directory. We're creating a list to help service members and their families find military discounts. Could I confirm some quick details about any discount your business might offer?"
      );

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

  const twiml = new twilio.twiml.VoiceResponse();

  if (result.analysis.shouldEndCall) {
    twiml.say(result.response);
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
      .say(result.response);
  }

  return {
    twiml,
    analysis: {
      ...result.analysis,
      discountDetails: transcript,
    },
  };
}
