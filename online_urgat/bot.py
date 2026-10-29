import os
import django
import asyncio
from asgiref.sync import sync_to_async
from aiogram import Bot, Dispatcher, types, F
from aiogram.enums import ParseMode

# 1. Django muhitini sozlash
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from online_urgat.models import TeacherApplication

TOKEN = "8381737778:AAGiVBEtSxQPXisuzX88O8fcLGdHYx5x1kk"
ADMIN_ID = 7389059494

bot = Bot(token=TOKEN)
dp = Dispatcher()

# Tasdiqlash tugmasi bosilganda
@dp.callback_query(F.data.startswith("approve_"))
async def approve_teacher(callback: types.CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Sizda bu amalni bajarish huquqi yo'q!", show_alert=True)
        return

    app_id = callback.data.split("_")[1]
    
    # Django ORM sinxron bo'lgani uchun sync_to_async ishlatamiz
    try:
        @sync_to_async
        def approve_in_db():
            teacher_app = TeacherApplication.objects.get(id=app_id)
            teacher_app.is_approved = True
            teacher_app.save()
            return teacher_app

        await approve_in_db()
        
        current_text = callback.message.caption or callback.message.text or ""
        new_text = current_text + "\n\n✅ **Holat: Admin tomonidan tasdiqlandi!**"
        
        if callback.message.caption:
            await callback.message.edit_caption(caption=new_text, parse_mode=ParseMode.MARKDOWN, reply_markup=None)
        else:
            await callback.message.edit_text(text=new_text, parse_mode=ParseMode.MARKDOWN, reply_markup=None)
            
        await callback.answer("Ariza muvaffaqiyatli tasdiqlandi!")
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)

# Rad etish tugmasi bosilganda
@dp.callback_query(F.data.startswith("reject_"))
async def reject_teacher(callback: types.CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Sizda bu amalni bajarish huquqi yo'q!", show_alert=True)
        return

    app_id = callback.data.split("_")[1]
    
    try:
        @sync_to_async
        def delete_from_db():
            teacher_app = TeacherApplication.objects.get(id=app_id)
            teacher_app.delete()

        await delete_from_db()
        
        current_text = callback.message.caption or callback.message.text or ""
        new_text = current_text + "\n\n❌ **Holat: Rad etildi va o'chirildi!**"
        
        if callback.message.caption:
            await callback.message.edit_caption(caption=new_text, parse_mode=ParseMode.MARKDOWN, reply_markup=None)
        else:
            await callback.message.edit_text(text=new_text, parse_mode=ParseMode.MARKDOWN, reply_markup=None)
            
        await callback.answer("Ariza rad etildi!")
    except TeacherApplication.DoesNotExist:
        await callback.answer("Bunday ariza topilmadi yoki allaqachon o'chirilgan!", show_alert=True)

@dp.message()
async def check_admin(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer("Assalomu alaykum! Bu Online O'rgat platformasining maxsus admin botidir.")

async def main():
    print("Telegram bot faqat admin uchun ishga tushdi...")
    await dp.start_polling(bot)

if __name__ == '__main__':
    asyncio.run(main())