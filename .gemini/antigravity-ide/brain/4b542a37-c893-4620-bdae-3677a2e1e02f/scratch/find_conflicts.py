with open(r"c:\Users\GKDSSPSairam\autonomous-observability\frontend\src\pages\BlastRadiusDashboard.tsx", 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if line.startswith("<<<<<<<") or line.startswith("=======") or line.startswith(">>>>>>>"):
        print(f"Line {idx+1}: {line.strip()}")
        # Print surrounding context
        start = max(0, idx - 5)
        end = min(len(lines), idx + 6)
        for i in range(start, end):
            prefix = "-> " if i == idx else "   "
            print(f"{prefix}{i+1}: {lines[i].rstrip()}")
        print("-" * 50)
