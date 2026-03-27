import OpenAI from 'openai';
import { config } from './config.js';

export const openai = new OpenAI({
  apiKey: config.openAiApiKey,
});

export async function askAssistant({ systemPrompt, userPrompt }) {
  const response = await openai.responses.create({
    model: config.openAiModel,
    instructions: systemPrompt,
    input: userPrompt,
  });

  return response.output_text?.trim() || 'Не удалось получить ответ от модели.';
}
