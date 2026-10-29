import json

from channels.generic.websocket import AsyncWebsocketConsumer


class LiveLessonConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.lesson_id = self.scope['url_route']['kwargs']['lesson_id']
        self.room_group_name = f'live_lesson_{self.lesson_id}'

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name,
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name,
        )

    async def receive(self, text_data):
        data = json.loads(text_data)
        message_type = data.get('type')

        payload = {
            'type': message_type,
            'sender': data.get('sender'),
            'message': data.get('message'),
            'offer': data.get('offer'),
            'answer': data.get('answer'),
            'candidate': data.get('candidate'),
        }

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'payload': payload,
            }
        )

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps(event['payload']))
