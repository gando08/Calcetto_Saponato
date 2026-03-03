# Torneo Calcetto Saponato

Applicazione web per organizzare tornei di calcetto saponato con scheduling ottimizzato.

## Avvio rapido

### Con Docker

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Docs API: http://localhost:8000/docs

### Sviluppo locale

Backend:

```bash
cd backend
pip install -r requirements.txt
mkdir -p data
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Carica demo:

```bash
cd backend
python seed_demo.py
```

## Test

```bash
cd backend
python -m pytest tests -v
```

## Struttura

- `/backend` - FastAPI + OR-Tools + SQLite
- `/frontend` - React 18 + TypeScript + Vite
- `/docs/plans` - Design doc e piano di implementazione
