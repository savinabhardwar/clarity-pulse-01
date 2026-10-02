from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

import httpx

from ai_pm.worker_transport import BindingMessage, BindingQueue, WorkersTransport


class RuntimeAdapterTests(IsolatedAsyncioTestCase):
    async def test_sdk_response_and_json_body_are_transported(self):
        response = SimpleNamespace(status=201, headers={"content-type": "application/json"}, bytes=AsyncMock(return_value=b'{"saved":true}'))
        fetch = AsyncMock(return_value=response)
        with patch.dict("sys.modules", {"workers": SimpleNamespace(fetch=fetch)}):
            async with httpx.AsyncClient(transport=WorkersTransport()) as client:
                result = await client.post("https://fixture.example/rpc", json={"id": "fixture"})
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json(), {"saved": True})
        self.assertEqual(fetch.call_args.kwargs["body"], b'{"id":"fixture"}')

    async def test_sdk_failure_becomes_sanitized_httpx_error(self):
        fetch = AsyncMock(side_effect=RuntimeError("fixture provider credentials should not appear"))
        with patch.dict("sys.modules", {"workers": SimpleNamespace(fetch=fetch)}):
            async with httpx.AsyncClient(transport=WorkersTransport()) as client:
                with self.assertRaisesRegex(httpx.NetworkError, "^Cloudflare HTTP request failed$"):
                    await client.get("https://fixture.example/")

    async def test_queue_and_message_use_sdk_binding_contract(self):
        binding = SimpleNamespace(send=AsyncMock())
        await BindingQueue(binding).send({"id": "fixture"})
        binding.send.assert_awaited_once_with({"id": "fixture"})
        raw = SimpleNamespace(id="message", attempts=2, body={"id": "fixture"}, ack=Mock(), retry=Mock())
        message = BindingMessage(raw)
        message.ack()
        message.retry(60)
        raw.ack.assert_called_once_with()
        raw.retry.assert_called_once_with({"delaySeconds": 60})
