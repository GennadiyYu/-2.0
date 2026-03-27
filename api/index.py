from http.server import BaseHTTPRequestHandler
import json
import os
import requests
import tempfile
from openai import OpenAI

STATE_FILE = "/tmp/user_states.json"

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
MODEL_MAIN = os.getenv("MODEL_MAIN", "openai/gpt-4o-mini")
MODEL_FAST = os.getenv("MODEL_FAST", "openai/gpt-4o-mini")
ADMIN_CHAT_ID = int(os.getenv("ADMIN_CHAT_ID", "292012626"))

client = OpenAI(api_key=OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")

NECTARIN_SYSTEM = """Ты — AI-ассистент агентства Nectarin.
Роль: деловой, экспертный, спокойный, эмпатичный маркетинг-консультант.
Говори по-русски, если пользователь пишет по-русски.
Пиши ясно, без воды, но не сухо.
Если вопрос о маркетинге, стратегии, рекламе, бренде, digital, медиа, аналитике или growth — отвечай предметно.
Если пользователь клиент, помогай как пресейл-стратег.
Если пользователь уже заполнил бриф, можно общаться как маркетинговый консультант.
Не придумывай факты про агентство, если их не дали.
"""

BRIEF_QUESTIONS = [
    "Как вас зовут? Напишите ФИО.",
    "Наименование бренда, продукта или услуги?",
    "Какой ваш запрос?",
    "Планируемый бюджет на реализацию проекта? Этот вопрос нужен, потому что порог входа в агентство — от 20 млн рублей в год.",
    "Есть ли дополнительная информация, которую вы хотели бы озвучить?",
    "Как можно с вами связаться?"
]

HELP_TEXT = """Доступные команды:

/start — начать сначала
/help — показать команды
/reset — сбросить текущий сценарий
/state — показать текущее состояние
/brief — снова включить режим брифа
/chat — включить режим свободного AI-диалога
/strategy — режим стратегических задач
/audit — режим аудита
/estimate — режим оценки бюджета
/proposal — режим коммерческих предложений
/research — режим ресерча
/kpi — режим KPI и аналитики

Можно и без команд: просто пишите задачу, а бот сам попробует понять тип запроса.
"""

def load_states():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

user_states = load_states()

def save_states():
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(user_states, f, ensure_ascii=False)

def normalize_chat_id(chat_id):
    return str(chat_id)

def tg(method: str, payload=None, files=None):
    url = f"{TELEGRAM_API_URL}/{method}"
    if files:
        return requests.post(url, data=payload or {}, files=files, timeout=60)
    return requests.post(url, json=payload or {}, timeout=60)

def send_message(chat_id: str, text: str):
    return tg("sendMessage", {"chat_id": int(chat_id), "text": text[:4096]})

def send_typing(chat_id: str):
    return tg("sendChatAction", {"chat_id": int(chat_id), "action": "typing"})

def send_document(chat_id: int, file_path: str, filename: str = None, caption: str = None):
    with open(file_path, "rb") as f:
        files = {"document": (filename or os.path.basename(file_path), f)}
        data = {"chat_id": int(chat_id)}
        if caption:
            data["caption"] = caption[:1024]
        return tg("sendDocument", data, files=files)

def ask_llm(prompt: str, system: str = NECTARIN_SYSTEM, model: str = MODEL_MAIN, temperature: float = 0.4) -> str:
    try:
        res = client.chat.completions.create(
            model=model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ]
        )
        return (res.choices[0].message.content or "").strip()
    except Exception as e:
        return f"Ошибка AI: {e}"

def detect_intent(text: str) -> str:
    lower = text.lower().strip()
    cmd_map = {
        "/strategy": "strategy",
        "/audit": "audit",
        "/estimate": "estimate",
        "/proposal": "proposal",
        "/research": "research",
        "/kpi": "kpi",
        "/brief": "brief",
        "/chat": "chat",
    }
    if lower in cmd_map:
        return cmd_map[lower]

    keywords = {
        "strategy": ["стратег", "gtm", "план продвижения", "marketing strategy"],
        "audit": ["аудит", "проверь сайт", "разбери сайт", "разбор", "audit"],
        "estimate": ["сколько стоит", "бюджет", "estimate", "смета", "оценка бюджета"],
        "proposal": ["кп", "коммерческое предложение", "proposal", "предложение для клиента"],
        "research": ["исследуй", "ресерч", "research", "рынок", "конкурент"],
        "kpi": ["kpi", "метрики", "аналитик", "cac", "roas", "romi"],
    }
    for intent, words in keywords.items():
        if any(w in lower for w in words):
            return intent

    prompt = f"""
Определи тип запроса пользователя.
Возможные категории:
brief
chat
strategy
audit
estimate
proposal
research
kpi

Отвечай только одним словом из списка.

Запрос пользователя:
{text}
"""
    result = ask_llm(prompt, system="Ты классификатор интентов. Отвечай только одним словом из списка.", model=MODEL_FAST, temperature=0)
    token = result.lower().strip().split()[0] if result else "chat"
    return token if token in {"brief", "chat", "strategy", "audit", "estimate", "proposal", "research", "kpi"} else "chat"

def make_txt_document(title: str, body: str) -> str:
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8")
    temp.write(title + "\n")
    temp.write("=" * len(title) + "\n\n")
    temp.write(body)
    temp.flush()
    temp.close()
    return temp.name

def brief_prompt(answers: list[str]) -> str:
    combined = "\n".join(f"{i+1}. {q}\nОтвет: {a}" for i, (q, a) in enumerate(zip(BRIEF_QUESTIONS, answers)))
    return f"""
Составь деловой проектный бриф для агентства Nectarin по следующим ответам клиента.

{combined}

Требования:
- Стиль: деловой, понятный, без канцелярита.
- Структура: Клиент, Продукт/бренд, Запрос, Бюджет, Контакты, Дополнительная информация, Краткий вывод.
- Пиши целостно и аккуратно.
"""

def reply_for_mode(mode: str, user_text: str) -> str:
    prompts = {
        "strategy": f"Пользователь просит стратегическую помощь. Дай сильный, практический ответ.\n\nЗапрос:\n{user_text}",
        "audit": f"Сделай экспресс-аудит по запросу пользователя. Ответ: проблемы, риски, точки роста, что делать дальше.\n\nЗапрос:\n{user_text}",
        "estimate": f"Оцени примерный диапазон бюджета, структуру затрат и логику расчёта.\n\nЗапрос:\n{user_text}",
        "proposal": f"Сформируй черновик коммерческого предложения в логике агентства Nectarin.\n\nЗапрос:\n{user_text}",
        "research": f"Сделай быстрый ресерч-ответ: рынок, конкуренты, гипотезы, вопросы на уточнение.\n\nЗапрос:\n{user_text}",
        "kpi": f"Помоги с KPI, метриками, аналитикой и интерпретацией.\n\nЗапрос:\n{user_text}",
        "chat": f"Ответь пользователю как сильный маркетинг-консультант.\n\nЗапрос:\n{user_text}",
    }
    return ask_llm(prompts.get(mode, prompts["chat"]))

def admin_summary(chat_id: str, username: str, intent: str, original: str, result: str) -> str:
    return f"""Новый запрос в боте Nectarin

chat_id: {chat_id}
username: {username or "не указан"}
intent: {intent}

Запрос пользователя:
{original}

Результат:
{result}
"""

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            update = json.loads(body)

            message = update.get("message", {})
            from_user = message.get("from", {})
            chat = message.get("chat", {})
            chat_id = normalize_chat_id(chat.get("id"))
            username = from_user.get("username", "")
            user_text = (message.get("text") or "").strip()

            if not chat_id:
                return self.ok()

            state = user_states.get(chat_id, {
                "mode": "brief",
                "step": 0,
                "answers": [],
                "history": []
            })

            if user_text == "/help":
                send_message(chat_id, HELP_TEXT)

            elif user_text == "/start":
                state = {"mode": "brief", "step": 0, "answers": [], "history": []}
                send_typing(chat_id)
                send_message(
                    chat_id,
                    "Здравствуйте! Я задам вам 6 вопросов, которые помогут понять горизонт нашего возможного сотрудничества.\n\n"
                    + BRIEF_QUESTIONS[0]
                )

            elif user_text == "/reset":
                state = {"mode": "brief", "step": 0, "answers": [], "history": []}
                send_message(chat_id, "Состояние сброшено. Напишите /start, чтобы начать заново.")

            elif user_text == "/state":
                send_message(chat_id, json.dumps(state, ensure_ascii=False, indent=2)[:4096])

            elif user_text == "/brief":
                state["mode"] = "brief"
                state["step"] = 0
                state["answers"] = []
                send_message(chat_id, "Переключил вас в режим брифа.\n\n" + BRIEF_QUESTIONS[0])

            elif user_text == "/chat":
                state["mode"] = "chat"
                send_message(chat_id, "Переключил вас в режим свободного AI-диалога о маркетинге.")

            elif user_text in {"/strategy", "/audit", "/estimate", "/proposal", "/research", "/kpi"}:
                state["mode"] = detect_intent(user_text)
                send_message(chat_id, f"Режим переключён: {state['mode']}. Напишите задачу в свободной форме.")

            elif state.get("mode") == "brief":
                step = int(state.get("step", 0))
                answers = state.get("answers", [])

                if step < len(BRIEF_QUESTIONS):
                    answers.append(user_text)
                    step += 1
                    state["answers"] = answers
                    state["step"] = step

                    if step < len(BRIEF_QUESTIONS):
                        send_typing(chat_id)
                        send_message(chat_id, BRIEF_QUESTIONS[step])
                    else:
                        send_typing(chat_id)
                        send_message(chat_id, "Спасибо за ваши ответы! Я передаю информацию нашему специалисту.")
                        brief_text = ask_llm(brief_prompt(answers))
                        doc_path = make_txt_document("Бриф Nectarin", brief_text)
                        send_document(ADMIN_CHAT_ID, doc_path, filename="nectarin_brief.txt", caption="Новый бриф из Telegram-бота")
                        os.remove(doc_path)
                        send_message(chat_id, "Вижу, что документ уже получен. Ожидайте обратную связь в течение 24 часов.")
                        state["mode"] = "chat"
                        send_message(chat_id, "Пока ждём, я готов помочь с любыми вопросами по рекламе, маркетингу и продвижению.")

            else:
                intent = detect_intent(user_text)
                if user_text.startswith("/"):
                    intent = state.get("mode", "chat")
                if state.get("mode") in {"strategy", "audit", "estimate", "proposal", "research", "kpi"}:
                    intent = state["mode"]

                send_typing(chat_id)
                result = reply_for_mode(intent, user_text)
                send_message(chat_id, result)

                if intent in {"proposal", "strategy", "audit", "research"}:
                    body = admin_summary(chat_id, username, intent, user_text, result)
                    doc_path = make_txt_document(f"Nectarin {intent}", body)
                    send_document(ADMIN_CHAT_ID, doc_path, filename=f"nectarin_{intent}.txt")
                    os.remove(doc_path)

                state["mode"] = "chat"
                history = state.get("history", [])
                history.append({
                    "intent": intent,
                    "user": user_text,
                    "assistant": result[:2000]
                })
                state["history"] = history[-20:]

            user_states[chat_id] = state
            save_states()

        except Exception as e:
            try:
                if 'chat_id' in locals() and chat_id:
                    send_message(chat_id, f"Произошла техническая ошибка: {e}")
            except Exception:
                pass
            print("ERROR:", e)

        return self.ok()

    def ok(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")
