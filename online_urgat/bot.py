"""Telegram bot — o'qituvchi arizasini tasdiqlash (`approve_<id>`) / rad etish.

Tasdiqlash bosilganda:
    TeacherApplication.get(id=...)  ->  is_approved = True  ->  save()
    foydalanuvchi profili (UserProfile.is_verified) faollashtiriladi.
So'ng xabar matni "✅ Tasdiqlandi" ga o'zgartiriladi.
"""

import asyncio
import os
import sys
from pathlib import Path

import django
from asgiref.sync import sync_to_async
from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import CallbackQuery, Message

# 1. Django muhitini sozlash (import'lardan OLDIN) --------------------------
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import transaction  # noqa: E402

from online_urgat.models import TeacherApplication  # noqa: E402

TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8381737778:AAGiVBEtSxQPXisuzX88O8fcLGdHYx5x1kk')
ADMIN_ID = int(os.getenv('ADMIN_APPROVE_TELEGRAM_ID') or os.getenv('ADMIN_TELEGRAM_ID', '7389059494'))

bot = Bot(token=TOKEN)
dp = Dispatcher()

APPROVED_SUFFIX = '\n\n✅ Tasdiqlandi'
REJECTED_SUFFIX = '\n\n❌ Rad etildi'


# --------------------------------------------------------------------------
# Baza amallari
# --------------------------------------------------------------------------
def _set_profile_verified(user, verified=True):
    for name in ('userprofile', 'profile'):
        profile = getattr(user, name, None)
        if profile is not None and hasattr(profile, 'is_verified'):
            if bool(profile.is_verified) != bool(verified):
                profile.is_verified = verified
                profile.save(update_fields=['is_verified'])
            return profile
    return None


def approve_application_sync(app_id):
    """Arizani tasdiqlaydi va profilni faollashtiradi. (app, newly) qaytaradi."""
    with transaction.atomic():
        teacher_app = (
            TeacherApplication.objects
            .select_related('user')
            .select_for_update()
            .get(id=app_id)
        )
        was_approved = bool(teacher_app.is_approved)

        teacher_app.is_approved = True
        teacher_app.save(update_fields=['is_approved'])

        user = teacher_app.user
        if not user.is_staff:
            user.is_staff = True
            user.save(update_fields=['is_staff'])
        _set_profile_verified(user, True)

    return teacher_app, (not was_approved)


def reject_application_sync(app_id):
    teacher_app = TeacherApplication.objects.select_related('user').get(id=app_id)
    teacher_app.is_approved = False
    teacher_app.save(update_fields=['is_approved'])
    _set_profile_verified(teacher_app.user, False)
    return teacher_app


# --------------------------------------------------------------------------
# Yordamchilar
# --------------------------------------------------------------------------
def _strip_old_status(text):
    base = (text or '').rstrip()
    for suffix in (APPROVED_SUFFIX.strip(), REJECTED_SUFFIX.strip()):
        if base.endswith(suffix):
            base = base[: -len(suffix)].rstrip()
    return base


async def _edit_status(callback: CallbackQuery, suffix):
    """Xabar matnini almashtiradi — tugmalar olib tashlanadi (ikki marta bosilmasin)."""
    base = _strip_old_status(callback.message.caption or callback.message.text or '')
    new_text = base + suffix
    try:
        if callback.message.caption is not None:
            await callback.message.edit_caption(caption=new_text, reply_markup=None)
        else:
            await callback.message.edit_text(text=new_text, reply_markup=None)
    except TelegramBadRequest as exc:
        print(f'Xabarni tahrirlashda xatolik: {exc}')


def _parse_app_id(data):
    raw = (data or '').split('_', 1)[-1]
    return int(raw) if raw.isdigit() else None


# --------------------------------------------------------------------------
# Handler'lar
# --------------------------------------------------------------------------
@dp.callback_query(F.data.startswith('approve_'))
async def approve_teacher(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Sizda bu amalni bajarish huquqi yo'q!", show_alert=True)
        return

    app_id = _parse_app_id(callback.data)
    if app_id is None:
        await callback.answer("Ariza ID noto'g'ri.", show_alert=True)
        return

    try:
        teacher_app, newly = await sync_to_async(approve_application_sync)(app_id)
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)
        return

    await _edit_status(callback, APPROVED_SUFFIX)

    name = teacher_app.user.get_full_name() or teacher_app.user.username
    await callback.answer(
        f"✅ {name} tasdiqlandi — o'qituvchi profili faollashtirildi."
        if newly else
        f"{name} allaqachon tasdiqlangan edi — holat yangilandi."
    )


@dp.callback_query(F.data.startswith('reject_'))
async def reject_teacher(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Sizda bu amalni bajarish huquqi yo'q!", show_alert=True)
        return

    app_id = _parse_app_id(callback.data)
    if app_id is None:
        await callback.answer("Ariza ID noto'g'ri.", show_alert=True)
        return

    try:
        await sync_to_async(reject_application_sync)(app_id)
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)
        return

    await _edit_status(callback, REJECTED_SUFFIX)
    await callback.answer("❌ Ariza rad etildi.")


@dp.message(F.text)
async def check_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer(
        "Assalomu alaykum! Bu Online O'rgat platformasining maxsus admin botidir.\n"
        "Yangi o'qituvchi arizalari shu yerga tugmalar bilan keladi: "
        "✅ Tasdiqlash / ❌ Rad etish."
    )


async def main():
    print(f'Telegram bot ishga tushdi (admin id: {ADMIN_ID})...')
    await dp.start_polling(bot)


if __name__ == '__main__':
    asyncio.run(main())
