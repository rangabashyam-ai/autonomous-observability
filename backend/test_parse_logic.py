import re
import json

raw_bad_json = """{
  "summary": "No active incidents are reported in the context payload, making it challenging to determine the root cause of incidents.",
  "findings": ["No related incidents are listed in the context payload", "No related metrics or alerts are provided to aid in root cause analysis"],
  "evidence": ["related_incidents": []],
  "recommended_actions": ["Review incident management systems for active incidents", "Gather relevant metrics and alerts to aid in root cause analysis"],
  "confidence": \""""

def _regex_lenient_parse(text: str) -> dict:
    result = {
        "summary": "",
        "findings": [],
        "evidence": [],
        "recommended_actions": [],
        "confidence": "",
    }
    
    summary_match = re.search(r'"summary"\s*:\s*"([\s\S]*?)"\s*(?:,|\n\s*"|\})', text)
    if summary_match:
        result["summary"] = summary_match.group(1).replace('\\"', '"').replace('\\n', '\n')
    else:
        summary_match = re.search(r'"summary"\s*:\s*([\s\S]*?)(?:,|\n\s*"|\n\s*\})', text)
        if summary_match:
            result["summary"] = summary_match.group(1).strip('"\' ')

    for key in ["findings", "evidence", "recommended_actions"]:
        match = re.search(rf'"{key}"\s*:\s*\[([\s\S]*?)\]', text)
        if match:
            items_raw = match.group(1)
            items = re.findall(r'"([\s\S]*?)"', items_raw)
            if not items and ":" in items_raw:
                parts = items_raw.split(",")
                for p in parts:
                    if ":" in p:
                        k_val = p.split(":", 1)[0].strip().strip('"\'')
                        if k_val:
                            items.append(k_val)
                    else:
                        val = p.strip().strip('"\'')
                        if val:
                            items.append(val)
            result[key] = items

    conf_match = re.search(r'"confidence"\s*:\s*"([^"]*)"', text)
    if conf_match:
        result["confidence"] = conf_match.group(1)
        
    return result

parsed = _regex_lenient_parse(raw_bad_json)
print("Parsed:")
print(json.dumps(parsed, indent=2))
print("summary_match search:", re.search(r'"summary"\s*:\s*"([\s\S]*?)"\s*(?:,|\n\s*"|\})', raw_bad_json))
