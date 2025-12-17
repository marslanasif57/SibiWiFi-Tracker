
import { GoogleGenAI } from "@google/genai";
import { MonthlyRecord, SIBLINGS } from "../types";

export const getBillInsights = async (history: MonthlyRecord[]) => {
  if (history.length === 0) return "No data available for analysis.";

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const modelName = 'gemini-3-flash-preview';
  
  const prompt = `
    Analyze the following WiFi bill history for four siblings (NI, AM, AD, SB).
    Rules: NI and AM pay double (2 shares), AD and SB pay single (1 share).
    History: ${JSON.stringify(history)}
    
    Provide a concise summary of:
    1. Who is most consistent with payments.
    2. Any notable trends in the total bill.
    3. A friendly, light-hearted "status update" message for the group chat.
    Keep the tone helpful and professional yet warm.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Could not generate insights at this time.";
  }
};
