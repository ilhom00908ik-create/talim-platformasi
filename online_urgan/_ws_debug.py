"""State store: Redis bo'lmaganda (InMemory) holatni tekshirish."""
import asyncio
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from channels.layers import get_channel_layer

from online_urgat.consumers import LiveLessonConsumer


async def main():
    layer = get_channel_layer()
    consumer = LiveLessonConsumer()
    consumer.channel_layer = layer
    consumer.state_key = 'test_room_state_xyz'
    consumer.user_id = 1
    consumer.user_name = 'Tester'
    consumer.user_role = 'teacher'

    print('empty read:', await consumer.receive_state())
    state = await consumer.load_state()
    state['participants'][1] = consumer.entry()
    state['screen_owner_id'] = 1
    await consumer.save_state(state)
    print('queue size:', layer.channels[consumer.state_key].qsize())

    print('peek (non-destructive) x2:', bool(await consumer.receive_state()), bool(await consumer.receive_state()))
    restored = await consumer.load_state()
    print('restored ids:', [p['id'] for p in restored['participants'].values()],
          'screen:', restored['screen_owner_id'])
    print('second read (queue empty):', await consumer.receive_state())

    await consumer.clear_state()
    print('after clear:', await consumer.receive_state(), 'channel present:', consumer.state_key in layer.channels)


asyncio.run(main())
