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
    twiml.play(
      "https://dialer0.s3.us-east-1.amazonaws.com/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEBsaCXVzLWVhc3QtMSJHMEUCIGAqd6xoouBrrTKVfdAgXuw2j0eNkxRfo80hmRj8RobkAiEAq16Gli5TacZhkdnuu9DlVsaiHWk6JmW1486dDemZ9voq0AMItP%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARAAGgw5MTE0NDI0MzQzNDgiDJQIhRgpvtgVDM93OiqkA8QLTzN2sqIzjt5FrGhsiw9r9wvfJFUH3e6lDvht%2BUib20avZAgUutgcPQNqSPG0PVAwvEkxB9jsrHYb4tSTdN2aSmtU8w%2Fp0Gup6jGtLCD1JfkZTaZM4F0MItlu0FYU7x2PBGHPMmyrGI48LPU6PVcjydaqdBb9OoUC%2BeraFnSmsMf828t14ADKis%2FqqTyxlW4XWYEoPtJLLKbv8DGoje%2BUWzaMtPtQNvSi0YvZlxtXj%2Fc0Jw4cXoY941ezlMiqPM335gTSfTAoZHISMNLYIEFEhZBvQVBiMOT41v5lpTELiq0UbUQlVOAxQnFp%2BVKU85caU4I8b3vApaN1LWi2yzesmHtEt32yO8zvU9iNmwx3R3Ub1B46cKN5oLcFW3%2FmXS8L76C7PgvUEpl%2BVSAxzUdesnKwCfUdOubyp2xmN8nNMmiAnrQTO8I3SIK1lzstTuawm6k%2BUZLORFdxtmNiiuMKq%2F0y3yspfvUipUtdBrwq81VsDJYVxdVl0E%2FK4Akn7MnBIVrrZDcyrGYpqGo%2BntvgccuXVaLgzjHkNkXUL4kFMQC9cjDF3f%2B5BjrkAkqXwZnDLyLQbgaQMD2VoJjRk%2BjavQVBf00F%2Bo8ZAs%2FrNH1INpAnyB0TR9vzzsV9mICYjiYFGIQvhk7IPl1tlB3fuWybIftaPgbBTGaLgpN5ZyzGHnRuTIpBdz0W5Ewyom5oA1o18AwD97yTsyFbX90DpwxCxlm1couJk1JlIOotBn9R94KZAWH6kmXhgOMKvJd8kphE5MZNT4mC%2BUyQPVsAhuk2JCu%2FUqir561kj%2BRx2Avt6%2F9f2EqNoTMTT7dDxbnLMCOIueZ6DTvHdRBOxzwn%2B2C96Qat7yeTkW6Rmmqxf4f47OeV8vNXC7gugl37xRZ6KAAaR8LdM9tI%2BLe9LtPXwFa4HbnyTUpiTvRZ4YBYAzM03tb5lN5gVX9udhu3Nh8FksA16aDURFxMKs2m2jOEYlIa6zMe6%2BiXfFs4CSDkMI8bAmTWH7Hxdc903tse%2BM48fyz0rAF6UMVuqXYPMacj9aRr&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIA5INRT3EWGFBKO3IU%2F20241122%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20241122T025053Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=98b5ba8a4cd888774c803434014a21f970e31b0fb1c164089f07aeccfea53cd9"
    );
    /*
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
      */

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
