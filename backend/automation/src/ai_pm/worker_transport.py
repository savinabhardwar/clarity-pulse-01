"""Cloudflare HTTP and Queue adapters; imported only in the worker runtime."""

import httpx


class WorkersTransport(httpx.AsyncBaseTransport):
    async def handle_async_request(self, request):
        from workers import fetch
        try:
            response = await fetch(str(request.url), method=request.method,
                                   headers=dict(request.headers), body=request.content if request.content else None)
            return httpx.Response(response.status, headers=dict(response.headers), content=await response.bytes(), request=request)
        except Exception as error:
            # The SDK raises JavaScript/Pyodide errors rather than httpx errors.
            raise httpx.NetworkError("Cloudflare HTTP request failed", request=request) from error


def client():
    return httpx.AsyncClient(transport=WorkersTransport(), timeout=30)


class BindingQueue:
    def __init__(self, binding):
        self.binding = binding

    async def send(self, event):
        # SDK binding wrappers convert Python dictionaries through the FFI.
        await self.binding.send(event)


class BindingMessage:
    def __init__(self, message):
        self.message = message
        self.id, self.attempts, self.body = message.id, message.attempts, message.body

    def ack(self):
        self.message.ack()

    def retry(self, delay):
        self.message.retry({"delaySeconds": delay})
