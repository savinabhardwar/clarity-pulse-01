from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.config import Settings, get_settings
from app.dashboard import router
from app.supabase import SupabaseService


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None):
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application):
        async with httpx.AsyncClient(timeout=20, transport=transport) as client:
            application.state.supabase = SupabaseService(settings, client)
            yield

    application = FastAPI(title="ClarityPulse API", version="0.1.0", lifespan=lifespan)
    application.include_router(router, prefix="/api")

    @application.get("/api/health", tags=["health"])
    async def health():
        return {"status": "ok"}

    return application


app = create_app()
