import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import LiveLesson


class LiveLessonConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.lesson_id = self.scope['url_route']['kwargs']['lesson_id']
        self.room_group_name = f'live_lesson_{self.lesson_id}'

        self.lesson = await self.get_lesson(self.lesson_id)
        if not self.lesson:
            await self.close()
            return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name,
        )
        await self.accept()

    @database_sync_to_async
    def get_lesson(self, lesson_id):
        return LiveLesson.objects.filter(id=lesson_id).first()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name,
        )

    async def receive(self, text_data):
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message_type = data.get('type')
        payload = {
            'type': message_type,
            'sender': data.get('sender') or 'Anonymous',
            'role': data.get('role', 'student'),
            'message': data.get('message'),
            'offer': data.get('offer'),
            'answer': data.get('answer'),
            'candidate': data.get('candidate'),
            'room': data.get('room') or self.room_group_name,
        }

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'payload': payload,
            }
        )

    async def broadcast_message(self, event):
        payload = event['payload']
        if payload.get('type') == 'chat-message' and payload.get('message'):
            await self.send(text_data=json.dumps(payload))
            return
        await self.send(text_data=json.dumps(payload))
