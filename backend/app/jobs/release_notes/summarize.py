"""Preserve the existing provider chain and release-note prompt."""

import asyncio
from pathlib import Path
from urllib.parse import quote

from app.jobs.release_notes.confluence import ProviderError

GEMINI_MODELS = [("gemini-3.6-flash", 3), ("gemini-3.5-flash", 2), ("gemini-3.7-flash", 2), ("gemini-3.8-flash", 1)]
WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"


def build_prompt(product, issues):
    lines = []
    for issue in issues:
        flag = f" [INCOMPLETE: {issue['completenessNote']}]" if issue.get("completenessNote") else ""
        lines.append(f"- [{issue.get('issuetype', 'undefined')}] {issue['key']}: {issue['summary']}{flag}")
    template = Path(__file__).with_name("prompt.txt").read_text(encoding="utf-8")
    return template.replace("${product}", product).replace("${issueLines}", "\n".join(lines))


class Summarizer:
    def __init__(self, settings, client, sleep=asyncio.sleep):
        self.settings, self.client, self.sleep = settings, client, sleep
        self.exhausted_models = set()

    async def request_gemini(self, model, prompt, attempts):
        if not self.settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is required")
        # A header carries the key so HTTP exception URLs cannot expose it.
        headers = {"x-goog-api-key": self.settings.gemini_api_key.get_secret_value()}
        for attempt in range(attempts):
            response = await self.client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers=headers, json={"contents": [{"parts": [{"text": prompt}]}]},
            )
            if response.is_success:
                candidates = response.json().get("candidates") or []
                parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
                text = "".join(part.get("text") or "" for part in parts)
                if not text.strip():
                    raise ValueError("Gemini returned an empty response")
                # Refuse a known truncated output rather than publish it.
                finish = candidates[0].get("finishReason")
                if finish and finish != "STOP":
                    raise ValueError("Gemini response did not finish normally")
                return text
            daily = response.status_code == 429 and "perday" in response.text.lower()
            error = ProviderError("Gemini", response.status_code, daily_quota=daily)
            if daily or attempt == attempts - 1 or not (response.status_code == 429 or response.status_code >= 500):
                raise error
            await self.sleep(2 * 2 ** attempt)

    async def gemini(self, prompt):
        first_error = None
        for model, attempts in GEMINI_MODELS:
            if model in self.exhausted_models:
                continue
            try:
                return await self.request_gemini(model, prompt, attempts)
            except ProviderError as error:
                first_error = first_error or error
                if error.daily_quota:
                    self.exhausted_models.add(model)
                if error.status != 429 and error.status < 500:
                    raise
        raise first_error or RuntimeError("All Gemini models are exhausted for today")

    async def workers_ai(self, prompt):
        settings = self.settings
        if not settings.cloudflare_account_id or not settings.cloudflare_api_token:
            raise RuntimeError("Workers AI fallback is not configured")
        url = f"https://api.cloudflare.com/client/v4/accounts/{quote(settings.cloudflare_account_id, safe='')}/ai/run/{WORKERS_AI_MODEL}"
        for attempt in range(3):
            response = await self.client.post(url, headers={"Authorization": "Bearer " + settings.cloudflare_api_token.get_secret_value()},
                                              json={"messages": [{"role": "user", "content": prompt}], "max_tokens": 4096})
            if response.is_success:
                body = response.json()
                if not body.get("success"):
                    raise ValueError("Workers AI returned an error")
                result = body.get("result") or {}
                choices = result.get("choices") or []
                finish = choices[0].get("finish_reason") if choices else None
                if finish and finish != "stop":
                    raise ValueError("Workers AI response was truncated")
                text = result.get("response") or ""
                if not text.strip():
                    raise ValueError("Workers AI returned an empty response")
                return text.strip()
            if attempt == 2 or not (response.status_code == 429 or response.status_code >= 500):
                raise ProviderError("Workers AI", response.status_code)
            await self.sleep(2 * 2 ** attempt)

    async def summarize(self, product, issues):
        if not issues:
            return "* **No user-facing changes:** No tickets were completed in this period."
        prompt = build_prompt(product, issues)
        try:
            return (await self.gemini(prompt)).strip()
        except Exception as primary:
            if not self.settings.cloudflare_account_id or not self.settings.cloudflare_api_token:
                raise
            try:
                return await self.workers_ai(prompt)
            except Exception:
                raise primary
