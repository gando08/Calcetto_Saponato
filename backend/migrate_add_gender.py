"""
Migration: add gender and max_teams columns to tournaments table.

Run once on an existing database:
    py -3.13 migrate_add_gender.py

Safe to re-run (checks for existing columns first).
"""

import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "tournament.db")


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cursor = conn.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def migrate() -> None:
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH} – nothing to migrate.")
        return

    conn = sqlite3.connect(DB_PATH)
    try:
        added = []
        if not column_exists(conn, "tournaments", "gender"):
            conn.execute("ALTER TABLE tournaments ADD COLUMN gender VARCHAR")
            added.append("gender")
        if not column_exists(conn, "tournaments", "max_teams"):
            conn.execute("ALTER TABLE tournaments ADD COLUMN max_teams INTEGER")
            added.append("max_teams")
        conn.commit()
        if added:
            print(f"Migration OK – added columns: {', '.join(added)}")
        else:
            print("Migration skipped – columns already exist.")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
