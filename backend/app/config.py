from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env.local",
        env_file_encoding="utf-8-sig", extra="ignore",
    )
    supabase_url: str | None = None
    supabase_anon_key: SecretStr | None = None


@lru_cache
def get_settings():
    return Settings()
