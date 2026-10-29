from django.db import models
from django.conf import settings

class Message(models.Model):
    # Xabar yuboruvchi va qabul qiluvchi (Foydalanuvchi yoki O'qituvchi/Texnik xodim)
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
    receiver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="received_messages")
    
    # Xabar matni
    text = models.TextField(verbose_name="Xabar matni")
    timestamp = models.DateTimeField(auto_now_add=True, verbose_name="Yuborilgan vaqti")
    is_read = models.BooleanField(default=False, verbose_name="O'qildimi")

    def __str__(self):
        return f"{self.sender.first_name} -> {self.receiver.first_name}: {self.text[:20]}"
