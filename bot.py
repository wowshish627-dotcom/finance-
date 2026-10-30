"""Телеграм-бот для учёта личных финансов.

Как записывать:
    500 еда            -> расход 500 в категории «еда»
    -1200 такси домой  -> расход 1200, «такси», комментарий «домой»
    +80000 зарплата    -> доход 80000, «зарплата»
"""
import csv
import io
import logging
import os
import re
from datetime import datetime, timedelta

from dotenv import load_dotenv
from telegram import ReplyKeyboardMarkup, Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

import db

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN")
# Если задан — бот отвечает только этому пользователю (узнать свой id: команда /id)
ALLOWED_USER_ID = int(os.getenv("ALLOWED_USER_ID") or 0)
CURRENCY = os.getenv("CURRENCY", "₽")

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)

OPERATION_RE = re.compile(r"^\s*([+-]?)\s*(\d+(?:[.,]\d{1,2})?)\s+(\S+)\s*(.*)$")

KEYBOARD = ReplyKeyboardMarkup(
    [["💰 Баланс", "📊 Месяц"], ["📜 История", "↩️ Отменить"]], resize_keyboard=True
)

HELP = (
    "Записывай операции просто сообщением:\n"
    "• <code>500 еда</code> — расход\n"
    "• <code>-1200 такси домой</code> — расход с комментарием\n"
    "• <code>+80000 зарплата</code> — доход\n\n"
    "Команды:\n"
    "/balance — текущий баланс\n"
    "/month — статистика за текущий месяц\n"
    "/week — статистика за 7 дней\n"
    "/history — последние 10 операций\n"
    "/undo — удалить последнюю операцию\n"
    "/del <i>id</i> — удалить операцию по номеру\n"
    "/budget <i>категория сумма</i> — месячный лимит на категорию\n"
    "/budgets — лимиты и сколько осталось\n"
    "/export — выгрузить всё в CSV\n"
    "/id — твой Telegram id"
)


def money(x: float) -> str:
    s = f"{x:,.2f}".replace(",", " ").replace(".00", "")
    return f"{s} {CURRENCY}"


def month_start() -> str:
    return datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


def allowed(update: Update) -> bool:
    return not ALLOWED_USER_ID or update.effective_user.id == ALLOWED_USER_ID


def format_stats(title: str, since: str, user_id: int) -> str:
    income, expense, by_cat = db.stats(user_id, since)
    lines = [
        f"<b>{title}</b>",
        f"Доходы: {money(income)}",
        f"Расходы: {money(expense)}",
        f"Итого: {money(income - expense)}",
    ]
    if by_cat:
        lines.append("\n<b>Расходы по категориям:</b>")
        for row in by_cat:
            share = row["total"] / expense * 100 if expense else 0
            lines.append(f"• {row['category']}: {money(row['total'])} ({share:.0f}%)")
    return "\n".join(lines)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    await update.message.reply_html("Привет! Я слежу за твоими деньгами.\n\n" + HELP, reply_markup=KEYBOARD)


async def show_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_html(f"Твой id: <code>{update.effective_user.id}</code>")


async def balance(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    await update.message.reply_html(f"💰 Баланс: <b>{money(db.balance(update.effective_user.id))}</b>")


async def month(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    title = f"Статистика за {datetime.now():%m.%Y}"
    await update.message.reply_html(format_stats(title, month_start(), update.effective_user.id))


async def week(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    since = (datetime.now() - timedelta(days=7)).isoformat()
    await update.message.reply_html(format_stats("Статистика за 7 дней", since, update.effective_user.id))


async def history(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    rows = db.history(update.effective_user.id)
    if not rows:
        await update.message.reply_text("Операций пока нет.")
        return
    lines = ["<b>Последние операции:</b>"]
    for r in rows:
        sign = "🟢 +" if r["amount"] > 0 else "🔴 −"
        date = datetime.fromisoformat(r["created_at"]).strftime("%d.%m %H:%M")
        comment = f" — {r['comment']}" if r["comment"] else ""
        lines.append(f"#{r['id']} {date} {sign}{money(abs(r['amount']))} {r['category']}{comment}")
    await update.message.reply_html("\n".join(lines))


async def undo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    user_id = update.effective_user.id
    op_id = db.last_id(user_id)
    if op_id is None:
        await update.message.reply_text("Нечего отменять.")
        return
    db.delete(user_id, op_id)
    await update.message.reply_text(f"Операция #{op_id} удалена. Баланс: {money(db.balance(user_id))}")


async def delete(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    if not context.args or not context.args[0].lstrip("#").isdigit():
        await update.message.reply_text("Использование: /del 12")
        return
    op_id = int(context.args[0].lstrip("#"))
    if db.delete(update.effective_user.id, op_id):
        await update.message.reply_text(f"Операция #{op_id} удалена.")
    else:
        await update.message.reply_text(f"Операция #{op_id} не найдена.")


async def budget(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    if len(context.args) != 2:
        await update.message.reply_text("Использование: /budget еда 15000")
        return
    category, raw = context.args[0].lower(), context.args[1].replace(",", ".")
    try:
        limit_ = float(raw)
    except ValueError:
        await update.message.reply_text("Сумма должна быть числом.")
        return
    db.set_budget(update.effective_user.id, category, limit_)
    await update.message.reply_text(f"Лимит на «{category}»: {money(limit_)} в месяц.")


async def budgets(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    user_id = update.effective_user.id
    limits = db.budgets(user_id)
    if not limits:
        await update.message.reply_text("Лимитов нет. Задай: /budget еда 15000")
        return
    lines = ["<b>Лимиты на месяц:</b>"]
    for category, limit_ in limits.items():
        spent = db.spent_in_category(user_id, category, month_start())
        mark = "⚠️" if spent > limit_ else "✅"
        lines.append(f"{mark} {category}: {money(spent)} из {money(limit_)} (осталось {money(limit_ - spent)})")
    await update.message.reply_html("\n".join(lines))


async def export(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    rows = db.all_operations(update.effective_user.id)
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["id", "дата", "сумма", "категория", "комментарий"])
    for r in rows:
        writer.writerow([r["id"], r["created_at"], r["amount"], r["category"], r["comment"]])
    data = io.BytesIO(buf.getvalue().encode("utf-8-sig"))  # BOM, чтобы Excel понял кириллицу
    await update.message.reply_document(data, filename=f"finance_{datetime.now():%Y-%m-%d}.csv")


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not allowed(update):
        return
    text = update.message.text
    buttons = {"💰 Баланс": balance, "📊 Месяц": month, "📜 История": history, "↩️ Отменить": undo}
    if text in buttons:
        await buttons[text](update, context)
        return

    match = OPERATION_RE.match(text)
    if not match:
        await update.message.reply_html("Не понял 🤔 Пример: <code>500 еда</code> или <code>+80000 зарплата</code>")
        return

    sign, raw_amount, category, comment = match.groups()
    amount = float(raw_amount.replace(",", "."))
    if amount == 0:
        await update.message.reply_text("Сумма должна быть больше нуля.")
        return
    if sign != "+":
        amount = -amount
    category = category.lower()
    user_id = update.effective_user.id

    op_id = db.add(user_id, amount, category, comment.strip())
    kind = "Доход" if amount > 0 else "Расход"
    reply = f"✅ {kind} #{op_id}: {money(abs(amount))} — {category}\nБаланс: {money(db.balance(user_id))}"

    limit_ = db.budgets(user_id).get(category)
    if amount < 0 and limit_ is not None:
        spent = db.spent_in_category(user_id, category, month_start())
        if spent > limit_:
            reply += f"\n⚠️ Лимит на «{category}» превышен: {money(spent)} из {money(limit_)}"
        elif spent > limit_ * 0.8:
            reply += f"\n🟡 Потрачено {spent / limit_:.0%} лимита на «{category}»"
    await update.message.reply_text(reply)


def main() -> None:
    if not TOKEN:
        raise SystemExit("Не задан BOT_TOKEN. Создай файл .env (см. .env.example).")
    db.init()
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler(["start", "help"], start))
    app.add_handler(CommandHandler("id", show_id))
    app.add_handler(CommandHandler("balance", balance))
    app.add_handler(CommandHandler("month", month))
    app.add_handler(CommandHandler("week", week))
    app.add_handler(CommandHandler("history", history))
    app.add_handler(CommandHandler("undo", undo))
    app.add_handler(CommandHandler("del", delete))
    app.add_handler(CommandHandler("budget", budget))
    app.add_handler(CommandHandler("budgets", budgets))
    app.add_handler(CommandHandler("export", export))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    logging.info("Бот запущен")
    app.run_polling()


if __name__ == "__main__":
    main()
