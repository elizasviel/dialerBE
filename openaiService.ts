import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a professional representative from Valor, a military discount directory.
Follow this exact conversation flow:

1. First Interaction Only:
- Use this exact greeting: "Hi, I'm calling on behalf of Valor, a military discount directory. We're creating a list to help service members and their families find military discounts. Could I confirm some quick details about any discount your business might offer?"

2. All Other Interactions:
- Ask only: "Do you offer a military discount, and if so, what is the percentage?"
- If they provide a discount, respond: "To confirm, you mentioned a [percentage] discount. We'll ensure it's accurately listed in our directory."
- End with: "Thank you for your time. Have a great day."

3. Call Control Rules:
- End call if:
  * You've confirmed the discount details
  * You've received a clear "no"
  * They're not interested
  * After 2 unclear responses
- Never ask additional questions about eligibility or availability
- Keep all responses brief and professional
- Never make up information`;

export async function handleConversation(
  transcript: string,
  isFirstInteraction: boolean
): Promise<{
  response: string;
  analysis: {
    hasDiscount: boolean;
    discountAmount?: string;
    discountDetails?: string;
    availabilityInfo?: string;
    eligibilityInfo?: string;
    shouldEndCall: boolean;
    endReason?:
      | "got_complete_info"
      | "no_discount_confirmed"
      | "not_interested"
      | "max_attempts_reached"
      | "unclear_response"
      | "continue";
  };
}> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system" as const, content: SYSTEM_PROMPT },
  ];

  if (isFirstInteraction) {
    messages.push({
      role: "assistant" as const,
      content:
        "Hi, I'm calling on behalf of Valor, a military discount directory. We're creating a list to help service members and their families find military discounts. Could I confirm some quick details about any discount your business might offer?",
    });
  }

  messages.push({ role: "user" as const, content: transcript });

  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages,
    functions: [
      {
        name: "analyze_response",
        parameters: {
          type: "object",
          properties: {
            hasDiscount: {
              type: "boolean",
              description: "Whether the business offers a military discount",
            },
            discountAmount: {
              type: "string",
              description: "The percentage or amount of the discount",
            },
            discountDetails: {
              type: "string",
              description: "Additional details about the discount",
            },
            availabilityInfo: {
              type: "string",
              description:
                "Any mentioned days/times when the discount is available",
            },
            eligibilityInfo: {
              type: "string",
              description: "Any mentioned eligibility requirements",
            },
            nextResponse: {
              type: "string",
              description:
                "What the AI should say next, following the conversation flow",
            },
            shouldEndCall: {
              type: "boolean",
              description: "Whether to end the call based on the control rules",
            },
            endReason: {
              type: "string",
              enum: [
                "got_complete_info",
                "no_discount_confirmed",
                "not_interested",
                "max_attempts_reached",
                "unclear_response",
                "continue",
              ],
              description: "The reason for ending or continuing the call",
            },
          },
          required: [
            "hasDiscount",
            "nextResponse",
            "shouldEndCall",
            "endReason",
          ],
        },
      },
    ],
    function_call: { name: "analyze_response" },
  });

  const functionCall = completion.choices[0].message.function_call;
  const result = JSON.parse(functionCall!.arguments);

  return {
    response: result.nextResponse,
    analysis: {
      hasDiscount: result.hasDiscount,
      discountAmount: result.discountAmount,
      discountDetails: result.discountDetails,
      availabilityInfo: result.availabilityInfo,
      eligibilityInfo: result.eligibilityInfo,
      shouldEndCall: result.shouldEndCall,
      endReason: result.endReason,
    },
  };
}
