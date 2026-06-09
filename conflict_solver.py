from pathlib import Path

def keep_incoming_changes(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    result = []
    state = "normal"

    for line in lines:
        if line.startswith("<<<<<<<"):
            state = "skip_head"
            continue

        if line.startswith("======="):
            state = "keep_incoming"
            continue

        if line.startswith(">>>>>>>"):
            state = "normal"
            continue

        if state == "normal":
            result.append(line)
        elif state == "keep_incoming":
            result.append(line)

    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(result)

    print(f"Resolved: {file_path}")


def process_directory(root_dir):
    for file in Path(root_dir).rglob("*"):
        if file.is_file():
            try:
                with open(file, "r", encoding="utf-8") as f:
                    content = f.read()

                if "<<<<<<<" in content:
                    keep_incoming_changes(file)

            except Exception:
                pass


if __name__ == "__main__":
    process_directory(".")