import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ==========================================
    # Application
    # ==========================================
    APP_NAME: str = "Code Intelligence AI"
    VERSION: str = "1.0.0"
    DEBUG: bool = True

    # ==========================================
    # Dataset Configuration
    # ==========================================
    # Recommended: NASA PROMISE Dataset (Kaggle)
    DATASET_PATH: str = os.getenv("DATASET_PATH", "datasets/nasa_promise.csv")
    MODEL_SAVE_PATH: str = os.getenv("MODEL_SAVE_PATH", "models/")
    REPORTS_PATH: str = os.getenv("REPORTS_PATH", "reports/")

    # ==========================================
    # Supported Programming Languages
    # ==========================================
    SUPPORTED_LANGUAGES = ["python", "java", "javascript"]

    # ==========================================
    # ML Models to Train
    # ==========================================
    ML_MODELS = {
        "random_forest": True,
        "gradient_boosting": True,
        "decision_tree": True,
        "bagging": True,
        "adaboost": True,
        "svm": True,
        "extra_trees": True
    }

    # ==========================================
    # Quality Thresholds
    # ==========================================
    MAX_CYCLOMATIC_COMPLEXITY = 10
    MAX_DUPLICATION_PERCENT = 15
    MIN_MAINTAINABILITY_INDEX = 65
    MAX_CODE_SMELLS = 10

    # ==========================================
    # Security Thresholds
    # ==========================================
    MAX_SECURITY_WARNINGS = 5
    CRITICAL_SECURITY_BLOCK = True

    # ==========================================
    # Technical Depth Score Weights
    # ==========================================
    TECHNICAL_DEPTH_WEIGHTS = {
        "cyclomatic_complexity": 0.25,
        "design_patterns": 0.20,
        "documentation_ratio": 0.10,
        "modularity": 0.15,
        "ml_usage": 0.10,
        "advanced_constructs": 0.20
    }

    # ==========================================
    # Developer Skill Classification Thresholds
    # ==========================================
    SKILL_LEVEL_THRESHOLDS = {
        "beginner": 40,
        "intermediate": 70,
        "advanced": 85
    }

    # ==========================================
    # CI/CD Quality Gate
    # ==========================================
    CI_CD_BLOCK_IF = {
        "bug_probability_above": 0.6,
        "complexity_above": 15,
        "security_critical": True
    }

    # ==========================================
    # Compliance Rules
    # ==========================================
    COMPLIANCE_RULES = {
        "documentation_required": True,
        "max_function_length": 75,
        "no_hardcoded_secrets": True,
        "enforce_type_hints": True
    }

    # ==========================================
    # AI Explainability
    # ==========================================
    ENABLE_SHAP: bool = True

    # ==========================================
    # GitHub Integration
    # ==========================================
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")


settings = Settings()