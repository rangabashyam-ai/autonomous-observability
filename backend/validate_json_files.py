import os
import json

data_dir = "data"
for root, dirs, files in os.walk(data_dir):
    for f in files:
        if f.endswith(".json"):
            path = os.path.join(root, f)
            try:
                with open(path, "r", encoding="utf-8") as file:
                    json.load(file)
            except Exception as e:
                print(f"ERROR in {path}: {e}")
print("Validation complete.")
