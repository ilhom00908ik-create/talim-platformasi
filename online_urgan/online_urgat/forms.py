from django import forms

from .models import TeacherApplication, Test, TestQuestion


# Fayl rejimida qabul qilinadigan formatlar
ALLOWED_QUESTION_FILE_EXTENSIONS = ('.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp')


def validate_question_file(file):
    """Rasm/PDF faylini tekshiradi. Xato bo'lsa ValidationError ko'taradi."""
    if not file:
        return file
    if not str(file.name).lower().endswith(ALLOWED_QUESTION_FILE_EXTENSIONS):
        raise forms.ValidationError('Faqat PDF yoki rasm (jpg, png, webp) fayl yuklang!')
    return file


# O'qituvchi arizasi formasi.
# Eslatma: TeacherRegistrationForm dinamik qo'shiladigan 'certificate_pdf' maydoniga
# ega emas edi, shu sabab clean_certificate_pdf() hech qachon chaqirilmasdi.
# Endi fayl ModelForm maydoni sifatida aniq e'lon qilingan — yuklangan fayllar
# teacher_register_view ichida TeacherCertificate ga bog'lanadi.
class TeacherRegistrationForm(forms.ModelForm):
    certificate_pdf = forms.FileField(
        required=False,
        widget=forms.ClearableFileInput(attrs={'accept': '.pdf,image/*'}),
    )

    class Meta:
        model = TeacherApplication
        fields = ['phone', 'bio', 'experience_years', 'photo']
        widgets = {
            'phone': forms.TextInput(attrs={'placeholder': '+998 90 123 45 67'}),
            'bio': forms.Textarea(attrs={'rows': 4}),
            'experience_years': forms.NumberInput(attrs={'min': 0}),
        }

    def clean_phone(self):
        phone = (self.cleaned_data.get('phone') or '').strip()
        if len(phone) < 7:
            raise forms.ValidationError('Telefon raqamni to\'liq kiriting.')
        return phone

    def clean_certificate_pdf(self):
        file = self.cleaned_data.get('certificate_pdf')
        if file:
            allowed = ('.pdf', '.jpg', '.jpeg', '.png', '.webp')
            if not file.name.lower().endswith(allowed):
                raise forms.ValidationError('Faqat PDF yoki rasm (jpg, png, webp) fayl yuklang!')
        return file


# Javob kalitida qabul qilinadigan harflar
ANSWERS = ('A', 'B', 'C', 'D')


def normalize_answer_key(raw, count):
    """Javob kalitini yagona {savol raqami: harf} ko'rinishiga keltiradi.

    Qo'llab-quvvatlanadigan kiritish usullari:
      * "1-A, 2-B, 3-C"  /  "1A 2B 3C"  /  "1.a" — raqam + harf juftliklari
      * "1 A\n2 B"       — qatorma-qator
      * "A B C D"        — faqat harflar ketma-ket (1-dan boshlanadi)
      * "1-A 2-?"         — '?' yoki '-' bo'sh (belgilanmagan) savolni bildiradi

    Qaytaradi: (key, missing) — `missing` = kalitda yo'q savol raqamlari ro'yxati.
    """
    import re

    key = {}
    if not raw:
        return key, list(range(1, (count or 0) + 1))

    # "1-B", "2.B", "3) c", "4 d", "5:a", "6 = D" ko'rinishidagi juftliklar.
    # "1-?", "2-", "3-_" bo'sh javobni bildiradi -> kalitga kirmaydi (missing).
    text = str(raw).upper().strip()
    pairs = re.findall(r'(?:^|[^\d])(\d{1,3})\s*[-.:)\]=\s]*\s*([A-D?*_])', text)
    if pairs:
        for number, letter in pairs:
            if letter in ANSWERS:
                key[int(number)] = letter
    else:
        # Faqat harflar ketma-ket berilgan bo'lsa: "A B C D A" -> 1:A, 2:B ...
        letters = re.findall(r'[A-D]', re.sub(r'\d+', ' ', text))
        for index, letter in enumerate(letters, start=1):
            key[index] = letter

    if count:
        missing = [number for number in range(1, count + 1) if number not in key]
    else:
        missing = []
    return key, missing


class TestForm(forms.ModelForm):
    mode = forms.ChoiceField(
        choices=Test.MODE_CHOICES,
        initial=Test.MODE_SHARED,
        widget=forms.Select(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
    )

    class Meta:
        model = Test
        fields = ['title', 'subject', 'mode', 'cover_image', 'shared_file', 'resource_pdf', 'is_published']
        widgets = {
            'title': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'subject': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'mode': forms.Select(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'cover_image': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'shared_file': forms.ClearableFileInput(attrs={'accept': '.pdf,image/*', 'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'resource_pdf': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-violet-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'is_published': forms.CheckboxInput(attrs={'class': 'h-4 w-4 rounded border-white/20 bg-white/5 text-cyan-400 focus:ring-cyan-400'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Amaldagi rejimni initial qiymat sifatida ko'rsatamiz:
        #  * yangi test  -> umumped ta'rif (shared)
        #  * tahrirlash  -> bazadagi rejim
        if self.instance and self.instance.pk:
            self.initial['mode'] = self.instance.mode or Test.MODE_TEXT

    def clean_title(self):
        title = (self.cleaned_data.get('title') or '').strip()
        if not title:
            raise forms.ValidationError('Test nomini kiriting.')
        return title

    def clean_subject(self):
        subject = (self.cleaned_data.get('subject') or '').strip()
        return subject or 'Umumiy fan'

    def clean_resource_pdf(self):
        pdf = self.cleaned_data.get('resource_pdf')
        if pdf and not pdf.name.lower().endswith('.pdf'):
            raise forms.ValidationError('Test PDF fayli faqat .pdf formatida bo‘lishi kerak.')
        return pdf

    def clean_shared_file(self):
        # Umumiy rejimda ham PDF ham rasm qabul qilinadi
        return validate_question_file(self.cleaned_data.get('shared_file'))

    def clean(self):
        cleaned = super().clean()
        mode = cleaned.get('mode') or Test.MODE_TEXT
        if mode not in (Test.MODE_TEXT, Test.MODE_SHARED):
            mode = Test.MODE_TEXT
        cleaned['mode'] = mode

        if mode == Test.MODE_SHARED:
            has_file = bool(
                cleaned.get('shared_file')
                or cleaned.get('resource_pdf')
                or (self.instance and self.instance.pk and self.instance.display_file_url)
            )
            if not has_file:
                self.add_error('shared_file', 'Umumiy rejim uchun bitta PDF yoki rasm yuklang.')
        return cleaned


class AnswerKeyForm(forms.Form):
    """Umumiy fayl rejimi: bitta fayl + savollar soni + javob kaliti.

    Javob kaliti ikki usulda berilishi mumkin:
      1) answer_key matni: "1-A, 2-B, 3-C"
      2) yoki har bir savol uchun radio: correct_1..correct_N
    """

    question_count = forms.IntegerField(min_value=1, max_value=200, error_messages={
        'required': 'Savollar sonini kiriting.',
        'min_value': 'Savollar soni kamida 1 bo\'lishi kerak.',
        'max_value': 'Bir testda ko\'pi bilan 200 ta savol bo\'lishi mumkin.',
    })
    answer_key = forms.CharField(required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 1..200 oralig'idagi radio maydonlari dinamik qo'shiladi
        self.fields['shared_file'] = forms.FileField(required=False)
        for number in range(1, 201):
            self.fields[f'correct_{number}'] = forms.CharField(required=False)

    def clean_answer_key(self):
        return (self.cleaned_data.get('answer_key') or '').strip()

    def clean(self):
        cleaned = super().clean()
        count = cleaned.get('question_count') or 0

        radios = {}
        for number in range(1, count + 1):
            value = str(cleaned.get(f'correct_{number}') or '').strip().upper()
            if value in ANSWERS:
                radios[number] = value

        text_key, missing = normalize_answer_key(cleaned.get('answer_key'), count)
        # Radio tanlovlari matndan ustun turadi (foydalanuvchi oxirgi ko'rgan holat)
        key = dict(text_key)
        key.update(radios)

        self.answer_key_map = key
        self.missing_numbers = [n for n in range(1, count + 1) if n not in key]

        if count and self.missing_numbers:
            raise forms.ValidationError(
                'Javob kaliti to\'liq emas. Belgilanmagan savollar: '
                + ', '.join(str(n) for n in self.missing_numbers)
                + '.'
            )
        return cleaned


class TestQuestionForm(forms.ModelForm):
    """Bitta savol formasi — ikkala rejimni ham qo'llab-quvvatlaydi.

    mode='text' — savol matni va A/B/C/D variantlari majburiy.
    mode='file' — rasm yoki PDF fayl majburiy, variantlar ixtiyoriy,
                  faqat to'g'ri javob harfi (A-D) belgilanadi.
    """

    class Meta:
        model = TestQuestion
        fields = [
            'mode',
            'question_text',
            'file',
            'image',
            'resource_pdf',
            'option_a',
            'option_b',
            'option_c',
            'option_d',
            'correct_option',
        ]
        widgets = {
            'mode': forms.HiddenInput(),
            'question_text': forms.Textarea(attrs={'rows': 3, 'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'file': forms.ClearableFileInput(attrs={'accept': '.pdf,image/*', 'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'image': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'resource_pdf': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-violet-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'option_a': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'option_b': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'option_c': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'option_d': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'correct_option': forms.Select(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Model maydonlari blank=True — majburiylikni rejimga qarab o'zimiz belgilaymiz.
        for name in ('question_text', 'option_a', 'option_b', 'option_c', 'option_d'):
            self.fields[name].required = False
        self.fields['file'].required = False
        self.fields['image'].required = False
        self.fields['resource_pdf'].required = False

    def clean_file(self):
        return validate_question_file(self.cleaned_data.get('file'))

    def clean_resource_pdf(self):
        pdf = self.cleaned_data.get('resource_pdf')
        if pdf and not pdf.name.lower().endswith('.pdf'):
            raise forms.ValidationError('Savol PDF fayli faqat .pdf formatida bo‘lishi kerak.')
        return pdf

    def clean(self):
        cleaned = super().clean()
        mode = cleaned.get('mode') or TestQuestion.MODE_TEXT
        if mode not in (TestQuestion.MODE_TEXT, TestQuestion.MODE_FILE, TestQuestion.MODE_SHARED):
            mode = TestQuestion.MODE_TEXT
        cleaned['mode'] = mode

        if mode == TestQuestion.MODE_SHARED:
            # Umumiy fayl test.nikida turadi — savolga alohida fayl yuklash shart emas.
            if not cleaned.get('correct_option'):
                self.add_error('correct_option', 'To\'g\'ri javob harfini (A-D) tanlang.')
        elif mode == TestQuestion.MODE_FILE:
            has_file = bool(
                cleaned.get('file')
                or cleaned.get('image')
                or cleaned.get('resource_pdf')
                or (self.instance and self.instance.pk and self.instance.display_file)
            )
            if not has_file:
                self.add_error('file', 'Rasm yoki PDF fayl yuklang.')
            # Fayl rejimida variantlar shart emas — bo'sh bo'lsa ham saqlanadi.
        else:
            missing = [
                label for name, label in (
                    ('question_text', 'Savol matni'),
                    ('option_a', 'A varianti'),
                    ('option_b', 'B varianti'),
                    ('option_c', 'C varianti'),
                    ('option_d', 'D varianti'),
                ) if not (cleaned.get(name) or '').strip()
            ]
            if missing:
                raise forms.ValidationError('Odatiy rejimda quyidagilar to\'ldirilishi shart: ' + ', '.join(missing) + '.')

        return cleaned
