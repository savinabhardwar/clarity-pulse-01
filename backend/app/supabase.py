"""Server-side Supabase transport using the dashboard's existing anon role."""

import httpx
from fastapi import HTTPException

from app.config import Settings


class SupabaseService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def request(self, method: str, resource: str, **kwargs):
        secret = self.settings.supabase_anon_key
        if not self.settings.supabase_url or not secret or not secret.get_secret_value():
            raise HTTPException(503, "Supabase is not configured")
        key = secret.get_secret_value()
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        headers.update(kwargs.pop("headers", {}))
        try:
            response = await self.client.request(
                method, f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{resource}",
                headers=headers, **kwargs,
            )
        except httpx.HTTPError:
            raise HTTPException(502, "Supabase is unavailable") from None
        if not response.is_success:
            raise HTTPException(502, "Supabase request failed")
        return response

    @staticmethod
    def json(response):
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise HTTPException(502, "Unexpected Supabase response") from None

    async def rows(self, table: str, **params):
        data = self.json(await self.request("GET", table, params={"select": "*", **params}))
        if not isinstance(data, list):
            raise HTTPException(502, "Unexpected Supabase response")
        return data

    async def rpc(self, name: str, payload: dict, **params):
        return self.json(await self.request("POST", f"rpc/{name}", json=payload, params=params))

    async def count(self, table: str, **filters):
        response = await self.request(
            "HEAD", table, params={"select": "*", **filters}, headers={"Prefer": "count=exact"},
        )
        try:
            count = int(response.headers["content-range"].rsplit("/", 1)[1])
            if count < 0:
                raise ValueError
            return count
        except (KeyError, ValueError, IndexError):
            raise HTTPException(502, "Unexpected Supabase count response") from None
