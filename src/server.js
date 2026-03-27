import express from 'express';
import path from 'path';
import { config } from './config.js';
import { addDocument, appendHistory, getChat, resetChat } from './storage.js';
import { downloadTelegramFile, sendMessage, sendTyping, setWebhook } from './telegram.js';
import { extractTextFromFile, chunkText, summarizeDocument } from './file-parsers.js';
import { getRelevantChunks } from './retrieval.js';
import { EXEC_ASSISTANT_PROMPT, buildUserPrompt } from './prompts.js';
import { askAssistant } from './openai.js';

const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'agency-exec-ai-bot' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/telegram/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    await handleUpdate(req.body);
  } catch (error) {
    console.error('Webhook handling error:', error);
  }
});

async function handleUpdate(update) {
  const message = update?.message;
  if (!message?.chat?.id) return;

  const chatId = String(message.chat.id);
  getChat(chatId);

  if (message.text?.startsWith('/start')) {
    await sendMessage(
      chatId,
      [
        'Привет. Я AI-ассистент руководителя digital-агентства.',
        '',
        'Что умею:',
        '- давать рекомендации по управлению, продажам, клиентам и команде;',
        '- анализировать PDF, DOCX, XLSX, CSV, TXT и отвечать по ним;',
        '- помогать собирать выводы, риски и план действий.',
        '',
        'Команды:',
        '/help — подсказка',
        '/reset — очистить историю и загруженные файлы',
        '/files — показать список загруженных файлов',
      ].join('\n'),
    );
    return;
  }

  if (message.text?.startsWith('/help')) {
    await sendMessage(
      chatId,
      'Просто отправьте вопрос или загрузите файл. После загрузки можно спрашивать, например: “Сделай summary”, “Какие риски ты видишь?”, “Сравни это с предыдущим документом”, “Что уточнить у команды?”.',
    );
    return;
  }

  if (message.text?.startsWith('/reset')) {
    resetChat(chatId);
    await sendMessage(chatId, 'История и загруженные файлы очищены.');
    return;
  }

  if (message.text?.startsWith('/files')) {
    const chat = getChat(chatId);
    const docs = chat.documents || [];
    const text = docs.length
      ? docs.map((doc, index) => `${index + 1}. ${doc.fileName}`).join('\n')
      : 'Файлы пока не загружены.';
    await sendMessage(chatId, text);
    return;
  }

  if (message.document) {
    await handleDocumentMessage(chatId, message);
    return;
  }

  if (message.text) {
    await handleTextMessage(chatId, message.text);
  }
}

async function handleDocumentMessage(chatId, message) {
  const document = message.document;
  const originalName = document.file_name || 'document.bin';

  await sendTyping(chatId);
  await sendMessage(chatId, `Принял файл *${escapeMarkdown(originalName)}*. Начинаю анализ.`);

  const filePath = await downloadTelegramFile(document.file_id, originalName);
  const extractedText = await extractTextFromFile(filePath, originalName);

  if (!extractedText || extractedText.length < 20) {
    await sendMessage(chatId, 'Не удалось извлечь достаточно текста из файла. Попробуйте другой документ или текстовый формат.');
    return;
  }

  const chunks = chunkText(extractedText, originalName);
  addDocument(chatId, {
    fileName: originalName,
    uploadedAt: new Date().toISOString(),
    summary: summarizeDocument(extractedText),
    chunks,
  });

  appendHistory(chatId, 'user', `[Загружен файл: ${originalName}]`);

  await sendMessage(
    chatId,
    [
      `Файл *${escapeMarkdown(originalName)}* обработан.`,
      '',
      '*Что можно спросить дальше:*',
      '- Сделай краткое summary',
      '- Какие риски ты видишь?',
      '- Что здесь слабое место?',
      '- Какие вопросы нужно задать команде?',
      '- Подготовь рекомендации для руководителя',
    ].join('\n'),
  );
}

async function handleTextMessage(chatId, text) {
  await sendTyping(chatId);

  const chat = getChat(chatId);
  const relevantChunks = getRelevantChunks(text, chat.documents || []);

  const userPrompt = buildUserPrompt({
    question: text,
    retrievedContext: relevantChunks,
    recentHistory: (chat.history || []).slice(-10),
  });

  appendHistory(chatId, 'user', text);
  const answer = await askAssistant({
    systemPrompt: EXEC_ASSISTANT_PROMPT,
    userPrompt,
  });
  appendHistory(chatId, 'assistant', answer);

  await sendMessage(chatId, escapeLongMessage(answer));
}

function escapeMarkdown(text) {
  return String(text).replace(/([_\-*\[\]()~`>#+=|{}.!])/g, '\\$1');
}

function escapeLongMessage(text) {
  const safe = String(text || '');
  if (safe.length <= 4000) return safe;
  return safe.slice(0, 3900) + '\n\n[Ответ обрезан из-за ограничения Telegram]';
}

app.listen(config.port, async () => {
  console.log(`Server started on port ${config.port}`);
  try {
    await setWebhook();
  } catch (error) {
    console.error('Webhook setup error:', error?.response?.data || error.message);
  }
});
