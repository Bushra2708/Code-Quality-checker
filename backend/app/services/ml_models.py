import os
import joblib
import pandas as pd
import numpy as np
from typing import Optional

try:
    import shap
except ImportError:
    shap = None

from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split

from sklearn.ensemble import (
    RandomForestClassifier,
    GradientBoostingClassifier,
    BaggingClassifier,
    AdaBoostClassifier,
    ExtraTreesClassifier,
)
from sklearn.tree import DecisionTreeClassifier
from sklearn.svm import SVC

from app.core.config import settings


class MLModelManager:
    def __init__(self):
        self.models = {}
        self.scaler = StandardScaler()
        self.feature_columns = None
        self.best_model_name: Optional[str] = None
        os.makedirs(settings.MODEL_SAVE_PATH, exist_ok=True)

    # ======================================
    # Load NASA Dataset (Train + Test)
    # ======================================

    def load_dataset(self):
        """
        Load the NASA PROMISE dataset and derive the same
        feature space we use at prediction time from code
        metrics:
          - lines_of_code
          - cyclomatic_complexity
          - maintainability_index (heuristic)
          - duplication_percentage (placeholder)
          - code_smells (derived from complexity)
        """

        # Resolve dataset paths relative to the backend directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        app_dir = os.path.dirname(current_dir)
        backend_dir = os.path.dirname(app_dir)

        train_path = os.path.join(
            backend_dir, "datasets", "nasa_promise.csv", "Train_data.csv"
        )

        train_df = pd.read_csv(train_path)

        # Target column
        target_column = "Defect"

        y = train_df[target_column]

        # Derive the 5 features used at prediction time
        features = pd.DataFrame()
        features["lines_of_code"] = train_df["LOC_TOTAL"]
        features["cyclomatic_complexity"] = train_df["CYCLOMATIC_COMPLEXITY"]

        # Simple heuristic for maintainability index in range [0, 100]
        mi = 100 - train_df["ESSENTIAL_COMPLEXITY"] * 5
        features["maintainability_index"] = mi.clip(lower=0, upper=100)

        # We don't have duplication info in this dataset – use a placeholder
        features["duplication_percentage"] = 0.0

        # Derive a simple "code smell" count from complexity
        features["code_smells"] = (
            train_df["CYCLOMATIC_COMPLEXITY"] > settings.MAX_CYCLOMATIC_COMPLEXITY
        ).astype(int)

        self.feature_columns = features.columns.tolist()

        X_train, X_test, y_train, y_test = train_test_split(
            features, y, test_size=0.2, random_state=42, stratify=y
        )

        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        return X_train_scaled, X_test_scaled, y_train, y_test

    # ======================================
    # Train All 7 Models
    # ======================================

    def train_models(self):
        X_train, X_test, y_train, y_test = self.load_dataset()

        model_dict = {
            "random_forest": RandomForestClassifier(),
            "gradient_boosting": GradientBoostingClassifier(),
            "decision_tree": DecisionTreeClassifier(),
            "bagging": BaggingClassifier(),
            "adaboost": AdaBoostClassifier(),
            "svm": SVC(probability=True),
            "extra_trees": ExtraTreesClassifier(),
        }

        best_score = 0.0
        best_model_name = None

        for name, model in model_dict.items():
            model.fit(X_train, y_train)

            predictions = model.predict(X_test)
            score = accuracy_score(y_test, predictions)

            print(f"{name} Accuracy: {score}")

            self.models[name] = model

            joblib.dump(model, os.path.join(settings.MODEL_SAVE_PATH, f"{name}.pkl"))

            if score > best_score:
                best_score = score
                best_model_name = name

        self.best_model_name = best_model_name
        if best_model_name:
            joblib.dump(
                {"best_model": best_model_name, "accuracy": float(best_score)},
                os.path.join(settings.MODEL_SAVE_PATH, "meta.pkl"),
            )

        return best_model_name, best_score

    # ======================================
    # Load Model
    # ======================================

    def load_model(self, model_name: str = "random_forest"):
        path = os.path.join(settings.MODEL_SAVE_PATH, f"{model_name}.pkl")

        if not os.path.exists(path):
            raise Exception("Model not trained yet.")

        return joblib.load(path)

    def _load_best_model_name(self) -> str:
        if self.best_model_name:
            return self.best_model_name

        meta_path = os.path.join(settings.MODEL_SAVE_PATH, "meta.pkl")
        if os.path.exists(meta_path):
            try:
                meta = joblib.load(meta_path)
                best = meta.get("best_model")
                if best:
                    self.best_model_name = best
                    return best
            except Exception:
                pass
        return "random_forest"

    # ======================================
    # Predict Bug Probability
    # ======================================

    def predict(self, feature_dict: dict, model_name: str = None):
        """
        Predict defect probability from a dictionary of features
        with the same names as self.feature_columns.
        """

        selected_model = model_name or self._load_best_model_name()
        model = self.load_model(selected_model)

        if not self.feature_columns:
            # In case this process was started without training in-memory,
            # rebuild feature metadata and scaler from the dataset.
            self.load_dataset()

        feature_values = [feature_dict[col] for col in self.feature_columns]
        feature_frame = pd.DataFrame([feature_values], columns=self.feature_columns)
        feature_scaled = self.scaler.transform(feature_frame)

        prob = model.predict_proba(feature_scaled)[0][1]
        label = "Defective" if prob > 0.5 else "Clean"

        shap_values = None

        if settings.ENABLE_SHAP and shap is not None:
            try:
                explainer = shap.Explainer(model)
                shap_result = explainer(feature_scaled)
                shap_values = dict(
                    zip(self.feature_columns, shap_result.values[0].tolist())
                )
            except Exception:
                shap_values = None

        return {
            "bug_probability": round(float(prob), 4),
            "predicted_label": label,
            "model_used": selected_model,
            "shap_explanation": shap_values,
        }