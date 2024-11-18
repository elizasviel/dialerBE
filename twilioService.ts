import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER as string;

// Move the validation to the top and make it more specific
if (!accountSid || !authToken || !twilioPhoneNumber) {
  throw new Error("Missing required Twilio environment variables");
}

// Create the client after we've validated the env vars
const client = twilio(accountSid, authToken);

export async function makeCall(phoneNumber: string): Promise<string> {
  try {
    const call = await client.calls.create({
      twiml: "<Response><Say>Do you offer military discounts?</Say></Response>",
      to: phoneNumber,
      from: twilioPhoneNumber,
    });
    return call.sid;
  } catch (error) {
    console.error("Error making Twilio call:", error);
    throw error;
  }
}
