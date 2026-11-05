import os
import django
from django.core.asgi import get_asgi_application

# 1. Django sozlamalarini yuklaymiz va setup qilamiz (Eng birinchi turishi shart!)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

# 2. Endi routing va consumer larni xavfsiz import qilishimiz mumkin
from channels.routing import ProtocolTypeRouter, URLRouter
from core import routing

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": URLRouter(
        routing.websocket_urlpatterns
    ),
})