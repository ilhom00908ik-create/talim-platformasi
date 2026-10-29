from django import forms
from django.contrib.auth.models import User
from .models import UserProfile

class RegisterForm(forms.ModelForm):
    phone_number = forms.CharField(max_length=15, label="Telefon raqam", widget=forms.TextInput(attrs={'class': 'form-control', 'placeholder': '+998901234567'}))
    password = forms.CharField(widget=forms.PasswordInput(attrs={'class': 'form-control'}), label="Parol")
    confirm_password = forms.CharField(widget=forms.PasswordInput(attrs={'class': 'form-control'}), label="Parolni tasdiqlang")
    device_secret_key = forms.CharField(max_length=50, widget=forms.TextInput(attrs={'class': 'form-control', 'placeholder': 'Masalan: maxfiysoz123'}), label="Maxfiy kalit (Boshqa qurilmalar uchun)")

    class Meta:
        model = User
        fields = ['username', 'email']
        widgets = {
            'username': forms.TextInput(attrs={'class': 'form-control'}),
            'email': forms.EmailInput(attrs={'class': 'form-control'}),
        }

    def clean(self):
        cleaned_data = super().clean()
        password = cleaned_data.get("password")
        confirm_password = cleaned_data.get("confirm_password")

        if password != confirm_password:
            raise forms.ValidationError("Parollar bir xil emas!")
        return cleaned_data