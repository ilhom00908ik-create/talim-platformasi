import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

import django
from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application


django.setup()

from core import routing

application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    'websocket': AuthMiddlewareStack(
        URLRouter(routing.websocket_urlpatterns)
    ),
})