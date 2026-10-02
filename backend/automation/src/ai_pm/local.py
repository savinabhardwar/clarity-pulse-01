"""Local ASGI entrypoint. Queue binding is injected in tests or Workers."""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

from ai_pm.api import create_app
from ai_pm.config import Config


class LocalSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / ".env.local", extra="ignore")
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    jira_base_url: str = ""
    jira_email: str = ""
    jira_api_token: str = ""
    github_webhook_secret: str = ""
    ingest_trigger_secret: str = ""
    requirements_app_supabase_url: str = ""
    requirements_app_supabase_key: str = ""


app = create_app(Config(**LocalSettings().model_dump()))
