from typing import List, Dict, Optional

from pydantic import BaseModel


class CodeMetrics(BaseModel):
    lines_of_code: int
    cyclomatic_complexity: float
    maintainability_index: float
    duplication_percentage: float
    code_smells: int
    design_patterns_detected: List[str]


class SecurityReport(BaseModel):
    total_issues: int
    critical_issues: int
    high_issues: int
    medium_issues: int
    low_issues: int
    issues_summary: List[str]


class BugPrediction(BaseModel):
    bug_probability: float
    predicted_label: str
    model_used: str
    shap_explanation: Optional[Dict[str, float]] = None


class CodeImprovement(BaseModel):
    refactoring_suggestions: List[str]
    optimization_suggestions: List[str]
    security_suggestions: List[str]


class DeveloperProfile(BaseModel):
    technical_depth_score: float
    developer_skill_level: str
    detected_patterns: List[str]
    advanced_construct_usage: List[str]
    learning_suggestions: List[str]


class ComplianceReport(BaseModel):
    documentation_present: bool
    max_function_length_violation: bool
    hardcoded_secrets_detected: bool
    type_hint_coverage_ok: bool
    compliant: bool


class CICDGate(BaseModel):
    allowed_to_merge: bool
    blocking_reasons: List[str]


class FullAnalysisResponse(BaseModel):
    file_name: str
    language: str
    metrics: CodeMetrics
    security: SecurityReport
    bug_prediction: BugPrediction
    improvements: CodeImprovement
    developer_profile: DeveloperProfile
    compliance: ComplianceReport
    cicd_gate: CICDGate
