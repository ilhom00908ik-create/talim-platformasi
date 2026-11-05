import os
import django

# 1. Django muhitini birinchi bo'lib to'liq ishga tushiramiz (Xatolikning oldini olish uchun)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from django.urls import path

from online_urgat import consumers

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter([
            path("ws/live/<int:lesson_id>/", consumers.LiveLessonConsumer.as_asgi()),
        ])
    ),
})