import re
import json

raw_bad_json = """{
  "summary": "No active incidents are reported in the context payload, making it challenging to determine the root cause of incidents.",
  "findings": ["No related incidents are listed in the context payload", "No related alerts are present to indicate potential issues", "No entity data is available for the Executive Command Center"],
  "evidence": ["related_incidents": [], "related_alerts": []],
  "recommended_actions": ["Review system logs and monitoring data to identify potential issues", "Check dashboard health configuration"]
}"""

def lenient_parse(text: str) -> dict:
    result = {
        "summary": "",
        "findings": [],
        "evidence": [],
        "recommended_actions": [],
        "confidence": "",
    }
    
    # 1. Try to find the summary
    summary_match = re.search(r'"summary"\s*:\s*"([\s\S]*?)"\s*(?:,|\n\s*"|\})', text)
    if summary_match:
        result["summary"] = summary_match.group(1).replace('\\"', '"').replace('\\n', '\n')
    else:
        summary_match = re.search(r'"summary"\s*:\s*([\s\S]*?)(?:,|\n\s*"|\n\s*\})', text)
        if summary_match:
            result["summary"] = summary_match.group(1).strip('"\' ')

    # 2. Try to find findings
    findings_match = re.search(r'"findings"\s*:\s*\[([\s\S]*?)\]', text)
    if findings_match:
        items_raw = findings_match.group(1)
        items = re.findall(r'"([\s\S]*?)"', items_raw)
        result["findings"] = items

    # 3. Try to find evidence
    evidence_match = re.search(r'"evidence"\s*:\s*\[([\s\S]*?)\]', text)
    if evidence_match:
        items_raw = evidence_match.group(1)
        items = re.findall(r'"([\s\S]*?)"', items_raw)
        if not items and ":" in items_raw:
            items = [item.strip().strip('"\'') for item in items_raw.split(",") if item.strip()]
        result["evidence"] = items

    # 4. Try to find recommended_actions
    actions_match = re.search(r'"recommended_actions"\s*:\s*\[([\s\S]*?)\]', text)
    if actions_match:
        items_raw = actions_match.group(1)
        items = re.findall(r'"([\s\S]*?)"', items_raw)
        result["recommended_actions"] = items

    # 5. Try to find confidence
    conf_match = re.search(r'"confidence"\s*:\s*"([^"]*)"', text)
    if conf_match:
        result["confidence"] = conf_match.group(1)
        
    return result

parsed = lenient_parse(raw_bad_json)
print(json.dumps(parsed, indent=2))
