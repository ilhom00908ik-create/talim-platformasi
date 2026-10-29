from django.db import models
from django.conf import settings

# 1. Fanlar modeli (Matematika, Fizika va h.k.)
class Subject(models.Model):
    name = models.CharField(max_length=100, verbose_name="Fan nomi")

    def __str__(self):
        return self.name

# 2. Mavzular modeli (Masalan: Mexanika, Dinamika)
class Topic(models.Model):
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name="topics")
    name = models.CharField(max_length=200, verbose_name="Mavzu nomi")

    def __str__(self):
        return f"{self.subject.name} -> {self.name}"

# 3. Variantlar modeli (1-variant, 2-variant va h.k.)
class Variant(models.Model):
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="variants")
    number = models.IntegerField(verbose_name="Variant raqami")

    def __str__(self):
        return f"{self.topic.name} ({self.number}-variant)"

# 4. Savollar modeli
class Question(models.Model):
    variant = models.ForeignKey(Variant, on_delete=models.CASCADE, related_name="questions")
    text = models.TextField(verbose_name="Savol matni")
    
    # Variant javoblari
    option_a = models.CharField(max_length=200, verbose_name="A varianti")
    option_b = models.CharField(max_length=200, verbose_name="B varianti")
    option_c = models.CharField(max_length=200, verbose_name="C varianti")
    option_d = models.CharField(max_length=200, verbose_name="D varianti")
    
    # To'g'ri javob (A, B, C yoki D bo'lib saqlanadi)
    correct_option = models.CharField(max_length=1, choices=[('A', 'A'), ('B', 'B'), ('C', 'C'), ('D', 'D')], verbose_name="To'g'ri javob")

    def __str__(self):
        return self.text[:50]

# 5. Umumiy natijalarni saqlash modeli
class QuizResult(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    variant = models.ForeignKey(Variant, on_delete=models.CASCADE)
    total_questions = models.IntegerField(verbose_name="Jami savollar")
    correct_answers = models.IntegerField(verbose_name="To'g'ri javoblar")
    percentage = models.DecimalField(max_digits=5, decimal_places=2, verbose_name="Foiz natijasi")
    date_taken = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.phone_number} - {self.variant} ({self.correct_answers}/{self.total_questions})"
