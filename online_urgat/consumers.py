    async def send_self_state(self):
        """Xona holatini (qatnashchilar ro'yxati, chat, ekran egasi) qaytaradi.

        Ro'yxat kanal xotirasida yuritiladi, shuning uchun yangi kirgan
        qatnashchi mavjudlarni ko'rishi uchun avval guruhga `sync-roster`
        so'rovi yuboriladi; har bir eski kanal o'z yozuvi bilan javob beradi.
        Javoblar kichik kechikishdan keyin yig'ib olinadi.
        """
        self.joined = True
        self._roster[self.user_id] = {
            'id': self.user_id,
            'name': self.user_name,
            'role': self.user_role,
            'mic_muted': False,
            'speaking': False,
        }

        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'roster_sync_request', 'requester_id': self.user_id},
        )
        # Eski kanallar rosterlarini yuborishiga ulgurish uchun qisqa pauza
        await asyncio.sleep(0.15)

        await self.send(text_data=json.dumps({
            'type': 'room-state',
            'user_id': self.user_id,
            'user_name': self.user_name,
            'role': self.user_role,
            'teacher_id': self.lesson.teacher_id,
            'room': self.room_group_name,
            'can_control_mic': self.is_teacher,
            'can_share_screen': self.is_teacher,
            'mic_muted_by_host': False,
            'screen_owner_id': self._screen_owner,
            'participants': list(self._roster.values()),
            'chat_history': self._chat_history[-50:],
        }))

    async def roster_sync_request(self, event):
        """Boshqa kanal xonaga kirdi — o'z yozuvimizni unga yuboramiz."""
        requester_id = event.get('requester_id')
        if requester_id == self.user_id or not self.joined:
            return
        entry = self._roster.get(self.user_id) or {}
        await self.send(text_data=json.dumps({
            'type': 'presence',
            'sender': self.user_name,
            'sender_id': self.user_id,
            'role': self.user_role,
            'name': self.user_name,
            'mic_muted': bool(entry.get('mic_muted')),
            'screen_owner_id': self._screen_owner,
            'fresh': True,
        }))


