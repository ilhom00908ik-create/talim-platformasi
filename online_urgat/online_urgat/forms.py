from django import forms
from .models import TeacherApplication

class TeacherRegistrationForm(forms.ModelForm):
    class Meta:
        model = TeacherApplication
        fields = ['phone', 'bio', 'experience_years', 'photo']
    
    def clean_certificate_pdf(self):
        file = self.cleaned_data.get('certificate_pdf')
        if file:
            # Fayl kengaytmasini tekshiramiz
            if not file.name.endswith('.pdf'):
                raise forms.ValidationError("Faqat PDF formatidagi fayllarni yuklash mumkin!")
        return file