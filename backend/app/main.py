from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings


# ==========================================
# Initialize App
# ==========================================

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG
)


# ==========================================
# CORS Configuration (for frontend)
# ==========================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# Register Routes
# ==========================================

app.include_router(router, prefix="/api")


# ==========================================
# Health Check
# ==========================================

@app.get("/")
def root():
    return {
        "message": "Code Intelligence AI Backend Running",
        "version": settings.VERSION
    }