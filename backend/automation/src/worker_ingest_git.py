from workers import asgi
from ai_pm.api import create_app
from ai_pm.worker_transport import client

Default = asgi.entrypoint(create_app(role="ingest-git", client_factory=client))
