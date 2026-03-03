from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import (
    bracket,
    export_router,
    results,
    schedule,
    standings,
    teams,
    tournaments,
)

app = FastAPI(title="Torneo Calcetto Saponato", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


app.include_router(tournaments.router)
app.include_router(teams.router)
app.include_router(schedule.router)
app.include_router(results.router)
app.include_router(standings.router)
app.include_router(bracket.router)
app.include_router(export_router.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
