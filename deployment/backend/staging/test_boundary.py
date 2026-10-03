"""Offline checks for the staging destination and branch boundary."""
import json
from pathlib import Path
import tempfile
import unittest

import prepare


class StagingBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.settings = json.loads((prepare.HERE / "project.json").read_text())
        self.environment = {"GITHUB_REF": "refs/heads/staging", "GITHUB_EVENT_NAME": "push", "VERCEL_PROJECT_ID": self.settings["projectId"]}

    def test_main_and_other_branches_never_generate_files(self):
        for ref in ("refs/heads/main", "refs/heads/abhi-imp", "refs/pull/1/merge", ""):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                prepare.prepare(self.root, {**self.environment, "GITHUB_REF": ref})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_wrong_or_missing_project_never_generates_files(self):
        for project in ("prj_production", ""):
            with self.subTest(project=project), self.assertRaises(ValueError):
                prepare.prepare(self.root, {**self.environment, "VERCEL_PROJECT_ID": project})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_unsupported_events_never_generate_files(self):
        with self.assertRaises(ValueError):
            prepare.prepare(self.root, {**self.environment, "GITHUB_EVENT_NAME": "pull_request_target"})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_different_local_link_is_rejected(self):
        link=self.root / ".vercel/project.json"
        link.parent.mkdir()
        link.write_text(json.dumps({"projectId": "prj_production"}))
        with self.assertRaises(ValueError):
            prepare.prepare(self.root, self.environment)
        self.assertFalse((self.root / "backend/vercel.json").exists())

    def test_existing_config_cannot_be_overwritten(self):
        destination=self.root / ".vercelignore"
        destination.write_text("production rules")
        with self.assertRaises(ValueError):
            prepare.prepare(self.root, self.environment)
        self.assertEqual(destination.read_text(), "production rules")
        self.assertFalse((self.root / "backend/vercel.json").exists())

    def test_correct_project_and_staging_events_generate_and_clean(self):
        for event in ("push", "workflow_dispatch"):
            prepare.prepare(self.root, {**self.environment, "GITHUB_EVENT_NAME": event})
            config=json.loads((self.root / "backend/vercel.json").read_text())
            self.assertEqual(config["framework"], "fastapi")
            self.assertFalse(config["git"]["deploymentEnabled"])
            prepare.prepare(self.root, clean=True)
            for relative in prepare.FILES.values():
                self.assertFalse((self.root / relative).exists())

    def test_cleanup_preserves_changed_files(self):
        prepare.prepare(self.root, self.environment)
        destination=self.root / ".vercelignore"
        destination.write_text("changed by another task")
        prepare.prepare(self.root, clean=True)
        self.assertEqual(destination.read_text(), "changed by another task")

    def test_workflow_runs_tests_and_deployment_only_on_staging(self):
        import yaml
        workflow=yaml.load((prepare.REPOSITORY / ".github/workflows/deploy-backend-staging.yml").read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(workflow["on"]["push"]["branches"], ["staging"])
        for job in ("test", "deploy"):
            self.assertIn("github.ref == 'refs/heads/staging'", workflow["jobs"][job]["if"])
        deploy=workflow["jobs"]["deploy"]
        self.assertEqual(deploy["environment"]["name"], "staging")
        steps=deploy["steps"]
        commands=[step.get("run", "") for step in steps]
        preparation=commands.index("python deployment/backend/staging/prepare.py")
        self.assertLess(preparation, next(i for i, command in enumerate(commands) if "vercel pull" in command))
        self.assertEqual(steps[-1]["if"], "always()")

    def test_cleanup_never_removes_unowned_matching_files(self):
        destination=self.root / "backend/vercel.json"
        destination.parent.mkdir()
        destination.write_bytes((prepare.HERE / "vercel.json").read_bytes())
        prepare.prepare(self.root, clean=True)
        self.assertTrue(destination.exists())
