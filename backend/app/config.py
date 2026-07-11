from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase
    supabase_url: str
    supabase_service_role_key: str   # server-side only — never sent to client
    supabase_anon_key: str           # safe to use in backend for user-scoped operations

    # AI — platform defaults (used when user has no BYOK key)
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    default_ai_provider: str = "anthropic"
    default_anthropic_model: str = "claude-sonnet-4-6"
    default_openai_model: str = "gpt-4o"

    # BYOK encryption — AES-256 Fernet key, base64-encoded (see .env.example for generation cmd)
    byok_encryption_key: str

    # App
    app_env: str = "development"
    cors_origins: list[str] = ["http://localhost:5173"]
    max_agent_iterations: int = 20


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
