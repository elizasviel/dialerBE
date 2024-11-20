import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER as string;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  throw new Error("Missing required Twilio environment variables");
}

const client = twilio(accountSid, authToken);

export async function makeCall(phoneNumber: string): Promise<string> {
  try {
    const call = await client.calls.create({
      twiml: `

        <Response>
          <Gather input="speech" timeout="5" speechTimeout="auto" 
                    action="https://1007-108-41-92-245.ngrok-free.app/api/call-handler" method="POST">
            <Say>
              Hi, I'm calling on behalf of Valor, a military discount directory. 
              We're creating a list to help service members and their families find military discounts. 
              Could you tell me if you offer a military discount, and if so, what percentage?
            </Say>
          </Gather>
          <Say>I didn't catch that. Let me repeat.</Say>
          <Redirect>https://1007-108-41-92-245.ngrok-free.app/api/call-handler</Redirect>
        </Response>
      `,
      to: phoneNumber,
      from: twilioPhoneNumber,
    });
    return call.sid;
  } catch (error) {
    console.error("Error making Twilio call:", error);
    throw error;
  }
}
