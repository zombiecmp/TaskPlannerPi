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
            f"/api/members/{self.member_id}", json={"name": "Alex"}
        )
        self.assertEqual(renamed.get_json()["name"], "Alex")
        self.create_task()
        self.assertEqual(
            self.client.delete(f"/api/members/{self.member_id}").status_code, 409
        )

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
