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


class TestForm(forms.ModelForm):
    class Meta:
        model = Test
        fields = ['title', 'subject', 'cover_image', 'resource_pdf', 'is_published']
        widgets = {
            'title': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'subject': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'cover_image': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'resource_pdf': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-violet-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'is_published': forms.CheckboxInput(attrs={'class': 'h-4 w-4 rounded border-white/20 bg-white/5 text-cyan-400 focus:ring-cyan-400'}),
        }

    def clean_resource_pdf(self):
        pdf = self.cleaned_data.get('resource_pdf')
        if pdf and not pdf.name.lower().endswith('.pdf'):
            raise forms.ValidationError('Test PDF fayli faqat .pdf formatida bo‘lishi kerak.')
        return pdf


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
        if mode not in (TestQuestion.MODE_TEXT, TestQuestion.MODE_FILE):
            mode = TestQuestion.MODE_TEXT
        cleaned['mode'] = mode

        if mode == TestQuestion.MODE_FILE:
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
