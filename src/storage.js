import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('data/db.json');

function ensureDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ chats: {} }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function getChat(chatId) {
  const db = readDb();
  if (!db.chats[chatId]) {
    db.chats[chatId] = {
      chatId,
      history: [],
      documents: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
  }
  return db.chats[chatId];
}

export function saveChat(chatId, updater) {
  const db = readDb();
  const existing = db.chats[chatId] || {
    chatId,
    history: [],
    documents: [],
    createdAt: new Date().toISOString(),
  };
  const updated = updater(existing);
  updated.updatedAt = new Date().toISOString();
  db.chats[chatId] = updated;
  writeDb(db);
  return updated;
}

export function appendHistory(chatId, role, content) {
  return saveChat(chatId, (chat) => {
    chat.history = chat.history || [];
    chat.history.push({ role, content, at: new Date().toISOString() });
    chat.history = chat.history.slice(-24);
    return chat;
  });
}

export function addDocument(chatId, document) {
  return saveChat(chatId, (chat) => {
    chat.documents = chat.documents || [];
    chat.documents.push(document);
    return chat;
  });
}

export function resetChat(chatId) {
  return saveChat(chatId, (chat) => ({
    ...chat,
    history: [],
    documents: [],
  }));
}
