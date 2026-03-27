import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { parse } from 'csv-parse/sync';
import { config } from './config.js';

function normalizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    return normalizeText(parsed.text);
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return normalizeText(result.value);
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = xlsx.readFile(filePath);
    const parts = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      const text = rows.map((row) => row.join(' | ')).join('\n');
      parts.push(`Лист: ${sheetName}\n${text}`);
    }
    return normalizeText(parts.join('\n\n'));
  }

  if (ext === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const records = parse(raw, { relax_column_count: true, skip_empty_lines: true });
    return normalizeText(records.map((row) => row.join(' | ')).join('\n'));
  }

  if (['.txt', '.md', '.json', '.html', '.xml'].includes(ext)) {
    return normalizeText(fs.readFileSync(filePath, 'utf-8'));
  }

  throw new Error(`Формат файла не поддерживается: ${ext}`);
}

export function chunkText(text, fileName) {
  if (!text) return [];

  const maxLen = config.maxChunkLength;
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if ((buffer + '\n\n' + paragraph).length <= maxLen) {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = '';
    }

    if (paragraph.length <= maxLen) {
      buffer = paragraph;
    } else {
      for (let i = 0; i < paragraph.length; i += maxLen) {
        chunks.push(paragraph.slice(i, i + maxLen));
      }
    }
  }

  if (buffer) chunks.push(buffer);

  return chunks.slice(0, config.maxChunksPerFile).map((chunk, index) => ({
    fileName,
    chunkIndex: index,
    text: chunk,
  }));
}

export function summarizeDocument(text) {
  const cleaned = normalizeText(text);
  return cleaned.slice(0, 1200) + (cleaned.length > 1200 ? '…' : '');
}
