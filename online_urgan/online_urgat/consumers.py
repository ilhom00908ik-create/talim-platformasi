import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .models import LiveLesson


class LiveLessonConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated:
            await self.close(code=1008)
            return

        self.lesson_id = self.scope['url_route']['kwargs']['lesson_id']
        self.room_group_name = f'live_lesson_{self.lesson_id}'

        self.lesson = await self.get_lesson(self.lesson_id)
        if not self.lesson:
            await self.close(code=1008)
            return

        if not (self.lesson.teacher_id == user.id or self.lesson.user_can_join(user)):
            await self.close(code=1008)
            return

        self.user_id = user.id
        self.user_name = user.get_full_name() or user.username
        self.is_teacher = user.id == self.lesson.teacher_id
        self.user_role = 'teacher' if self.is_teacher else 'student'
        self.mic_muted_by_host = False

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        await self.send(
            text_data=json.dumps({
                'type': 'session_state',
                'user_id': self.user_id,
                'user_name': self.user_name,
                'role': self.user_role,
                'teacher_id': self.lesson.teacher_id,
                'room': self.room_group_name,
                'can_control_mic': self.is_teacher,
                'mic_muted_by_host': self.mic_muted_by_host,
            })
        )

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'payload': {
                    'type': 'presence',
                    'sender': self.user_name,
                    'sender_id': self.user_id,
                    'role': self.user_role,
                    'message': f'{self.user_name} darsxona bilan boglandi.',
                    'room': self.room_group_name,
                },
            },
        )

    @database_sync_to_async
    def get_lesson(self, lesson_id):
        return LiveLesson.objects.select_related('teacher', 'course').filter(id=lesson_id).first()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_message',
                    'payload': {
                        'type': 'presence',
                        'sender': getattr(self, 'user_name', 'System'),
                        'sender_id': getattr(self, 'user_id', None),
                        'role': getattr(self, 'user_role', 'student'),
                        'message': f"{getattr(self, 'user_name', 'Foydalanuvchi')} darsxonadan chiqdi.",
                        'room': self.room_group_name,
                    },
                },
            )
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        if not text_data:
            return

        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message_type = data.get('type')
        if not message_type:
            return

        sender_id = data.get('sender_id') or getattr(self.scope.get('user'), 'id', None)
        target_user_id = data.get('target_user_id')

        if message_type in {'mute_all', 'unmute_all', 'mute_user', 'unmute_user'} and not self.is_teacher:
            return

        if message_type in {'mute_user', 'unmute_user'} and target_user_id is None:
            return

        payload = {
            'type': message_type,
            'sender': data.get('sender') or getattr(self, 'user_name', 'Anonymous'),
            'sender_id': sender_id,
            'role': data.get('role', getattr(self, 'user_role', 'student')),
            'message': data.get('message'),
            'offer': data.get('offer'),
            'answer': data.get('answer'),
            'candidate': data.get('candidate'),
            'target_user_id': target_user_id,
            'room': data.get('room') or self.room_group_name,
            'muted': data.get('muted'),
            'muted_by_host': data.get('muted_by_host'),
        }

        event = {
            'type': 'broadcast_message',
            'payload': payload,
            'sender_id': sender_id,
            'target_user_id': target_user_id,
        }

        await self.channel_layer.group_send(self.room_group_name, event)

    async def broadcast_message(self, event):
        payload = event.get('payload', {})
        sender_id = event.get('sender_id')
        target_user_id = event.get('target_user_id')
        current_user_id = getattr(self.scope.get('user'), 'id', None)

        if target_user_id is not None:
            if current_user_id != target_user_id:
                return
        elif sender_id is not None and sender_id == current_user_id:
            return

        if payload.get('type') in {'webrtc-offer', 'webrtc-answer', 'webrtc-candidate'}:
            if target_user_id is None and sender_id == current_user_id:
                return

        await self.send(text_data=json.dumps(payload))
