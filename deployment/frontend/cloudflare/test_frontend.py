import json
from pathlib import Path
import tempfile
import unittest
import yaml
import prepare


class FrontendDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo=Path(self.temporary.name)
        (self.repo / "frontend/.output/server").mkdir(parents=True)
        (self.repo / "frontend/.output/public").mkdir()
        (self.repo / "frontend/.output/server/index.mjs").write_text("export default {}")
        (self.repo / "frontend/.output/nitro.json").write_text(json.dumps({"preset":"cloudflare-module"}))
        self.settings=json.loads((prepare.HERE / "service.json").read_text())
        self.env={"GITHUB_REF":"refs/heads/staging", "GITHUB_EVENT_NAME":"push", "CLOUDFLARE_FRONTEND_WORKER_NAME":"fixture-frontend-staging", "CLOUDFLARE_ACCOUNT_ID":"a"*32, "FRONTEND_BACKEND_URL":self.settings["stagingBackendUrl"]}

    def test_staging_preserves_bundle_assets_and_runtime_backend_binding(self):
        file=prepare.prepare(self.repo,self.env)
        config=json.loads(file.read_text())
        self.assertEqual(config["name"], "fixture-frontend-staging")
        self.assertEqual(config["main"], "index.mjs")
        self.assertEqual(config["assets"]["directory"], "../public")
        self.assertEqual(config["vars"], {self.settings["backendVariable"]:self.settings["stagingBackendUrl"]})
        self.assertIn("nodejs_compat", config["compatibility_flags"])

    def test_main_uses_a_separate_worker_and_api(self):
        file=prepare.prepare(self.repo,{**self.env,"GITHUB_REF":"refs/heads/main","CLOUDFLARE_FRONTEND_WORKER_NAME":"fixture-frontend","FRONTEND_BACKEND_URL":"https://api.example.com"})
        self.assertEqual(file.name,"wrangler.production.json")
        self.assertEqual(json.loads(file.read_text())["name"], "fixture-frontend")

    def test_staging_cannot_target_production_worker_or_api(self):
        for overrides in ({"CLOUDFLARE_FRONTEND_WORKER_NAME":"fixture-frontend"},{"FRONTEND_BACKEND_URL":"https://api.example.com"}):
            with self.assertRaises(ValueError):
                prepare.prepare(self.repo,{**self.env,**overrides})

    def test_main_cannot_target_staging_worker_or_api(self):
        for overrides in ({"FRONTEND_BACKEND_URL":"https://api.example.com"},{"CLOUDFLARE_FRONTEND_WORKER_NAME":"fixture-frontend"}):
            with self.assertRaises(ValueError):
                prepare.prepare(self.repo,{**self.env,"GITHUB_REF":"refs/heads/main",**overrides})

    def test_missing_settings_insecure_urls_and_unsupported_events_are_rejected(self):
        for overrides in ({"GITHUB_REF":"refs/heads/feature"},{"GITHUB_EVENT_NAME":"pull_request"},{"CLOUDFLARE_ACCOUNT_ID":""},{"CLOUDFLARE_FRONTEND_WORKER_NAME":""},{"FRONTEND_BACKEND_URL":"http://localhost:8001"},{"FRONTEND_BACKEND_URL":"https://user:password@example.com"}):
            with self.assertRaises(ValueError):
                prepare.prepare(self.repo,{**self.env,**overrides})

    def test_build_output_is_required(self):
        (self.repo / "frontend/.output/server/index.mjs").unlink()
        with self.assertRaises(ValueError):
            prepare.prepare(self.repo,self.env)

    def test_workflow_uses_environment_secrets_and_explicit_cloudflare_target(self):
        workflow=yaml.load((prepare.REPOSITORY / ".github/workflows/deploy-frontend-cloudflare.yml").read_text(),Loader=yaml.BaseLoader)
        self.assertEqual(workflow["on"]["push"]["branches"],["main","staging"])
        job=workflow["jobs"]["deploy"]
        self.assertIn("'production' || 'staging'",job["environment"]["name"])
        action=next(step for step in job["steps"] if step.get("id")=="deploy")
        self.assertEqual(action["uses"],"cloudflare/wrangler-action@v4")
        self.assertIn("--config",action["with"]["command"])
        self.assertEqual(job["env"]["NITRO_PRESET"],"cloudflare-module")

    def test_non_cloudflare_build_is_rejected(self):
        (self.repo / "frontend/.output/nitro.json").write_text(json.dumps({"preset":"netlify"}))
        with self.assertRaises(ValueError):
            prepare.prepare(self.repo,self.env)
