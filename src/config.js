import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || '',
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  openAiApiKey: required('OPENAI_API_KEY'),
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  adminChatIds: (process.env.ADMIN_CHAT_IDS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  maxChunksPerFile: Number(process.env.MAX_CHUNKS_PER_FILE || 30),
  maxChunkLength: Number(process.env.MAX_CHUNK_LENGTH || 1800),
  topKChunks: Number(process.env.TOP_K_CHUNKS || 8),
};
