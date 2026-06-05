# Autonomous IT Operations Intelligence Platform (MVP)

A working web application demonstrating how IT Operations, SRE, and NOC teams can move from traditional monitoring to AI-assisted and autonomous operations — using **synthetic data only**.

## Features

| Module | Description |
|--------|-------------|
| **Overview Dashboard** | Command center with incidents, alerts, early warnings, quick actions |
| **Dependency Map** | Interactive topology with 7 views, heatmaps, CRUD, path highlighting |
| **Monitoring Dashboard** | Executive, Service, Technical, Infrastructure views |
| **Incident Explorer** | Browse 500+ resolved incidents with full RCA context |
| **RCA Dashboard** | Predict root causes from alerts/symptoms with confidence scores |
| **Blast Radius** | Impact prediction with visual dependency overlay |
| **Early Failure Detection** | Pattern-based pre-incident warnings |
| **Investigation Workflow** | Autonomous AI investigation with simulated remediation |
| **AI Copilot** | Natural language ops assistant |
| **Data Admin** | Regenerate/upload synthetic JSON datasets |

## Tech Stack

- **Frontend:** React, TypeScript, Tailwind CSS, React Flow
- **Backend:** Python FastAPI
- **Data:** JSON flat files (500 incidents, knowledge graph, synthetic data center)

## Quick Start

```bash
# 1. Generate synthetic data
python3 scripts/generate_synthetic_data.py

# 2. Backend
cd backend && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Frontend
cd frontend && npm install && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Knowledge Graph Model

Seven first-class constructs per incident:
1. **Alert** → 2. **Symptom** → 3. **Incident** → 4. **Root Cause** → 5. **Fix** → 6. **Impacted Components** → 7. **Context**

Relationships include: TRIGGERS, ASSOCIATED_WITH, CAUSED_BY, RESOLVED_BY, IMPACTED, DEPENDS_ON, PRECEDES, CO_OCCURS_WITH, RECURS_WITH — each with frequency, confidence, and incident references.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/overview` | Command center summary |
| `GET /api/knowledge-graph` | Full RCA knowledge graph |
| `POST /api/rca/analyze` | Root cause prediction |
| `POST /api/blast-radius/analyze` | Impact & blast radius |
| `GET /api/early-detection/analyze` | Early failure patterns |
| `POST /api/investigations` | Start AI investigation |
| `POST /api/copilot/ask` | AI copilot Q&A |
| `GET /api/incidents/` | List/search incidents |
| `GET /api/admin/data-status` | Data file status |
