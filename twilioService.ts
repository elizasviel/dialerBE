import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER as string;
const twilioFunctionUrl = process.env.TWILIO_FUNCTION_URL as string;

if (!accountSid || !authToken || !twilioPhoneNumber || !twilioFunctionUrl) {
  throw new Error("Missing required Twilio environment variables");
}

const client = twilio(accountSid, authToken);

export async function makeCall(phoneNumber: string): Promise<string> {
  try {
    const call = await client.calls.create({
      url: twilioFunctionUrl,
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
    // First, create the Asset
    const asset = await client.serverless.v1
      .services(process.env.TWILIO_SERVICE_SID as string)
      .assets.create({ friendlyName: "custom-greeting" });

    console.log("Asset created:", asset);
  } catch (error) {
    console.error("Error uploading recording to Twilio:", error);
    throw error;
  }
}

export async function listAssets() {
  try {
    const assets = await client.serverless.v1
      .services(process.env.TWILIO_SERVICE_SID as string)
      .assets.list();

    return assets;
  } catch (error) {
    console.error("Error listing Twilio assets:", error);
    throw error;
  }
}

export async function deleteAsset(assetSid: string) {
  try {
    await client.serverless.v1
      .services(process.env.TWILIO_SERVICE_SID as string)
      .assets(assetSid)
      .remove();

    return true;
  } catch (error) {
    console.error("Error deleting Twilio asset:", error);
    throw error;
  }
}
