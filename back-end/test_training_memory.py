import unittest

from training_memory import retrieve


class TrainingMemoryTests(unittest.TestCase):
    def setUp(self):
        self.memory = {"enabled": True, "entries": [
            {"id": "support", "title": "Support choices", "text": "Consider creative support combinations.", "topics": ["support"]},
            {"id": "profile-role", "title": "Usual role", "text": "I usually play support.", "topics": ["player"], "kind": "profile", "field": "role"}]}

    def test_shared_memory_is_relevant_without_turning_profile_role_into_a_match_fact(self):
        text, used = retrieve(self.memory, "Which support should I pick?", "quick")
        self.assertEqual([item["id"] for item in used], ["support"])
        self.assertIn("not match facts", text)
        self.assertNotIn("I usually play support", text)
        text, used = retrieve(self.memory, "Recommend something for my champion pool", "coach")
        self.assertIn("profile-role", [item["id"] for item in used])

    def test_paused_memories_greetings_and_followups(self):
        self.assertEqual(retrieve(self.memory, "Hello\nWhich support should I pick?", "quick"), ("", []))
        self.assertEqual(retrieve({**self.memory, "enabled": False}, "Which support?", "coach"), ("", []))
        self.memory["entries"][0]["enabled"] = False
        self.assertEqual(retrieve(self.memory, "Which support?", "quick"), ("", []))
        self.memory["entries"][0]["enabled"] = True
        self.assertEqual(retrieve(self.memory, "为什么？\n选什么辅助", "coach")[1][0]["id"], "support")

    def test_memory_limits_are_smaller_for_coach(self):
        memory = {"entries": [{"id": str(index), "title": "Support", "text": "guidance " * 20, "topics": ["support"]} for index in range(20)]}
        quick, quick_used = retrieve(memory, "Which support?", "quick")
        coach, coach_used = retrieve(memory, "Which support?", "coach")
        self.assertLessEqual(len(quick_used), 6)
        self.assertLessEqual(len(coach_used), 3)
        self.assertLess(len(coach), len(quick))
