# Nectarin Bot

## Переменные окружения
- OPENROUTER_API_KEY
- TELEGRAM_TOKEN
- ADMIN_CHAT_ID

## Деплой
1. Загрузить проект в GitHub
2. Подключить репозиторий к Vercel
3. Добавить env-переменные
4. Установить webhook:
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.vercel.app/api
