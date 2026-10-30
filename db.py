"""Хранилище операций в SQLite."""
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).with_name("finance.db")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS operations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                amount     REAL    NOT NULL,   -- >0 доход, <0 расход
                category   TEXT    NOT NULL,
                comment    TEXT    NOT NULL DEFAULT '',
                created_at TEXT    NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS budgets (
                user_id  INTEGER NOT NULL,
                category TEXT    NOT NULL,
                limit_   REAL    NOT NULL,
                PRIMARY KEY (user_id, category)
            )
            """
        )


def add(user_id: int, amount: float, category: str, comment: str = "") -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO operations (user_id, amount, category, comment, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, amount, category, comment, datetime.now().isoformat(timespec="seconds")),
        )
        return cur.lastrowid


def balance(user_id: int) -> float:
    with connect() as conn:
        row = conn.execute("SELECT COALESCE(SUM(amount), 0) FROM operations WHERE user_id = ?", (user_id,)).fetchone()
        return row[0]


def history(user_id: int, limit: int = 10) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM operations WHERE user_id = ? ORDER BY id DESC LIMIT ?", (user_id, limit)
        ).fetchall()


def all_operations(user_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM operations WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()


def delete(user_id: int, op_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM operations WHERE user_id = ? AND id = ?", (user_id, op_id))
        return cur.rowcount > 0


def last_id(user_id: int) -> int | None:
    with connect() as conn:
        row = conn.execute("SELECT MAX(id) FROM operations WHERE user_id = ?", (user_id,)).fetchone()
        return row[0]


def stats(user_id: int, since: str) -> tuple[float, float, list[sqlite3.Row]]:
    """Доходы, расходы и расходы по категориям начиная с даты since (ISO)."""
    with connect() as conn:
        income, expense = conn.execute(
            """
            SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0),
                   COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0)
            FROM operations WHERE user_id = ? AND created_at >= ?
            """,
            (user_id, since),
        ).fetchone()
        by_cat = conn.execute(
            """
            SELECT category, -SUM(amount) AS total FROM operations
            WHERE user_id = ? AND created_at >= ? AND amount < 0
            GROUP BY category ORDER BY total DESC
            """,
            (user_id, since),
        ).fetchall()
        return income, expense, by_cat


def set_budget(user_id: int, category: str, limit_: float) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO budgets (user_id, category, limit_) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, category) DO UPDATE SET limit_ = excluded.limit_",
            (user_id, category, limit_),
        )


def budgets(user_id: int) -> dict[str, float]:
    with connect() as conn:
        rows = conn.execute("SELECT category, limit_ FROM budgets WHERE user_id = ?", (user_id,)).fetchall()
        return {r["category"]: r["limit_"] for r in rows}


def spent_in_category(user_id: int, category: str, since: str) -> float:
    with connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(-SUM(amount), 0) FROM operations "
            "WHERE user_id = ? AND category = ? AND amount < 0 AND created_at >= ?",
            (user_id, category, since),
        ).fetchone()
        return row[0]
