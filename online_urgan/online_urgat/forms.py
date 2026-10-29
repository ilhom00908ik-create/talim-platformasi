from django import forms

from .models import TeacherApplication, Test, TestQuestion


class TeacherRegistrationForm(forms.ModelForm):
    class Meta:
        model = TeacherApplication
        fields = ['phone', 'bio', 'experience_years', 'photo']

    def clean_certificate_pdf(self):
        file = self.cleaned_data.get('certificate_pdf')
        if file:
            if not file.name.endswith('.pdf'):
                raise forms.ValidationError('Faqat PDF formatidagi fayllarni yuklash mumkin!')
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
    class Meta:
        model = TestQuestion
        fields = [
            'question_text',
            'image',
            'resource_pdf',
            'option_a',
            'option_b',
            'option_c',
            'option_d',
            'correct_option',
        ]
        widgets = {
            'question_text': forms.Textarea(attrs={'rows': 3, 'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'image': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'resource_pdf': forms.ClearableFileInput(attrs={'class': 'block w-full text-sm text-slate-200 file:mr-3 file:rounded-xl file:border-0 file:bg-violet-500/80 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white'}),
            'option_a': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'option_b': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'option_c': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'option_d': forms.TextInput(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
            'correct_option': forms.Select(attrs={'class': 'w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/80'}),
        }

    def clean_resource_pdf(self):
        pdf = self.cleaned_data.get('resource_pdf')
        if pdf and not pdf.name.lower().endswith('.pdf'):
            raise forms.ValidationError('Savol PDF fayli faqat .pdf formatida bo‘lishi kerak.')
        return pdf
