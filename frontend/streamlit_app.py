import streamlit as st
import requests
import pandas as pd
import plotly.graph_objects as go

BACKEND_URL = "http://localhost:8000/api"

st.set_page_config(page_title="Code Intelligence AI", layout="wide")

st.title("🚀 Code Intelligence AI Dashboard")
st.markdown("AI-Powered Static Analysis | Bug Prediction | Developer Intelligence")


# ==========================================
# Train Models Section
# ==========================================

st.sidebar.header("⚙️ Model Management")

if st.sidebar.button("Train ML Models"):
    response = requests.post(f"{BACKEND_URL}/train-models")
    if response.status_code == 200:
        data = response.json()
        st.sidebar.success(f"Best Model: {data['best_model']}")
        st.sidebar.write(f"Accuracy: {round(data['accuracy'], 4)}")
    else:
        st.sidebar.error("Model training failed")


# ==========================================
# File Upload
# ==========================================

uploaded_file = st.file_uploader("Upload Python File", type=["py"])

if uploaded_file:

    files = {"file": (uploaded_file.name, uploaded_file.getvalue())}
    response = requests.post(f"{BACKEND_URL}/analyze", files=files)

    if response.status_code != 200:
        st.error(response.json()["detail"])
        st.stop()

    data = response.json()

    # ======================================
    # Metrics Section
    # ======================================

    st.header("📊 Code Metrics")

    col1, col2, col3 = st.columns(3)

    col1.metric("Lines of Code", data["metrics"]["lines_of_code"])
    col2.metric("Cyclomatic Complexity", round(data["metrics"]["cyclomatic_complexity"], 2))
    col3.metric("Maintainability Index", round(data["metrics"]["maintainability_index"], 2))

    # Duplication Chart
    st.subheader("Code Duplication")
    fig_dup = go.Figure(go.Indicator(
        mode="gauge+number",
        value=data["metrics"]["duplication_percentage"],
        title={'text': "Duplication %"},
        gauge={'axis': {'range': [0, 100]}}
    ))
    st.plotly_chart(fig_dup, use_container_width=True)

    # ======================================
    # Security Report
    # ======================================

    st.header("🔐 Security Analysis")
    st.write(f"Total Issues: {data['security']['total_issues']}")
    st.write(f"Critical: {data['security']['critical_issues']}")

    if data["security"]["issues_summary"]:
        st.warning("Top Security Issues:")
        for issue in data["security"]["issues_summary"]:
            st.write(f"- {issue}")

    # ======================================
    # Bug Prediction
    # ======================================

    st.header("🤖 Bug Prediction")

    bug_prob = data["bug_prediction"]["bug_probability"]

    fig_bug = go.Figure(go.Indicator(
        mode="gauge+number",
        value=bug_prob * 100,
        title={'text': "Bug Probability %"},
        gauge={'axis': {'range': [0, 100]}}
    ))

    st.plotly_chart(fig_bug, use_container_width=True)
    st.write(f"Prediction: **{data['bug_prediction']['predicted_label']}**")

    # ======================================
    # Technical Depth
    # ======================================

    st.header("🧠 Developer Intelligence")

    depth = data["developer_profile"]["technical_depth_score"]

    fig_depth = go.Figure(go.Indicator(
        mode="gauge+number",
        value=depth,
        title={'text': "Technical Depth Score"},
        gauge={'axis': {'range': [0, 100]}}
    ))

    st.plotly_chart(fig_depth, use_container_width=True)
    st.write(f"Skill Level: **{data['developer_profile']['developer_skill_level']}**")

    # Learning Suggestions
    st.subheader("📚 Learning Suggestions")
    for suggestion in data["developer_profile"]["learning_suggestions"]:
        st.write(f"- {suggestion}")

    # ======================================
    # Compliance
    # ======================================

    st.header("📑 Compliance Report")

    if data["compliance"]["compliant"]:
        st.success("Code is compliant")
    else:
        st.error("Compliance violations detected")

    # ======================================
    # CI/CD Gate
    # ======================================

    st.header("🚦 CI/CD Gate Status")

    if data["cicd_gate"]["allowed_to_merge"]:
        st.success("Allowed to Merge")
    else:
        st.error("Blocked from Merge")
        for reason in data["cicd_gate"]["blocking_reasons"]:
            st.write(f"- {reason}")