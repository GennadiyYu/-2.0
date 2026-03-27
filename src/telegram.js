import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const api = axios.create({
  baseURL: `https://api.telegram.org/bot${config.telegramBotToken}`,
  timeout: 30000,
});

export async function setWebhook() {
  if (!config.baseUrl) {
    console.warn('BASE_URL is not set. Webhook registration skipped.');
    return;
  }

  const webhookUrl = `${config.baseUrl.replace(/\/$/, '')}/telegram/webhook`;
  await api.post('/setWebhook', { url: webhookUrl });
  console.log(`Webhook set: ${webhookUrl}`);
}

export async function sendMessage(chatId, text, extra = {}) {
  await api.post('/sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    ...extra,
  });
}

export async function sendTyping(chatId) {
  await api.post('/sendChatAction', {
    chat_id: chatId,
    action: 'typing',
  });
}

export async function getFileLink(fileId) {
  const response = await api.get(`/getFile?file_id=${fileId}`);
  const filePath = response.data?.result?.file_path;
  if (!filePath) throw new Error('Telegram file_path not found');
  return `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`;
}

export async function downloadTelegramFile(fileId, originalName = 'file.bin') {
  const url = await getFileLink(fileId);
  const safeName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const targetPath = path.resolve('tmp/uploads', safeName);

  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(targetPath, response.data);
  return targetPath;
}
