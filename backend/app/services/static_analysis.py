import ast
import json
import re
import subprocess
from typing import List, Dict

try:
    from radon.complexity import cc_visit
    from radon.metrics import mi_visit
    from radon.raw import analyze
except ImportError:
    cc_visit = None
    mi_visit = None
    analyze = None

from app.core.config import settings


# ==========================================
# Utility Functions
# ==========================================

def detect_language(filename: str) -> str:
    if filename.endswith(".py"):
        return "python"
    elif filename.endswith(".java"):
        return "java"
    elif filename.endswith(".js"):
        return "javascript"
    return "unknown"


# ==========================================
# Static Code Metrics
# ==========================================

def analyze_python_code(code: str) -> Dict:
    if analyze and cc_visit and mi_visit:
        raw = analyze(code)
        complexity = cc_visit(code)
        mi = mi_visit(code, True)
        loc = raw.loc
        avg_complexity = (
            sum(c.complexity for c in complexity) / len(complexity)
            if complexity else 0
        )
    else:
        # Fallback metrics when radon is unavailable.
        lines = [line for line in code.split("\n") if line.strip()]
        loc = len(lines)
        avg_complexity = float(code.count("if ") + code.count("for ") + code.count("while "))
        mi = max(0.0, 100.0 - avg_complexity * 2.5)

    duplication_percentage = detect_duplicates(code)
    code_smells = detect_code_smells(avg_complexity, loc)

    patterns = detect_design_patterns(code)
    advanced_usage = detect_advanced_constructs(code)

    return {
        "lines_of_code": loc,
        "cyclomatic_complexity": avg_complexity,
        "maintainability_index": mi,
        "duplication_percentage": duplication_percentage,
        "code_smells": code_smells,
        "design_patterns_detected": patterns,
        "advanced_constructs": advanced_usage
    }


# ==========================================
# Duplicate Detection
# ==========================================

def detect_duplicates(code: str) -> float:
    lines = [line.strip() for line in code.split("\n") if line.strip()]
    total = len(lines)
    unique = len(set(lines))

    if total == 0:
        return 0.0

    duplication = ((total - unique) / total) * 100
    return round(duplication, 2)


# ==========================================
# Code Smell Detection
# ==========================================

def detect_code_smells(avg_complexity: float, loc: int) -> int:
    smells = 0
    if avg_complexity > settings.MAX_CYCLOMATIC_COMPLEXITY:
        smells += 1
    if loc > 300:
        smells += 1
    return smells


# ==========================================
# Design Pattern Detection (Heuristic)
# ==========================================

def detect_design_patterns(code: str) -> List[str]:
    patterns = []

    if "class" in code and "__new__" in code:
        patterns.append("Singleton")

    if "Factory" in code:
        patterns.append("Factory")

    if "Observer" in code:
        patterns.append("Observer")

    return patterns


# ==========================================
# Advanced Construct Detection
# ==========================================

def detect_advanced_constructs(code: str) -> List[str]:
    constructs = []

    if "lambda" in code:
        constructs.append("Lambda Functions")

    if "async def" in code:
        constructs.append("Async Programming")

    if "@dataclass" in code:
        constructs.append("Data Classes")

    if "with " in code:
        constructs.append("Context Managers")

    return constructs


# ==========================================
# Technical Depth Score
# ==========================================

def compute_technical_depth(metrics: Dict) -> float:
    weights = settings.TECHNICAL_DEPTH_WEIGHTS

    score = (
        (metrics["cyclomatic_complexity"] * weights["cyclomatic_complexity"]) +
        (len(metrics["design_patterns_detected"]) * 10 * weights["design_patterns"]) +
        (len(metrics["advanced_constructs"]) * 10 * weights["advanced_constructs"])
    )

    return round(min(score, 100), 2)


# ==========================================
# Developer Skill Classification
# ==========================================

def classify_skill(score: float) -> str:
    thresholds = settings.SKILL_LEVEL_THRESHOLDS

    if score < thresholds["beginner"]:
        return "Beginner"
    elif score < thresholds["intermediate"]:
        return "Intermediate"
    elif score < thresholds["advanced"]:
        return "Advanced"
    return "Expert"


# ==========================================
# Learning Suggestions
# ==========================================

def generate_learning_suggestions(skill: str) -> List[str]:
    if skill == "Beginner":
        return [
            "Learn OOP principles",
            "Improve modularization",
            "Practice writing unit tests"
        ]
    elif skill == "Intermediate":
        return [
            "Explore design patterns",
            "Reduce complexity",
            "Implement async programming"
        ]
    else:
        return [
            "Focus on architecture design",
            "Improve scalability patterns",
            "Contribute to open source"
        ]


# ==========================================
# Security Analysis (Bandit)
# ==========================================

def run_bandit_scan(file_path: str) -> Dict:
    try:
        commands = [
            ["bandit", "-f", "json", file_path],
            ["python", "-m", "bandit", "-f", "json", file_path],
        ]

        for command in commands:
            result = subprocess.run(command, capture_output=True, text=True)

            if not result.stdout:
                continue

            try:
                data = json.loads(result.stdout)
            except json.JSONDecodeError:
                continue

            issues = data.get("results", [])
            high_count = sum(1 for i in issues if i.get("issue_severity") == "HIGH")
            medium_count = sum(1 for i in issues if i.get("issue_severity") == "MEDIUM")
            low_count = sum(1 for i in issues if i.get("issue_severity") == "LOW")

            return {
                "total_issues": len(issues),
                # Bandit does not have a separate "CRITICAL" severity, so we treat HIGH as critical risk too.
                "critical_issues": high_count,
                "high_issues": high_count,
                "medium_issues": medium_count,
                "low_issues": low_count,
                "issues_summary": [i.get("issue_text", "Security issue detected") for i in issues[:5]],
            }

    except Exception:
        pass

    return {
        "total_issues": 0,
        "critical_issues": 0,
        "high_issues": 0,
        "medium_issues": 0,
        "low_issues": 0,
        "issues_summary": []
    }


# ==========================================
# Compliance Check
# ==========================================

def compliance_check(code: str) -> Dict:
    documentation_present = '"""' in code or "'''" in code
    hardcoded_secret = bool(re.search(r"(password\s*=\s*['\"])", code))
    type_hint_present = ":" in code and "->" in code

    max_function_violation = any(
        len(func.body) > settings.COMPLIANCE_RULES["max_function_length"]
        for func in ast.walk(ast.parse(code))
        if isinstance(func, ast.FunctionDef)
    )

    compliant = not (
        hardcoded_secret or max_function_violation
    )

    return {
        "documentation_present": documentation_present,
        "max_function_length_violation": max_function_violation,
        "hardcoded_secrets_detected": hardcoded_secret,
        "type_hint_coverage_ok": type_hint_present,
        "compliant": compliant
    }


# ==========================================
# CI/CD Gate
# ==========================================

def cicd_gate(metrics: Dict, bug_probability: float, security: Dict) -> Dict:
    reasons = []

    if bug_probability > settings.CI_CD_BLOCK_IF["bug_probability_above"]:
        reasons.append("High bug probability")

    if metrics["cyclomatic_complexity"] > settings.CI_CD_BLOCK_IF["complexity_above"]:
        reasons.append("High complexity")

    if security["critical_issues"] > 0:
        reasons.append("Critical security issue detected")

    return {
        "allowed_to_merge": len(reasons) == 0,
        "blocking_reasons": reasons
    }