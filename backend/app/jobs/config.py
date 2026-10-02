"""Job-only credentials, kept separate from the public dashboard API."""

from pydantic import SecretStr
from pydantic import Field

from app.config import Settings


class JobSettings(Settings):
    database_url: SecretStr | None = None
    database_schema: str = Field(default="public", pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    jira_base_url: str | None = None
    jira_email: str | None = None
    jira_api_token: SecretStr | None = None
    jira_sprint_field: str = "customfield_10020"
    jira_qa_assignee_field: str = "customfield_10690"
    jira_qa_planned_hours_field: str = "customfield_10691"
    gemini_api_key: SecretStr | None = None
    cloudflare_account_id: str | None = None
    cloudflare_api_token: SecretStr | None = None
