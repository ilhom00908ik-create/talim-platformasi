from django.db import models
from django.contrib.auth.models import User


class TeacherApplication(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    phone = models.CharField(max_length=20)
    bio = models.TextField()
    experience_years = models.PositiveIntegerField()
    photo = models.ImageField(upload_to='teacher_photos/', blank=True, null=True)
    is_approved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def is_verified(self):
        return self.is_approved

    def __str__(self):
        return f"{self.user.username} - ariza"

    def approve(self):
        self.is_approved = True
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.save(update_fields=['is_approved'])

        profile = getattr(self.user, 'userprofile', None) or getattr(self.user, 'profile', None)
        if profile is not None and hasattr(profile, 'is_verified'):
            profile.is_verified = True
            profile.save(update_fields=['is_verified'])


class TeacherCertificate(models.Model):
    teacher = models.ForeignKey(TeacherApplication, on_delete=models.CASCADE, related_name='certificates')
    file = models.FileField(upload_to='certificates/')


class Course(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='courses')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title

    @property
    def live_lessons_count(self):
        return self.live_lessons.count()


class Enrollment(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='course_enrollments')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='enrollments')
    enrolled_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'course'], name='unique_user_course_enrollment'),
        ]
        ordering = ['-enrolled_at']

    def __str__(self):
        return f"{self.user.username} -> {self.course.title}"


class Test(models.Model):
    # Savol rejimlari (butun test uchun):
    #   text   — har bir savol matn + A/B/C/D variantlari bilan yoziladi
    #   shared — bitta umumiy PDF/rasm yuklanadi, o'qituvchi faqat 1-A, 2-B ...
    #            ko'rinishida to'g'ri javob kalitini belgilaydi
    MODE_TEXT = 'text'
    MODE_SHARED = 'shared'
    MODE_CHOICES = [
        (MODE_TEXT, 'Odatiy (savollar alohida)'),
        (MODE_SHARED, 'Umumiy PDF/rasm (javob kaliti bilan)'),
    ]

    SHARED_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp')

    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tests')
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100)
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=MODE_TEXT)
    cover_image = models.ImageField(upload_to='test_covers/', blank=True, null=True)
    resource_pdf = models.FileField(upload_to='test_resources/', blank=True, null=True)
    # Umumiy rejim uchun yagona fayl — PDF yoki rasm
    shared_file = models.FileField(upload_to='test_shared/', blank=True, null=True)
    # shared_file turi rasm bo'lsa — preview (kichik rasm) shu yerda saqlanadi
    shared_preview = models.ImageField(upload_to='test_shared_previews/', blank=True, null=True)
    is_published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def questions_count(self):
        return self.questions.count()

    @property
    def is_shared_mode(self):
        return self.mode == self.MODE_SHARED and bool(self.shared_file)

    @property
    def shared_file_name(self):
        file = self.shared_file or self.resource_pdf
        return str(getattr(file, 'name', '') or '')

    @property
    def shared_file_is_pdf(self):
        return self.shared_file_name.lower().endswith('.pdf')

    @property
    def shared_file_is_image(self):
        return self.shared_file_name.lower().endswith(self.SHARED_IMAGE_EXTENSIONS)

    @property
    def shared_preview_url(self):
        """O'qituvchining kalit sahifasida ko'rsatiladigan kichik rasm."""
        if self.shared_preview:
            return self.shared_preview.url
        return ''

    @property
    def display_file_url(self):
        """Talabaga ko'rsatiladigan umumiy fayl (shared_file yoki zaxira resource_pdf)."""
        file = self.shared_file or self.resource_pdf
        return file.url if file else ''

    @property
    def display_file_is_pdf(self):
        file = self.shared_file or self.resource_pdf
        return bool(file) and str(file.name).lower().endswith('.pdf')

    @property
    def display_file_is_image(self):
        return self.shared_file_is_image

    @classmethod
    def parse_answer_key(cls, raw):
        """'1-A, 2-B, 3-C' yoki 'A B C' ko'rinishidagi matnni {tartib raqami: harf} ga aylantiradi."""
        import re

        key = {}
        if not raw:
            return key
        text = str(raw).upper()
        pairs = re.findall(r'(\d+)\s*[-.:)\]]?\s*([A-D])\b', text)
        if pairs:
            for number, letter in pairs:
                key[int(number)] = letter
            return key
        # Faqat harflar ketma-ket berilgan bo'lsa: "ABC DA" -> 1:A, 2:B ...
        letters = re.findall(r'[A-D]', text)
        for index, letter in enumerate(letters, start=1):
            key[index] = letter
        return key

    def answer_key_text(self):
        """Bazadagi javoblardan '1-A, 2-B ...' matnini hosil qiladi (o'qituvchi formasi uchun)."""
        parts = [f'{q.order}-{q.correct_option}' for q in self.questions.all() if q.correct_option]
        return ', '.join(parts)

    def __str__(self):
        return self.title


class TestQuestion(models.Model):
    # Savol yaratish rejimlari:
    #   text   — odatiy rejim: savol matni + A/B/C/D variantlari qo'lda kiritiladi
    #   file   — alohida fayl rejimi: har bir savol uchun rasm/PDF yuklanadi
    #   shared — testning umumiy PDF/rasm fayli ichidagi savol: faqat to'g'ri javob harfi
    MODE_TEXT = 'text'
    MODE_FILE = 'file'
    MODE_SHARED = 'shared'
    MODE_CHOICES = [
        (MODE_TEXT, 'Odatiy (variantlar bilan)'),
        (MODE_FILE, 'Rasm/PDF asosida'),
        (MODE_SHARED, 'Umumiy fayl asosida'),
    ]

    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name='questions')
    mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=MODE_TEXT)
    question_text = models.TextField(blank=True, default='')
    image = models.ImageField(upload_to='question_images/', blank=True, null=True)
    resource_pdf = models.FileField(upload_to='question_resources/', blank=True, null=True)
    # Fayl rejimi uchun yagona yuklash maydoni (rasm yoki PDF)
    file = models.FileField(upload_to='test_files/', blank=True, null=True)
    option_a = models.CharField(max_length=255, blank=True, default='')
    option_b = models.CharField(max_length=255, blank=True, default='')
    option_c = models.CharField(max_length=255, blank=True, default='')
    option_d = models.CharField(max_length=255, blank=True, default='')
    correct_option = models.CharField(max_length=1, choices=[('A', 'A'), ('B', 'B'), ('C', 'C'), ('D', 'D')])
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.test.title} - {self.order}"

    @property
    def is_file_mode(self):
        return self.mode in (self.MODE_FILE, self.MODE_SHARED)

    @property
    def is_shared_mode(self):
        return self.mode == self.MODE_SHARED

    @property
    def shared_test_file_url(self):
        """Umumiy rejimda savol fayli test.niki bo'ladi."""
        return self.test.display_file_url if self.test_id else ''

    @property
    def display_file(self):
        """Fayl rejimida ko'rsatiladigan fayl (yangi `file` yoki eski `image`/`resource_pdf`)."""
        return self.file or self.image or self.resource_pdf

    @property
    def display_file_url(self):
        file = self.display_file
        return file.url if file else ''

    @property
    def display_file_is_pdf(self):
        file = self.display_file
        return bool(file) and str(file.name).lower().endswith('.pdf')

    @property
    def display_file_is_image(self):
        file = self.display_file
        if not file:
            return False
        return str(file.name).lower().endswith(Test.SHARED_IMAGE_EXTENSIONS)

    @property
    def display_title(self):
        """Talabaga ko'rinadigan savol sarlavhasi (fayl rejimida matn bo'lmasligi mumkin)."""
        return self.question_text or f'{self.order}-savol'


class Answer(models.Model):
    question = models.ForeignKey(TestQuestion, on_delete=models.CASCADE, related_name='answers')
    text = models.CharField(max_length=255)
    is_correct = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"{self.question_id} -> {self.text}"


class TestAttempt(models.Model):
    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name='attempts')
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='test_attempts')
    score = models.PositiveIntegerField(default=0)
    total_questions = models.PositiveIntegerField(default=0)
    percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    submitted_at = models.DateTimeField(auto_now_add=True)

    @property
    def correct_answers(self):
        return self.score

    def __str__(self):
        return f"{self.student.username} -> {self.test.title} ({self.score}/{self.total_questions})"


class LiveLesson(models.Model):
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name='live_lessons')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, related_name='live_lessons', null=True, blank=True)
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100, blank=True, default='')
    stream_url = models.URLField(blank=True, null=True)
    is_live = models.BooleanField(default=False)
    started_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.teacher.username} - {self.title}"

    def user_can_join(self, user):
        if not user or not user.is_authenticated:
            return False

        if user == self.teacher or getattr(user, 'is_staff', False):
            return True

        # Oddiy ro'yxatdan o'tgan foydalanuvchilar uchun jonli darsga qo'shilish ruxsat beriladi.
        # O'qituvchi bo'lish shart emas. Kursga yozilgan bo'lsin yoki yo'q bo'lsin, autentifikatsiya
        # bo'lgan foydalanuvchi darsga kirishi mumkin.
        return True
