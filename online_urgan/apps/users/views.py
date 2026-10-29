from django.shortcuts import render, redirect
from django.contrib.auth import login, authenticate
from django.contrib.auth.hashers import make_password
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import CustomUser

# Vaqtinchalik SMS kodlarni saqlash (Sizda sms.uz to'liq ulanguncha kodni 1234 deb kiritib test qilamiz)
SMS_STORAGE = {}

# Bosh sahifa (index.html)
def index_page(request):
    return render(request, 'index.html')

# Test ishlash sahifasi (quiz_view.html)
def quiz_page(request):
    return render(request, 'quiz_view.html')

# Profil sahifasi (profile.html)
def profile_page(request):
    return render(request, 'profile.html')

# Ro'yxatdan o'tish oynasi (HTML va API birga)
class RegisterView(APIView):
    def get(self, request):
        return render(request, 'register.html')

    def post(self, request):
        # Brauzer formasi yoki API'dan ma'lumotlarni olish
        data = request.data if request.data else request.POST
        phone_number = data.get('phone_number')
        password = data.get('password')
        confirm_password = data.get('confirm_password')
        first_name = data.get('first_name')
        last_name = data.get('last_name')
        secret_key = data.get('secret_key')

        if password != confirm_password:
            return render(request, 'register.html', {"error": "Parollar mos kelmadi!"})

        if CustomUser.objects.filter(phone_number=phone_number).exists():
            return render(request, 'register.html', {"error": "Bu raqam allaqachon ro'yxatdan o'tgan!"})

        # Vaqtinchalik saqlaymiz. Test qilish uchun SMS kod: 1234
        SMS_STORAGE[phone_number] = {
            "sms_code": "1234",
            "user_data": {
                "phone_number": phone_number,
                "password": make_password(password),
                "first_name": first_name,
                "last_name": last_name,
                "secret_key": secret_key,
                "email": data.get('email', '')
            }
        }
        # SMS kod kiritish sahifasiga o'tkazamiz
        return render(request, 'verify.html', {"phone_number": phone_number})

# SMS tasdiqlash oynasi
class VerifySMSView(APIView):
    def post(self, request):
        data = request.data if request.data else request.POST
        phone_number = data.get('phone_number')
        code = data.get('code')

        if phone_number not in SMS_STORAGE:
            return redirect('register')

        saved_data = SMS_STORAGE[phone_number]

        if saved_data['sms_code'] == str(code):
            user_info = saved_data['user_data']
            user = CustomUser.objects.create(
                phone_number=user_info['phone_number'],
                password=user_info['password'],
                first_name=user_info['first_name'],
                last_name=user_info['last_name'],
                secret_key=user_info['secret_key'],
                email=user_info['email'],
                is_verified=True
            )
            del SMS_STORAGE[phone_number]
            return redirect('index') # Ro'yxatdan o'tgach bosh sahifaga o'tadi
        else:
            return render(request, 'verify.html', {"phone_number": phone_number, "error": "Kod noto'g'ri!"})
