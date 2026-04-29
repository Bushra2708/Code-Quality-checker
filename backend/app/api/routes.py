import os
import numpy as np
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from app.schemas.response_schema import (
    FullAnalysisResponse,
    CodeMetrics,
    SecurityReport,
    BugPrediction,
    CodeImprovement,
    DeveloperProfile,
    ComplianceReport,
    CICDGate
)

from app.services.static_analysis import (
    analyze_python_code,
    compute_technical_depth,
    classify_skill,
    generate_learning_suggestions,
    run_bandit_scan,
    compliance_check,
    cicd_gate,
    detect_language
)

from app.services.ml_models import MLModelManager

router = APIRouter()
ml_manager = MLModelManager()


# ==========================================
# Train ML Models
# ==========================================

@router.post("/train-models")
def train_models():
    best_model, score = ml_manager.train_models()
    return {
        "message": "Models trained successfully",
        "best_model": best_model,
        "accuracy": score
    }


# ==========================================
# Full Code Analysis Endpoint
# ==========================================

@router.post("/analyze", response_model=FullAnalysisResponse)
async def analyze_code(file: UploadFile = File(...)):

    content = await file.read()
    code = content.decode("utf-8")
    language = detect_language(file.filename)

    if language != "python":
        raise HTTPException(status_code=400, detail="Currently only Python fully supported")

    # --------------------------------------
    # Static Analysis
    # --------------------------------------
    metrics_data = analyze_python_code(code)

    metrics = CodeMetrics(
        lines_of_code=metrics_data["lines_of_code"],
        cyclomatic_complexity=metrics_data["cyclomatic_complexity"],
        maintainability_index=metrics_data["maintainability_index"],
        duplication_percentage=metrics_data["duplication_percentage"],
        code_smells=metrics_data["code_smells"],
        design_patterns_detected=metrics_data["design_patterns_detected"]
    )

    # --------------------------------------
    # Security
    # --------------------------------------
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as temp_file:
        temp_file.write(code)
        temp_path = temp_file.name

    try:
        security_data = run_bandit_scan(temp_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    security = SecurityReport(**security_data)

    # --------------------------------------
    # ML Bug Prediction
    # --------------------------------------
    feature_dict = {
        "lines_of_code": metrics.lines_of_code,
        "cyclomatic_complexity": metrics.cyclomatic_complexity,
        "maintainability_index": metrics.maintainability_index,
        "duplication_percentage": metrics.duplication_percentage,
        "code_smells": metrics.code_smells,
    }

    try:
        bug_data = ml_manager.predict(feature_dict)
    except Exception:
        # If models are not trained yet, train once and retry.
        try:
            ml_manager.train_models()
            bug_data = ml_manager.predict(feature_dict)
        except Exception:
            bug_data = {
                "bug_probability": 0.0,
                "predicted_label": "Unknown",
                "model_used": "N/A",
                "shap_explanation": None,
            }

    bug_prediction = BugPrediction(**bug_data)

    # --------------------------------------
    # Developer Intelligence
    # --------------------------------------
    technical_depth = compute_technical_depth(metrics_data)
    skill_level = classify_skill(technical_depth)
    learning = generate_learning_suggestions(skill_level)

    developer_profile = DeveloperProfile(
        technical_depth_score=technical_depth,
        developer_skill_level=skill_level,
        detected_patterns=metrics.design_patterns_detected,
        advanced_construct_usage=metrics_data["advanced_constructs"],
        learning_suggestions=learning
    )

    # --------------------------------------
    # Improvements
    # --------------------------------------
    improvements = CodeImprovement(
        refactoring_suggestions=[
            "Break large functions into smaller ones" if metrics.lines_of_code > 200 else ""
        ],
        optimization_suggestions=[
            "Reduce cyclomatic complexity" if metrics.cyclomatic_complexity > 10 else ""
        ],
        security_suggestions=security.issues_summary
    )
    improvements.refactoring_suggestions = [s for s in improvements.refactoring_suggestions if s]
    improvements.optimization_suggestions = [s for s in improvements.optimization_suggestions if s]

    # --------------------------------------
    # Compliance
    # --------------------------------------
    compliance_data = compliance_check(code)
    compliance = ComplianceReport(**compliance_data)

    # --------------------------------------
    # CI/CD Gate
    # --------------------------------------
    cicd_data = cicd_gate(metrics_data, bug_prediction.bug_probability, security_data)
    cicd = CICDGate(**cicd_data)

    return FullAnalysisResponse(
        file_name=file.filename,
        language=language,
        metrics=metrics,
        security=security,
        bug_prediction=bug_prediction,
        improvements=improvements,
        developer_profile=developer_profile,
        compliance=compliance,
        cicd_gate=cicd
    )