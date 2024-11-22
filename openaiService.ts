import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a professional representative from Valor, a military discount directory.
Your goal is to gather information about military discounts following this specific flow:

1. Introduction (first interaction only):
- Introduce yourself briefly as a Valor representative
- Explain you're gathering information for a military discount directory

2. Main Question:
- Ask about military discount and percentage
- Listen carefully to the response

3. Passive Information Gathering:
- Listen for mentions of specific days/times the discount is available
- Listen for eligibility requirements (active duty, veterans, etc.)
- Do not explicitly ask about these details

4. Wrap-up:
- Confirm the discount details if provided
- Thank them and end the call professionally

Keep responses brief and professional. Never make up information.`;

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
              description:
                "Any mentioned eligibility requirements (active duty, veterans, etc.)",
            },
            nextResponse: {
              type: "string",
              description:
                "What the AI should say next, following the conversation flow",
            },
            shouldEndCall: {
              type: "boolean",
              description:
                "Whether enough information has been gathered to end the call",
            },
          },
          required: ["hasDiscount", "nextResponse", "shouldEndCall"],
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
    },
  };
}
