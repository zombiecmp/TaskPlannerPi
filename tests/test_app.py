import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import create_app


class TaskPlannerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database = str(Path(self.temp_dir.name) / "test.sqlite3")
        self.app = create_app({"TESTING": True, "DATABASE": database})
        self.client = self.app.test_client()
        self.member_id = self.client.get("/api/members").get_json()[0]["id"]

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_task(self, **overrides):
        task = {
            "title": "Feed the cat",
            "details": "Use the blue scoop",
            "assigned_to": self.member_id,
            "due_at": "2030-05-01T08:30",
        }
        task.update(overrides)
        return self.client.post("/api/tasks", json=task)

    def test_create_list_complete_and_filter_task(self):
        created = self.create_task()
        self.assertEqual(created.status_code, 201)
        task_id = created.get_json()["id"]

        self.assertEqual(len(self.client.get("/api/tasks").get_json()), 1)
        completed = self.client.patch(
            f"/api/tasks/{task_id}", json={"completed": True}
        )
        self.assertEqual(completed.get_json()["completed"], 1)
        self.assertEqual(self.client.get("/api/tasks").get_json(), [])
        self.assertEqual(len(self.client.get("/api/tasks?status=done").get_json()), 1)

    def test_task_validation_and_missing_member(self):
        self.assertEqual(self.client.post("/api/tasks", json={}).status_code, 400)
        response = self.create_task(assigned_to=9999)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/tasks?status=unknown").status_code, 400)

    def test_update_and_delete_task(self):
        task_id = self.create_task().get_json()["id"]
        updated = self.client.patch(
            f"/api/tasks/{task_id}", json={"title": "Give the cat breakfast"}
        )
        self.assertEqual(updated.get_json()["title"], "Give the cat breakfast")
        self.assertEqual(self.client.delete(f"/api/tasks/{task_id}").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/tasks/{task_id}").status_code, 404)

    def test_members_can_be_renamed_and_not_removed_with_tasks(self):
        renamed = self.client.patch(
            f"/api/members/{self.member_id}",
            json={"name": "Alex", "avatar": "😎"},
        )
        self.assertEqual(renamed.get_json()["name"], "Alex")
        self.assertEqual(renamed.get_json()["avatar"], "😎")
        self.create_task()
        self.assertEqual(
            self.client.delete(f"/api/members/{self.member_id}").status_code, 409
        )

    def test_member_face_icon_validation(self):
        created = self.client.post(
            "/api/members", json={"name": "Sam", "avatar": "🤗"}
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()["avatar"], "🤗")
        invalid = self.client.post(
            "/api/members", json={"name": "Invalid", "avatar": "not-an-icon"}
        )
        self.assertEqual(invalid.status_code, 400)
        invalid_update = self.client.patch(
            f"/api/members/{self.member_id}", json={"avatar": "not-an-icon"}
        )
        self.assertEqual(invalid_update.status_code, 400)

    def test_task_tags_can_be_managed_and_assigned(self):
        tag = self.client.post("/api/tags", json={"name": "Errands"})
        self.assertEqual(tag.status_code, 201)
        tag_id = tag.get_json()["id"]
        created = self.create_task(title="Pick up groceries", tag_id=tag_id)
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()["tag"], "Errands")
        self.assertEqual(
            len(self.client.get(f"/api/tasks?tag_id={tag_id}").get_json()), 1
        )
        self.assertEqual(self.client.delete(f"/api/tags/{tag_id}").status_code, 409)

        renamed = self.client.patch(
            f"/api/tags/{tag_id}", json={"name": "Shopping"}
        )
        self.assertEqual(renamed.get_json()["name"], "Shopping")
        self.assertEqual(
            self.client.get(f"/api/tasks?tag_id={tag_id}").get_json()[0]["tag"],
            "Shopping",
        )

        task_id = created.get_json()["id"]
        updated = self.client.patch(f"/api/tasks/{task_id}", json={"tag_id": None})
        self.assertIsNone(updated.get_json()["tag"])
        self.assertEqual(self.client.delete(f"/api/tags/{tag_id}").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/tags/{tag_id}").status_code, 404)

    def test_task_rejects_unknown_tag(self):
        response = self.create_task(tag_id=9999)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/tasks?tag_id=invalid").status_code, 400)

    def test_deleted_all_tags_are_not_reseeded_on_restart(self):
        tags = self.client.get("/api/tags").get_json()
        for tag in tags:
            response = self.client.delete(f"/api/tags/{tag['id']}")
            self.assertEqual(response.status_code, 204)

        restarted_app = create_app(
            {"TESTING": True, "DATABASE": self.app.config["DATABASE"]}
        )
        self.assertEqual(restarted_app.test_client().get("/api/tags").get_json(), [])

    def test_existing_database_migrates_members_and_tasks(self):
        database = str(Path(self.temp_dir.name) / "legacy.sqlite3")
        with sqlite3.connect(database) as db:
            db.executescript(
                """
                CREATE TABLE members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    details TEXT NOT NULL DEFAULT '',
                    assigned_to INTEGER NOT NULL REFERENCES members(id),
                    due_at TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT
                );
                INSERT INTO members (id, name, created_at)
                VALUES (1, 'Alex', '2026-01-01T00:00:00+00:00');
                INSERT INTO tasks
                    (id, title, details, assigned_to, due_at, created_at, updated_at)
                VALUES
                    (1, 'Old task', '', 1, '2030-05-01T08:30',
                     '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00');
                """
            )

        migrated_app = create_app({"TESTING": True, "DATABASE": database})
        migrated_client = migrated_app.test_client()
        member = migrated_client.get("/api/members").get_json()[0]
        task = migrated_client.get("/api/tasks?status=all").get_json()[0]
        self.assertEqual(member["name"], "Alex")
        self.assertEqual(member["avatar"], "🙂")
        self.assertEqual(task["title"], "Old task")
        self.assertIsNone(task["tag_id"])
        self.assertIsNone(task["tag"])

    def test_filter_tasks_by_due_date_and_assignee(self):
        other_member = self.client.post(
            "/api/members", json={"name": "Sam"}
        ).get_json()["id"]
        self.create_task(title="Morning chore", due_at="2030-05-01T08:30")
        self.create_task(
            title="Evening chore",
            due_at="2030-05-02T18:00",
            assigned_to=other_member,
        )

        by_date = self.client.get("/api/tasks?due_on=2030-05-01").get_json()
        self.assertEqual([task["title"] for task in by_date], ["Morning chore"])
        by_assignee = self.client.get(
            f"/api/tasks?assigned_to={other_member}"
        ).get_json()
        self.assertEqual([task["title"] for task in by_assignee], ["Evening chore"])
        combined = self.client.get(
            f"/api/tasks?due_on=2030-05-02&assigned_to={other_member}"
        ).get_json()
        self.assertEqual(len(combined), 1)
        self.assertEqual(
            self.client.get("/api/tasks?due_on=2030-02-30").status_code, 400
        )
        self.assertEqual(
            self.client.get("/api/tasks?assigned_to=invalid").status_code, 400
        )

    def test_completed_tasks_expire_seven_days_after_completion(self):
        task_id = self.create_task().get_json()["id"]
        completed = self.client.patch(
            f"/api/tasks/{task_id}", json={"completed": True}
        ).get_json()
        self.assertIsNotNone(completed["completed_at"])

        expired_at = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat(
            timespec="seconds"
        )
        with sqlite3.connect(self.app.config["DATABASE"]) as db:
            db.execute(
                "UPDATE tasks SET completed_at = ? WHERE id = ?",
                (expired_at, task_id),
            )
        self.assertEqual(self.client.get("/api/tasks?status=done").get_json(), [])

    def test_reopening_task_clears_completion_timestamp(self):
        task_id = self.create_task().get_json()["id"]
        self.client.patch(f"/api/tasks/{task_id}", json={"completed": True})
        reopened = self.client.patch(
            f"/api/tasks/{task_id}", json={"completed": False}
        ).get_json()
        self.assertEqual(reopened["completed"], 0)
        self.assertIsNone(reopened["completed_at"])


if __name__ == "__main__":
    unittest.main()
