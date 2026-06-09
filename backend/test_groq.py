import os
import json
from pathlib import Path
from dotenv import load_dotenv
import httpx

# Load .env from the backend directory (project root .env)
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

api_key = os.getenv('GROQ_API_KEY')
base_url = os.getenv('GROQ_BASE_URL', 'https://api.groq.com/openai/v1')
if not api_key:
    print('GROQ_API_KEY not set')
    raise SystemExit(1)

headers = {
    'Authorization': f'Bearer {api_key}',
    'Content-Type': 'application/json'
}
payload = {
    'model': 'llama-3.3-70b-versatile',
    'messages': [{'role': 'user', 'content': 'Hello'}],
    'temperature': 0.2
}
url = f"{base_url}/chat/completions"
try:
    response = httpx.post(url, headers=headers, json=payload, timeout=15)
    response.raise_for_status()
    print('Status:', response.status_code)
    print(json.dumps(response.json(), indent=2)[:1000])
except Exception as e:
    print('Error:', e)
