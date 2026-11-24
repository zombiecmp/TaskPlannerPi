import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request


DEFAULT_MEMBERS = ("Me", "Wife", "Son")
DEFAULT_AVATAR = "happy"
AVATAR_OPTIONS = (
    "happy",
    "grin",
    "cool",
    "glasses",
    "love",
    "sleepy",
    "surprised",
    "wink",
)
LEGACY_AVATARS = {
    "🙂": "happy",
    "😀": "grin",
    "😎": "cool",
    "🤓": "glasses",
    "🥰": "love",
    "😁": "surprised",
    "😴": "sleepy",
    "🤗": "wink",
}
DEFAULT_TAGS = ("Home", "School", "Chores")


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        DATABASE=os.environ.get(
            "TASK_PLANNER_DB",
            str(Path(app.instance_path) / "task_planner.sqlite3"),
        ),
        SECRET_KEY=os.environ.get("TASK_PLANNER_SECRET", "local-family-planner"),
    )
    if test_config:
        app.config.update(test_config)

    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db():
        db = get_db()
        tags_table_existed = (
            db.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tags'"
            ).fetchone()
            is not None
        )
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                avatar TEXT NOT NULL DEFAULT 'happy',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                assigned_to INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                due_at TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                recipient_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
                content TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
            CREATE INDEX IF NOT EXISTS idx_messages_recipient
                ON messages(recipient_id, is_read, created_at);
            """
        )
        if db.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 0:
            now = _utc_now()
            db.executemany(
                "INSERT INTO members (name, avatar, created_at) VALUES (?, ?, ?)",
                [(name, DEFAULT_AVATAR, now) for name in DEFAULT_MEMBERS],
            )
        if not tags_table_existed:
            now = _utc_now()
            db.executemany(
                "INSERT INTO tags (name, created_at) VALUES (?, ?)",
                [(name, now) for name in DEFAULT_TAGS],
            )
        member_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(members)").fetchall()
        }
        if "avatar" not in member_columns:
            db.execute(
                "ALTER TABLE members ADD COLUMN avatar TEXT NOT NULL DEFAULT 'happy'"
            )
        for legacy_avatar, avatar_key in LEGACY_AVATARS.items():
            db.execute(
                "UPDATE members SET avatar = ? WHERE avatar = ?",
                (avatar_key, legacy_avatar),
            )
        db.execute(
            "UPDATE members SET avatar = ? WHERE avatar NOT IN (?, ?, ?, ?, ?, ?, ?, ?)",
            (DEFAULT_AVATAR, *AVATAR_OPTIONS),
        )
        columns = {
            row["name"] for row in db.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if "tag_id" not in columns:
            db.execute(
                "ALTER TABLE tasks ADD COLUMN tag_id INTEGER REFERENCES tags(id) ON DELETE RESTRICT"
            )
        columns = {
            row["name"] for row in db.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if "completed_at" not in columns:
            db.execute("ALTER TABLE tasks ADD COLUMN completed_at TEXT")
            db.execute(
                """
                UPDATE tasks SET completed_at = updated_at
                WHERE completed = 1 AND completed_at IS NULL
                """
            )
        db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_tag_id ON tasks(tag_id)")
        db.commit()
        _cleanup_completed_tasks(db)

    with app.app_context():
        init_db()

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/members")
    def list_members():
        members = get_db().execute(
            "SELECT id, name, avatar FROM members ORDER BY id"
        ).fetchall()
        return jsonify([dict(member) for member in members])

    @app.post("/api/members")
    def create_member():
        data = _json_body()
        name, error = _text_value(data, "name", required=True, max_length=40)
        if error:
            return _error(error)
        avatar, error = _avatar_value(data.get("avatar", DEFAULT_AVATAR))
        if error:
            return _error(error)
        try:
            db = get_db()
            cursor = db.execute(
                "INSERT INTO members (name, avatar, created_at) VALUES (?, ?, ?)",
                (name, avatar, _utc_now()),
            )
            db.commit()
        except sqlite3.IntegrityError:
            return _error("That household member already exists.", 409)
        return jsonify({"id": cursor.lastrowid, "name": name, "avatar": avatar}), 201

    @app.patch("/api/members/<int:member_id>")
    def rename_member(member_id):
        data = _json_body()
        updates = []
        values = []
        if "name" in data:
            name, error = _text_value(data, "name", required=True, max_length=40)
            if error:
                return _error(error)
            updates.append("name = ?")
            values.append(name)
        if "avatar" in data:
            avatar, error = _avatar_value(data["avatar"])
            if error:
                return _error(error)
            updates.append("avatar = ?")
            values.append(avatar)
        if not updates:
            return _error("Provide a name or face icon to update.")
        try:
            db = get_db()
            values.append(member_id)
            cursor = db.execute(
                f"UPDATE members SET {', '.join(updates)} WHERE id = ?", values
            )
            if cursor.rowcount == 0:
                return _error("Household member not found.", 404)
            db.commit()
        except sqlite3.IntegrityError:
            return _error("That household member already exists.", 409)
        member = db.execute(
            "SELECT id, name, avatar FROM members WHERE id = ?", (member_id,)
        ).fetchone()
        return jsonify(dict(member))

    @app.delete("/api/members/<int:member_id>")
    def delete_member(member_id):
        db = get_db()
        member = db.execute(
            "SELECT id FROM members WHERE id = ?", (member_id,)
        ).fetchone()
        if member is None:
            return _error("Household member not found.", 404)
        assigned_count = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE assigned_to = ?", (member_id,)
        ).fetchone()[0]
        message_count = db.execute(
            "SELECT COUNT(*) FROM messages WHERE sender_id = ? OR recipient_id = ?",
            (member_id, member_id),
        ).fetchone()[0]
        if assigned_count or message_count:
            return _error(
                "Remove this member's tasks and messages before removing them.", 409
            )
        db.execute("DELETE FROM members WHERE id = ?", (member_id,))
        db.commit()
        return "", 204

    @app.get("/api/messages")
    def list_messages():
        recipient_id = request.args.get("recipient_id")
        if not recipient_id or not recipient_id.isdigit() or int(recipient_id) < 1:
            return _error("Choose a valid household member to view messages.")
        db = get_db()
        if not _member_exists(db, int(recipient_id)):
            return _error("Choose a household member that still exists.")
        messages = db.execute(
            """
            SELECT messages.id, messages.sender_id, sender.name AS sender,
                   sender.avatar AS sender_avatar, messages.recipient_id,
                   recipient.name AS recipient, messages.content,
                   messages.is_read, messages.created_at
            FROM messages
            JOIN members AS sender ON sender.id = messages.sender_id
            JOIN members AS recipient ON recipient.id = messages.recipient_id
            WHERE messages.recipient_id = ?
            ORDER BY messages.is_read ASC, messages.created_at DESC, messages.id DESC
            """,
            (int(recipient_id),),
        ).fetchall()
        return jsonify([dict(message) for message in messages])

    @app.post("/api/messages")
    def create_message():
        data = _json_body()
        sender_id = data.get("sender_id")
        if isinstance(sender_id, bool) or not isinstance(sender_id, int) or sender_id < 1:
            return _error("Choose a valid household member as the sender.")
        recipient_id = data.get("recipient_id")
        if (
            isinstance(recipient_id, bool)
            or not isinstance(recipient_id, int)
            or recipient_id < 1
        ):
            return _error("Choose a valid household member as the recipient.")
        content, error = _text_value(data, "content", required=True, max_length=2000)
        if error:
            return _error(error)
        db = get_db()
        if not _member_exists(db, sender_id):
            return _error("Choose a sender that still exists.")
        if not _member_exists(db, recipient_id):
            return _error("Choose a recipient that still exists.")
        cursor = db.execute(
            """
            INSERT INTO messages (sender_id, recipient_id, content, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (sender_id, recipient_id, content, _utc_now()),
        )
        db.commit()
        return jsonify(dict(_get_message(db, cursor.lastrowid))), 201

    @app.patch("/api/messages/<int:message_id>")
    def update_message(message_id):
        data = _json_body()
        if "is_read" not in data or not isinstance(data["is_read"], bool):
            return _error("Read status must be true or false.")
        db = get_db()
        cursor = db.execute(
            "UPDATE messages SET is_read = ? WHERE id = ?",
            (int(data["is_read"]), message_id),
        )
        if cursor.rowcount == 0:
            return _error("Message not found.", 404)
        db.commit()
        return jsonify(dict(_get_message(db, message_id)))

    @app.delete("/api/messages/<int:message_id>")
    def delete_message(message_id):
        db = get_db()
        cursor = db.execute("DELETE FROM messages WHERE id = ?", (message_id,))
        if cursor.rowcount == 0:
            return _error("Message not found.", 404)
        db.commit()
        return "", 204

    @app.get("/api/tags")
    def list_tags():
        tags = get_db().execute("SELECT id, name FROM tags ORDER BY name").fetchall()
        return jsonify([dict(tag) for tag in tags])

    @app.post("/api/tags")
    def create_tag():
        data = _json_body()
        name, error = _text_value(data, "name", required=True, max_length=40)
        if error:
            return _error(error)
        try:
            db = get_db()
            cursor = db.execute(
                "INSERT INTO tags (name, created_at) VALUES (?, ?)",
                (name, _utc_now()),
            )
            db.commit()
        except sqlite3.IntegrityError:
            return _error("That tag already exists.", 409)
        return jsonify({"id": cursor.lastrowid, "name": name}), 201

    @app.patch("/api/tags/<int:tag_id>")
    def rename_tag(tag_id):
        data = _json_body()
        name, error = _text_value(data, "name", required=True, max_length=40)
        if error:
            return _error(error)
        try:
            db = get_db()
            cursor = db.execute(
                "UPDATE tags SET name = ? WHERE id = ?", (name, tag_id)
            )
            if cursor.rowcount == 0:
                return _error("Tag not found.", 404)
            db.commit()
        except sqlite3.IntegrityError:
            return _error("That tag already exists.", 409)
        return jsonify({"id": tag_id, "name": name})

    @app.delete("/api/tags/<int:tag_id>")
    def delete_tag(tag_id):
        db = get_db()
        tag = db.execute("SELECT id FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if tag is None:
            return _error("Tag not found.", 404)
        task_count = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE tag_id = ?", (tag_id,)
        ).fetchone()[0]
        if task_count:
            return _error(
                "Remove this tag from its tasks before deleting it.", 409
            )
        db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        db.commit()
        return "", 204

    @app.get("/api/tasks")
    def list_tasks():
        status = request.args.get("status", "open")
        if status not in ("open", "done", "all"):
            return _error("Status must be open, done, or all.")
        conditions = []
        parameters = []
        if status == "open":
            conditions.append("t.completed = 0")
        elif status == "done":
            conditions.append("t.completed = 1")
        assignee = request.args.get("assigned_to")
        if assignee:
            if not assignee.isdigit() or int(assignee) < 1:
                return _error("Assignee must be a valid household member ID.")
            conditions.append("t.assigned_to = ?")
            parameters.append(int(assignee))
        due_on = request.args.get("due_on")
        if due_on:
            try:
                parsed_date = datetime.strptime(due_on, "%Y-%m-%d").date()
            except ValueError:
                return _error("Due date must use YYYY-MM-DD format.")
            if parsed_date.isoformat() != due_on:
                return _error("Due date must use YYYY-MM-DD format.")
            conditions.append("substr(t.due_at, 1, 10) = ?")
            parameters.append(due_on)
        tag_id = request.args.get("tag_id")
        if tag_id:
            if not tag_id.isdigit() or int(tag_id) < 1:
                return _error("Tag must be a valid tag ID.")
            conditions.append("t.tag_id = ?")
            parameters.append(int(tag_id))
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        db = get_db()
        _cleanup_completed_tasks(db)
        tasks = get_db().execute(
            f"""
            SELECT t.id, t.title, t.details, t.assigned_to, m.name AS assignee,
                   m.avatar AS assignee_avatar, t.tag_id, tags.name AS tag,
                   t.due_at, t.completed, t.completed_at
            FROM tasks AS t
            JOIN members AS m ON m.id = t.assigned_to
            LEFT JOIN tags ON tags.id = t.tag_id
            {where_clause}
            ORDER BY t.completed ASC, t.due_at ASC, t.id DESC
            """,
            parameters,
        ).fetchall()
        return jsonify([dict(task) for task in tasks])

    @app.post("/api/tasks")
    def create_task():
        data = _json_body()
        values, error = _task_values(data, creating=True)
        if error:
            return _error(error)
        db = get_db()
        if not _member_exists(db, values["assigned_to"]):
            return _error("Choose a household member that still exists.")
        if values["tag_id"] is not None and not _tag_exists(db, values["tag_id"]):
            return _error("Choose a tag that still exists.")
        now = _utc_now()
        cursor = db.execute(
            """
            INSERT INTO tasks
                (title, details, assigned_to, due_at, tag_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                values["title"],
                values["details"],
                values["assigned_to"],
                values["due_at"],
                values["tag_id"],
                now,
                now,
            ),
        )
        db.commit()
        task = _get_task(db, cursor.lastrowid)
        return jsonify(dict(task)), 201

    @app.patch("/api/tasks/<int:task_id>")
    def update_task(task_id):
        data = _json_body()
        db = get_db()
        existing = _get_task(db, task_id)
        if existing is None:
            return _error("Task not found.", 404)
        values, error = _task_values(data, creating=False, existing=existing)
        if error:
            return _error(error)
        if "assigned_to" in data and not _member_exists(db, values["assigned_to"]):
            return _error("Choose a household member that still exists.")
        if (
            values["tag_id"] is not None
            and "tag_id" in data
            and not _tag_exists(db, values["tag_id"])
        ):
            return _error("Choose a tag that still exists.")
        if "completed" in data and not isinstance(data["completed"], bool):
            return _error("Completed must be true or false.")
        completed = int(data.get("completed", existing["completed"]))
        db.execute(
            """
            UPDATE tasks
            SET title = ?, details = ?, assigned_to = ?, due_at = ?, tag_id = ?,
                completed = ?, completed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                values["title"],
                values["details"],
                values["assigned_to"],
                values["due_at"],
                values["tag_id"],
                completed,
                (
                    existing["completed_at"] or _utc_now()
                    if completed
                    else None
                ),
                _utc_now(),
                task_id,
            ),
        )
        db.commit()
        return jsonify(dict(_get_task(db, task_id)))

    @app.delete("/api/tasks/<int:task_id>")
    def delete_task(task_id):
        db = get_db()
        cursor = db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if cursor.rowcount == 0:
            return _error("Task not found.", 404)
        db.commit()
        return "", 204

    return app


def _utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _text_value(data, key, required=False, max_length=2000):
    value = data.get(key)
    if value is None:
        value = ""
    if not isinstance(value, str):
        return None, f"{key.replace('_', ' ').capitalize()} must be text."
    value = value.strip()
    if required and not value:
        return None, f"{key.replace('_', ' ').capitalize()} is required."
    if len(value) > max_length:
        return None, f"{key.replace('_', ' ').capitalize()} is too long."
    return value, None


def _task_values(data, creating, existing=None):
    existing = existing or {}
    values = {}
    for key, required, max_length in (
        ("title", True, 120),
        ("details", False, 2000),
    ):
        if key in data or creating:
            value, error = _text_value(data, key, required, max_length)
            if error:
                return None, error
            values[key] = value
        else:
            values[key] = existing[key]

    if "assigned_to" in data or creating:
        assigned_to = data.get("assigned_to")
        if isinstance(assigned_to, bool) or not isinstance(assigned_to, int):
            return None, "Assign the task to a household member."
        values["assigned_to"] = assigned_to
    else:
        values["assigned_to"] = existing["assigned_to"]

    if "due_at" in data or creating:
        due_at = data.get("due_at")
        if not isinstance(due_at, str):
            return None, "A due date and time are required."
        try:
            parsed = datetime.fromisoformat(due_at)
        except ValueError:
            return None, "Enter a valid due date and time."
        if parsed.tzinfo is not None:
            return None, "Due date and time must use the household's local time."
        values["due_at"] = parsed.strftime("%Y-%m-%dT%H:%M")
    else:
        values["due_at"] = existing["due_at"]
    if "tag_id" in data or creating:
        tag_id = data.get("tag_id")
        if tag_id is not None and (
            isinstance(tag_id, bool) or not isinstance(tag_id, int) or tag_id < 1
        ):
            return None, "Choose a valid tag or leave the task untagged."
        values["tag_id"] = tag_id
    else:
        values["tag_id"] = existing["tag_id"]
    return values, None


def _avatar_value(value):
    if not isinstance(value, str) or value not in AVATAR_OPTIONS:
        return None, "Choose one of the available face icons."
    return value, None


def _member_exists(db, member_id):
    return (
        db.execute("SELECT 1 FROM members WHERE id = ?", (member_id,)).fetchone()
        is not None
    )


def _tag_exists(db, tag_id):
    return db.execute("SELECT 1 FROM tags WHERE id = ?", (tag_id,)).fetchone() is not None


def _get_task(db, task_id):
    return db.execute(
        """
        SELECT t.id, t.title, t.details, t.assigned_to, m.name AS assignee,
               m.avatar AS assignee_avatar, t.tag_id, tags.name AS tag,
               t.due_at, t.completed, t.completed_at
        FROM tasks AS t
        JOIN members AS m ON m.id = t.assigned_to
        LEFT JOIN tags ON tags.id = t.tag_id
        WHERE t.id = ?
        """,
        (task_id,),
    ).fetchone()


def _get_message(db, message_id):
    return db.execute(
        """
        SELECT messages.id, messages.sender_id, sender.name AS sender,
               sender.avatar AS sender_avatar, messages.recipient_id,
               recipient.name AS recipient, messages.content,
               messages.is_read, messages.created_at
        FROM messages
        JOIN members AS sender ON sender.id = messages.sender_id
        JOIN members AS recipient ON recipient.id = messages.recipient_id
        WHERE messages.id = ?
        """,
        (message_id,),
    ).fetchone()


def _cleanup_completed_tasks(db):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(
        timespec="seconds"
    )
    db.execute(
        """
        DELETE FROM tasks
        WHERE completed = 1 AND completed_at IS NOT NULL AND completed_at <= ?
        """,
        (cutoff,),
    )
    db.commit()


def _error(message, status=400):
    return jsonify({"error": message}), status


app = create_app()


if __name__ == "__main__":
    app.run(
        host=os.environ.get("TASK_PLANNER_HOST", "127.0.0.1"),
        port=int(os.environ.get("TASK_PLANNER_PORT", "5000")),
        debug=False,
    )
