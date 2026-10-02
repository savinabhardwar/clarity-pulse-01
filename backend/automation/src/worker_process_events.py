from workers import WorkerEntrypoint

from ai_pm.config import Config
from ai_pm.service import Service, process_batch
from ai_pm.worker_transport import BindingMessage, client


class Default(WorkerEntrypoint):
    async def queue(self, batch):
        async with client() as http:
            service = Service(Config.from_bindings(self.env), http, None)
            await process_batch([BindingMessage(message) for message in batch.messages], service)
