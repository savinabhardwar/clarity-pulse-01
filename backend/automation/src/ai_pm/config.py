from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    supabase_url: str = ""
    supabase_service_role_key: str = field(default="", repr=False)
    jira_base_url: str = ""
    jira_email: str = ""
    jira_api_token: str = field(default="", repr=False)
    github_webhook_secret: str = field(default="", repr=False)
    ingest_trigger_secret: str = field(default="", repr=False)
    requirements_app_supabase_url: str = ""
    requirements_app_supabase_key: str = field(default="", repr=False)

    @classmethod
    def from_bindings(cls, env):
        return cls(**{name: getattr(env, name.upper(), "") for name in cls.__dataclass_fields__})
