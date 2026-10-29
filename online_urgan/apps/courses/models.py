from django.core.exceptions import ValidationError

def buy_course(user, course):
    # 1. Avval sotib olganmi yo'qmi tekshiramiz
    if Enrollment.objects.filter(user=user, course=course).exists():
        raise ValidationError("Siz bu kursni allaqachon sotib olgansiz!")
        
    # 2. Pulini tekshiramiz
    if user.balance < course.price:
        raise ValidationError("Hisobingizda mablag' yetarli emas! Iltimos, hisobni to'ldiring.")
        
    # 3. Pulni yechamiz va saqlaymiz
    user.balance -= course.price
    user.save()
    
    # 4. Kursga a'zo qilamiz
    Enrollment.objects.create(user=user, course=course)
    return True
