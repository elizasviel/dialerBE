import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a professional, friendly representative from Valor, a military discount directory. 
Your goal is to gather information about military discounts from businesses.
Keep calls brief and professional. Listen carefully for discount details, availability, and eligibility requirements.
Never make up information or be pushy.`;

export async function handleConversation(
  transcript: string,
  isFirstInteraction: boolean
): Promise<{
  response: string;
  analysis: {
    hasDiscount: boolean;
    discountAmount?: string;
    discountDetails?: string;
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
            nextResponse: {
              type: "string",
              description: "What the AI should say next",
            },
            shouldEndCall: {
              type: "boolean",
              description: "Whether the conversation should end",
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
      shouldEndCall: result.shouldEndCall,
    },
  };
}
