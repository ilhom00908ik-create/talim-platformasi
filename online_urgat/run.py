import subprocess
import sys
import time

def run_services():
    print("🚀 Online O'rgat loyihasi va Telegram bot birgalikda ishga tushirilmoqda...")
    
    # 1. Django serverini ishga tushiramiz
    django_process = subprocess.Popen([sys.executable, "manage.py", "runserver"])
    
    # Sal kutamizki Django server ulanib ulgurtsin
    time.sleep(2)
    
    # 2. Telegram botni ishga tushiramiz
    bot_process = subprocess.Popen([sys.executable, "bot.py"])
    
    try:
        # Ikkala jarayon ham ishlayverishini ta'minlaymiz
        django_process.wait()
        bot_process.wait()
    except KeyboardInterrupt:
        print("\n🛑 Barcha xizmatlar to'xtatilmoqda...")
        django_process.terminate()
        bot_process.terminate()

if __name__ == "__main__":
    run_services()