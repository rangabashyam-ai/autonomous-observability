import urllib.request, json, os, urllib.error
from pathlib import Path
from dotenv import load_dotenv

env_path = Path('backend/.env')
load_dotenv(dotenv_path=env_path)
api_key = os.getenv('GROQ_API_KEY')
print("Key:", api_key[:15] + "...")

req = urllib.request.Request(
    "https://api.groq.com/openai/v1/chat/completions",
    data=json.dumps({
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": "Hello"}],
        "temperature": 0.2
    }).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "AutonomousObservability/1.0"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print("Success:", json.loads(r.read().decode())["choices"][0]["message"]["content"])
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code, e.reason)
    try:
        print("Error Details:", e.read().decode())
    except Exception:
        pass
except Exception as e:
    print("Error:", e)
