import React, { useMemo, useState } from "react";
import axios from "axios";
import Plot from "react-plotly.js";
import { Graphviz } from "graphviz-react";
import { jsPDF } from "jspdf";
const BACKEND_URL = import.meta.env.VITE_API_URL;
const PAGES = ["Overview", "Code Metrics", "Security Analysis", "Trends", "Architecture", "Project Health", "Summary & Roadmap"];

const getProjectScore = (a) => {
  if (!a) return 0;
  const quality = Math.max(0, Math.min(100, a.metrics.maintainability_index));
  const security = Math.max(0, 100 - a.security.total_issues * 10);
  const complexity = Math.max(0, 100 - a.metrics.cyclomatic_complexity * 6);
  const bugs = Math.max(0, 100 - (a.bug_prediction.bug_probability || 0) * 100);
  return Math.round(quality * 0.35 + security * 0.25 + complexity * 0.2 + bugs * 0.2);
};

const detectClassMap = (fileContents) => {
  const classes = new Set();
  const edges = new Set();
  Object.entries(fileContents).forEach(([name, code]) => {
    const rx = /class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?/g;
    let m;
    while ((m = rx.exec(code)) !== null) {
      classes.add(m[1]);
      if (m[2]) m[2].split(",").map((x) => x.trim()).filter(Boolean).forEach((p) => edges.add(`${p}->${m[1]}`));
      if (code.includes("__new__")) edges.add(`Singleton->${m[1]}`);
      if (code.includes("Factory")) edges.add(`Factory->${m[1]}`);
    }
    if (name.endsWith(".py") && !code.includes("class ")) edges.add(`Module->${name.replace(".py", "")}`);
  });
  return { classes: [...classes], edges: [...edges].map((e) => e.split("->")) };
};

const findDuplicateBlocks = (fileContents) => {
  const files = Object.entries(fileContents);
  const out = [];
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const [fa, ca] = files[i];
      const [fb, cb] = files[j];
      const la = ca.split("\n");
      const lb = cb.split("\n");
      for (let a = 0; a < la.length - 2; a += 1) {
        const chunkA = la.slice(a, a + 3).map((x) => x.trim()).join("\n");
        if (!chunkA.replace(/\s/g, "")) continue;
        for (let b = 0; b < lb.length - 2; b += 1) {
          const chunkB = lb.slice(b, b + 3).map((x) => x.trim()).join("\n");
          if (chunkA === chunkB) {
            out.push({ fa, fb, a1: a + 1, a2: a + 3, b1: b + 1, b2: b + 3 });
            if (out.length >= 10) return out;
          }
        }
      }
    }
  }
  return out;
};

function App() {
  const [files, setFiles] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [history, setHistory] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainResult, setTrainResult] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("Upload one or more Python files and analyze.");
  const [theme, setTheme] = useState("dark");
  const [activePage, setActivePage] = useState("Overview");
  const [expanded, setExpanded] = useState(null);

  const duplicateBlocks = useMemo(() => findDuplicateBlocks(fileContents), [fileContents]);
  const classInfo = useMemo(() => detectClassMap(fileContents), [fileContents]);
  const projectScore = getProjectScore(analysis);
  const trendX = history.map((_, i) => `${i + 1}`);
  const bugTrend = history.map((h) => (h.bug_prediction.bug_probability || 0) * 100);
  const qualityTrend = history.map((h) => h.metrics.maintainability_index);
  const skillTrend = history.map((h) => h.developer_profile.technical_depth_score);
  const themeColor = theme === "dark" ? "#e5e7eb" : "#111827";

  const onFileChange = async (e) => {
    const selected = Array.from(e.target.files || []).filter((f) => f.name.endsWith(".py"));
    setFiles(selected);
    const contents = {};
    for (const f of selected) contents[f.name] = await f.text();
    setFileContents(contents);
    setError(null);
    setAnalysis(null);
  };

  const trainModels = async () => {
    setIsTraining(true);
    setError(null);
    try {
      const res = await axios.post(`${BACKEND_URL}/train-models`);
      setTrainResult(res.data);
      setNotice("Models trained successfully.");
    } catch {
      setError("Failed to train models.");
    } finally {
      setIsTraining(false);
    }
  };

  const analyzeFiles = async () => {
    if (!files.length) return setError("Please select Python file(s).");
    setIsAnalyzing(true);
    setError(null);
    try {
      const results = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await axios.post(`${BACKEND_URL}/analyze`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        results.push({ ...res.data, analyzed_at: new Date().toISOString() });
      }
      setAnalysis(results[results.length - 1]);
      setHistory((prev) => [...prev, ...results].slice(-30));
      setNotice(`Analyzed ${results.length} file(s).`);
    } catch (err) {
      setError(err?.response?.data?.detail || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportSummaryPdf = () => {
    if (!analysis) return;
    const doc = new jsPDF();
    doc.text(
      [
        "Code Intelligence Summary",
        `File: ${analysis.file_name}`,
        `Project Score: ${projectScore}/100`,
        `Bug Risk: ${((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(2)}%`,
        `Quality: ${analysis.metrics.maintainability_index.toFixed(2)}`,
        `Security Issues: ${analysis.security.total_issues}`,
        "",
        `Your bug risk is ${(analysis.bug_prediction.bug_probability || 0) > 0.6 ? "high" : "moderate"} mainly because LOC (${analysis.metrics.lines_of_code}) and complexity (${analysis.metrics.cyclomatic_complexity.toFixed(2)}).`,
      ],
      14,
      16
    );
    doc.save(`summary_${analysis.file_name || "report"}.pdf`);
  };

  const chartLayout = (title) => ({
    title,
    margin: { t: 45, b: 45, l: 60, r: 20 },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: themeColor },
  });

  const securityPieData =
    analysis && analysis.security.total_issues > 0
      ? [
          {
            values: [
              analysis.security.critical_issues,
              analysis.security.high_issues,
              analysis.security.medium_issues,
              analysis.security.low_issues,
            ],
            labels: ["Critical", "High", "Medium", "Low"],
            type: "pie",
            textinfo: "label+value",
            marker: { colors: ["#dc2626", "#f97316", "#eab308", "#22c55e"] },
          },
        ]
      : [{ values: [1], labels: ["No Issues Found"], type: "pie", textinfo: "label", marker: { colors: ["#22c55e"] } }];

  return (
    <div className={`app-root ${theme}`}>
      <header className="app-header">
        <div>
          <h1>Code Intelligence AI Dashboard</h1>
          <p>Multi-file analysis, trends, architecture, and roadmap.</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={exportSummaryPdf} disabled={!analysis}>
            Export Summary PDF
          </button>
          <button className="secondary-button" onClick={() => setTheme((p) => (p === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </header>

      <nav className="top-nav">
        {PAGES.map((p) => (
          <button key={p} className={`nav-item ${activePage === p ? "active" : ""}`} onClick={() => setActivePage(p)}>
            {p}
          </button>
        ))}
      </nav>

      <div className="app-layout">
        <aside className="sidebar">
          <h2>Model Management</h2>
          <button className="primary-button" disabled={isTraining} onClick={trainModels}>
            {isTraining ? "Training..." : "Train ML Models"}
          </button>
          {trainResult && (
            <div className="sidebar-card">
              <p>
                <strong>Best:</strong> {trainResult.best_model}
              </p>
              <p>
                <strong>Accuracy:</strong> {Number(trainResult.accuracy).toFixed(4)}
              </p>
            </div>
          )}
          <div className="sidebar-card">
            <p className="subtle-label">Status</p>
            <p>{notice}</p>
          </div>
        </aside>

        <main className="main-content">
          <section className="card">
            <h2>Upload multiple files or history</h2>
            <div className="upload-row">
              <input type="file" className="file-input" multiple accept=".py" onChange={onFileChange} />
              <button className="primary-button" onClick={analyzeFiles} disabled={isAnalyzing || !files.length}>
                {isAnalyzing ? "Analyzing..." : "Analyze Files"}
              </button>
            </div>
            {files.length > 0 && <p className="helper-text">Selected: {files.map((f) => f.name).join(", ")}</p>}
            {error && <div className="error-banner">{error}</div>}
          </section>

          {analysis && activePage === "Overview" && (
            <section className="card two-column">
              <div className="metric-tile">
                <span className="metric-label">Prediction</span>
                <span className="metric-value">{analysis.bug_prediction.predicted_label}</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Bug Probability</span>
                <span className="metric-value">{((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(1)}%</span>
              </div>
              <div className="metric-tile">
                <span className="metric-label">Project Score</span>
                <span className="metric-value">{projectScore}/100</span>
              </div>
            </section>
          )}

          {analysis && activePage === "Code Metrics" && (
            <section className="card">
              <h2>Code quality evolution</h2>
              <div className="chart-card clickable-chart" onClick={() => setExpanded("quality")}>
                <Plot
                  data={[{ x: trendX, y: qualityTrend, type: "scatter", mode: "lines+markers", line: { width: 3, color: "#22c55e" } }]}
                  layout={{ ...chartLayout("Code Quality Evolution"), xaxis: { title: "History" }, yaxis: { title: "Maintainability Index" } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              </div>
            </section>
          )}

          {analysis && activePage === "Security Analysis" && (
            <section className="card two-column">
              <div>
                <h2>Security Distribution</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("security")}>
                  <Plot
                    data={securityPieData}
                    layout={{ ...chartLayout("Security Distribution"), margin: { t: 40, b: 20, l: 20, r: 20 } }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
              </div>
              <div>
                <h2>Highlight duplicate blocks</h2>
                {duplicateBlocks.length === 0 ? (
                  <p className="helper-text">No duplicate blocks found across selected files.</p>
                ) : (
                  <ul className="compact-list">
                    {duplicateBlocks.map((d, i) => (
                      <li key={`${d.fa}-${d.fb}-${i}`}>
                        File A: {d.fa} lines {d.a1}-{d.a2} | File B: {d.fb} lines {d.b1}-{d.b2}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {analysis && activePage === "Trends" && (
            <section className="card two-column">
              <div>
                <h2>Your Growth</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("growth")}>
                  <Plot
                    data={[{ x: trendX, y: skillTrend, type: "scatter", mode: "lines+markers", line: { width: 3, color: "#60a5fa" } }]}
                    layout={{ ...chartLayout("Skill Improvement Graph"), xaxis: { title: "History" }, yaxis: { title: "Technical Depth Score" } }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
              </div>
              <div>
                <h2>Bug risk trend</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("bug")}>
                  <Plot
                    data={[{ x: trendX, y: bugTrend, type: "scatter", mode: "lines+markers", line: { width: 3, color: "#ef4444" } }]}
                    layout={{ ...chartLayout("Bug Risk Trend"), xaxis: { title: "History" }, yaxis: { title: "Bug Risk %" } }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
              </div>
            </section>
          )}

          {analysis && activePage === "Architecture" && (
            <section className="card two-column">
              <div>
                <h2>Classes and relationships (Graphviz)</h2>
                <div className="graph-card">
                  <Graphviz
                    dot={`digraph G { rankdir=LR; node [shape=box style=filled fillcolor=lightblue]; ${classInfo.classes.map((c) => `"${c}";`).join("\n")} ${classInfo.edges.map(([a, b]) => `"${a}" -> "${b}";`).join("\n")} }`}
                    options={{ zoom: true }}
                  />
                </div>
                <p className="helper-text">Singleton and Factory detection is included as graph links.</p>
              </div>
              <div>
                <h2>SHAP Explanation</h2>
                {analysis.bug_prediction.shap_explanation ? (
                  <div className="chart-card clickable-chart" onClick={() => setExpanded("shap")}>
                    <Plot
                      data={[{ type: "bar", orientation: "h", x: Object.values(analysis.bug_prediction.shap_explanation), y: Object.keys(analysis.bug_prediction.shap_explanation), marker: { color: "#60a5fa" } }]}
                      layout={{ ...chartLayout("Feature Contribution (SHAP)"), margin: { t: 45, b: 35, l: 130, r: 20 } }}
                      style={{ width: "100%", height: "100%" }}
                      useResizeHandler
                    />
                  </div>
                ) : (
                  <p className="helper-text">SHAP values are unavailable for this prediction.</p>
                )}
              </div>
            </section>
          )}

          {analysis && activePage === "Project Health" && (
            <section className="card two-column">
              <div>
                <h2>Project Health Score</h2>
                <div className="kpi-score">{projectScore}/100</div>
                <p className="helper-text">Based on quality, security, complexity and bug risk.</p>
              </div>
              <div>
                <h2>Quick Diagnosis</h2>
                <p className="helper-text">
                  Your bug risk is {(analysis.bug_prediction.bug_probability || 0) > 0.6 ? "high" : "moderate"} mainly because LOC is {analysis.metrics.lines_of_code} and complexity is {analysis.metrics.cyclomatic_complexity.toFixed(2)}.
                </p>
              </div>
            </section>
          )}

          {analysis && activePage === "Summary & Roadmap" && (
            <section className="card">
              <h2>Summary and Learning Roadmap</h2>
              <p className="helper-text">
                File {analysis.file_name} has maintainability {analysis.metrics.maintainability_index.toFixed(2)}, bug risk {((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(1)}%, and project score {projectScore}/100.
              </p>
              <ul className="compact-list">
                <li>Week 1-2: Reduce long functions and duplicated logic.</li>
                <li>Week 3-4: Apply Factory and Singleton patterns only where needed.</li>
                <li>Week 5-6: Add stronger tests and security checks in CI.</li>
                <li>Week 7+: Improve architecture and async programming skills.</li>
              </ul>
            </section>
          )}
        </main>
      </div>

      {expanded && analysis && (
        <div className="chart-modal-overlay" onClick={() => setExpanded(null)}>
          <div className="chart-modal" onClick={(e) => e.stopPropagation()}>
            <button className="secondary-button modal-close" onClick={() => setExpanded(null)}>
              Close
            </button>
            <div className="chart-modal-body">
              {expanded === "security" && <Plot data={securityPieData} layout={{ ...chartLayout("Security Distribution (Expanded)"), margin: { t: 50, b: 30, l: 30, r: 30 } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "shap" && analysis.bug_prediction.shap_explanation && <Plot data={[{ type: "bar", orientation: "h", x: Object.values(analysis.bug_prediction.shap_explanation), y: Object.keys(analysis.bug_prediction.shap_explanation), marker: { color: "#60a5fa" } }]} layout={{ ...chartLayout("SHAP (Expanded)"), margin: { t: 50, b: 30, l: 180, r: 30 } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "growth" && <Plot data={[{ x: trendX, y: skillTrend, type: "scatter", mode: "lines+markers", line: { width: 4, color: "#60a5fa" } }]} layout={{ ...chartLayout("Your Growth (Expanded)"), xaxis: { title: "History" }, yaxis: { title: "Technical Depth Score" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "bug" && <Plot data={[{ x: trendX, y: bugTrend, type: "scatter", mode: "lines+markers", line: { width: 4, color: "#ef4444" } }]} layout={{ ...chartLayout("Bug Trend (Expanded)"), xaxis: { title: "History" }, yaxis: { title: "Bug Risk %" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "quality" && <Plot data={[{ x: trendX, y: qualityTrend, type: "scatter", mode: "lines+markers", line: { width: 4, color: "#22c55e" } }]} layout={{ ...chartLayout("Quality Evolution (Expanded)"), xaxis: { title: "History" }, yaxis: { title: "Maintainability Index" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
import React, { useMemo, useState } from "react";
import axios from "axios";
import Plot from "react-plotly.js";
import { Graphviz } from "graphviz-react";
import { jsPDF } from "jspdf";

const BACKEND_URL = "http://localhost:8000/api";
const PAGES = ["Overview", "Code Metrics", "Security Analysis", "Trends", "Architecture", "Project Health", "Summary & Roadmap"];

const getProjectScore = (a) => {
  if (!a) return 0;
  const quality = Math.max(0, Math.min(100, a.metrics.maintainability_index));
  const security = Math.max(0, 100 - a.security.total_issues * 10);
  const complexity = Math.max(0, 100 - a.metrics.cyclomatic_complexity * 6);
  const bugs = Math.max(0, 100 - (a.bug_prediction.bug_probability || 0) * 100);
  return Math.round(quality * 0.35 + security * 0.25 + complexity * 0.2 + bugs * 0.2);
};

const detectClassMap = (fileContents) => {
  const classes = new Set();
  const edges = new Set();
  Object.entries(fileContents).forEach(([name, code]) => {
    const rx = /class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?/g;
    let m;
    while ((m = rx.exec(code)) !== null) {
      classes.add(m[1]);
      if (m[2]) {
        m[2].split(",").map((x) => x.trim()).filter(Boolean).forEach((p) => edges.add(`${p}->${m[1]}`));
      }
      if (code.includes("__new__")) edges.add(`Singleton->${m[1]}`);
      if (code.includes("Factory")) edges.add(`Factory->${m[1]}`);
    }
    if (name.endsWith(".py") && !code.includes("class ")) edges.add(`Module->${name.replace(".py", "")}`);
  });
  return { classes: [...classes], edges: [...edges].map((e) => e.split("->")) };
};

const findDuplicateBlocks = (fileContents) => {
  const files = Object.entries(fileContents);
  const out = [];
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const [fa, ca] = files[i];
      const [fb, cb] = files[j];
      const la = ca.split("\n");
      const lb = cb.split("\n");
      for (let a = 0; a < la.length - 2; a += 1) {
        const chunkA = la.slice(a, a + 3).map((x) => x.trim()).join("\n");
        if (!chunkA.replace(/\s/g, "")) continue;
        for (let b = 0; b < lb.length - 2; b += 1) {
          const chunkB = lb.slice(b, b + 3).map((x) => x.trim()).join("\n");
          if (chunkA === chunkB) {
            out.push({ fa, fb, a1: a + 1, a2: a + 3, b1: b + 1, b2: b + 3 });
            if (out.length >= 10) return out;
          }
        }
      }
    }
  }
  return out;
};

function App() {
  const [files, setFiles] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [history, setHistory] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainResult, setTrainResult] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("Upload one or more Python files and analyze.");
  const [theme, setTheme] = useState("dark");
  const [activePage, setActivePage] = useState("Overview");
  const [expanded, setExpanded] = useState(null);

  const duplicateBlocks = useMemo(() => findDuplicateBlocks(fileContents), [fileContents]);
  const classInfo = useMemo(() => detectClassMap(fileContents), [fileContents]);
  const projectScore = getProjectScore(analysis);
  const trendX = history.map((_, i) => `${i + 1}`);
  const bugTrend = history.map((h) => (h.bug_prediction.bug_probability || 0) * 100);
  const qualityTrend = history.map((h) => h.metrics.maintainability_index);
  const skillTrend = history.map((h) => h.developer_profile.technical_depth_score);

  const pickThemeColor = theme === "dark" ? "#e5e7eb" : "#111827";

  const onFileChange = async (e) => {
    const selected = Array.from(e.target.files || []).filter((f) => f.name.endsWith(".py"));
    setFiles(selected);
    const c = {};
    for (const f of selected) c[f.name] = await f.text();
    setFileContents(c);
    setError(null);
    setAnalysis(null);
  };

  const trainModels = async () => {
    setIsTraining(true);
    setError(null);
    try {
      const res = await axios.post(`${BACKEND_URL}/train-models`);
      setTrainResult(res.data);
      setNotice("Models trained successfully.");
    } catch {
      setError("Failed to train models.");
    } finally {
      setIsTraining(false);
    }
  };

  const analyzeFiles = async () => {
    if (!files.length) return setError("Please select Python file(s).");
    setIsAnalyzing(true);
    setError(null);
    try {
      const results = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await axios.post(`${BACKEND_URL}/analyze`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        results.push({ ...res.data, analyzed_at: new Date().toISOString() });
      }
      setAnalysis(results[results.length - 1]);
      setHistory((prev) => [...prev, ...results].slice(-30));
      setNotice(`Analyzed ${results.length} file(s).`);
    } catch (err) {
      setError(err?.response?.data?.detail || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportSummaryPdf = () => {
    if (!analysis) return;
    const d = new jsPDF();
    d.setFontSize(12);
    d.text([
      "Code Intelligence Summary",
      `File: ${analysis.file_name}`,
      `Bug Risk: ${((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(2)}%`,
      `Project Score: ${projectScore}/100`,
      `Quality: ${analysis.metrics.maintainability_index.toFixed(2)}`,
      `Security Issues: ${analysis.security.total_issues}`,
      "",
      `Human explanation: Your bug risk is ${(analysis.bug_prediction.bug_probability || 0) > 0.6 ? "high" : "moderate"} mainly because LOC (${analysis.metrics.lines_of_code}) and complexity (${analysis.metrics.cyclomatic_complexity.toFixed(2)}).`,
    ], 14, 16);
    d.save(`summary_${analysis.file_name || "report"}.pdf`);
  };

  const chartLayout = (title) => ({
    title,
    margin: { t: 45, b: 45, l: 60, r: 20 },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: pickThemeColor },
  });

  const securityPieData = analysis
    ? [
        analysis.security.total_issues > 0
          ? { values: [analysis.security.critical_issues, analysis.security.high_issues, analysis.security.medium_issues, analysis.security.low_issues], labels: ["Critical", "High", "Medium", "Low"], type: "pie", textinfo: "label+value", marker: { colors: ["#dc2626", "#f97316", "#eab308", "#22c55e"] } }
          : { values: [1], labels: ["No Issues Found"], type: "pie", textinfo: "label", marker: { colors: ["#22c55e"] } },
      ]
    : [];

  return (
    <div className={`app-root ${theme}`}>
      <header className="app-header">
        <div>
          <h1>Code Intelligence AI Dashboard</h1>
          <p>Multi-file analysis, trends, architecture, and roadmap.</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={exportSummaryPdf} disabled={!analysis}>Export Summary PDF</button>
          <button className="secondary-button" onClick={() => setTheme((p) => (p === "dark" ? "light" : "dark"))}>{theme === "dark" ? "Light Mode" : "Dark Mode"}</button>
        </div>
      </header>

      <nav className="top-nav">
        {PAGES.map((p) => (
          <button key={p} className={`nav-item ${activePage === p ? "active" : ""}`} onClick={() => setActivePage(p)}>{p}</button>
        ))}
      </nav>

      <div className="app-layout">
        <aside className="sidebar">
          <h2>Model Management</h2>
          <button className="primary-button" disabled={isTraining} onClick={trainModels}>{isTraining ? "Training..." : "Train ML Models"}</button>
          {trainResult && <div className="sidebar-card"><p><strong>Best:</strong> {trainResult.best_model}</p><p><strong>Accuracy:</strong> {Number(trainResult.accuracy).toFixed(4)}</p></div>}
          <div className="sidebar-card"><p className="subtle-label">Status</p><p>{notice}</p></div>
        </aside>

        <main className="main-content">
          <section className="card">
            <h2>Upload multiple files or history</h2>
            <div className="upload-row">
              <input type="file" className="file-input" multiple accept=".py" onChange={onFileChange} />
              <button className="primary-button" onClick={analyzeFiles} disabled={isAnalyzing || !files.length}>{isAnalyzing ? "Analyzing..." : "Analyze Files"}</button>
            </div>
            {files.length > 0 && <p className="helper-text">Selected: {files.map((f) => f.name).join(", ")}</p>}
            {error && <div className="error-banner">{error}</div>}
          </section>

          {analysis && activePage === "Overview" && (
            <section className="card two-column">
              <div className="metric-tile"><span className="metric-label">Prediction</span><span className="metric-value">{analysis.bug_prediction.predicted_label}</span></div>
              <div className="metric-tile"><span className="metric-label">Bug Probability</span><span className="metric-value">{((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(1)}%</span></div>
              <div className="metric-tile"><span className="metric-label">Project Score</span><span className="metric-value">{projectScore}/100</span></div>
            </section>
          )}

          {analysis && activePage === "Code Metrics" && (
            <section className="card">
              <h2>Code quality evolution</h2>
              <div className="chart-card clickable-chart" onClick={() => setExpanded("quality")}>
                <Plot data={[{ x: trendX, y: qualityTrend, type: "scatter", mode: "lines+markers", line: { width: 3, color: "#22c55e" } }]} layout={{ ...chartLayout("Code Quality Evolution"), xaxis: { title: "History" }, yaxis: { title: "Maintainability Index" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />
              </div>
            </section>
          )}

          {analysis && activePage === "Security Analysis" && (
            <section className="card two-column">
              <div>
                <h2>Security Distribution</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("security")}>
                  <Plot data={securityPieData} layout={{ ...chartLayout("Security Distribution"), margin: { t: 40, b: 20, l: 20, r: 20 } }} style={{ width: "100%", height: "100%" }} useResizeHandler />
                </div>
              </div>
              <div>
                <h2>Highlight duplicate blocks</h2>
                {duplicateBlocks.length === 0 ? <p className="helper-text">No duplicate blocks found across selected files.</p> : (
                  <ul className="compact-list">
                    {duplicateBlocks.map((d, i) => <li key={`${d.fa}-${d.fb}-${i}`}>File A: {d.fa} lines {d.a1}-{d.a2} | File B: {d.fb} lines {d.b1}-{d.b2}</li>)}
                  </ul>
                )}
              </div>
            </section>
          )}

          {analysis && activePage === "Trends" && (
            <section className="card two-column">
              <div>
                <h2>Your Growth</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("growth")}>
                  <Plot data={[{ x: trendX, y: skillTrend, type: "scatter", mode: "lines+markers", line: { width: 3, color: "#60a5fa" } }]} layout={{ ...chartLayout("Skill Improvement Graph"), xaxis: { title: "History" }, yaxis: { title: "Technical Depth Score" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />
                </div>
              </div>
              <div>
                <h2>Bug risk trend</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("bug")}>
                  <Plot data={[{ x: trendX, y: bugTrend, type: "scatter", mode: "lines+markers", line: { width: 3, color: "#ef4444" } }]} layout={{ ...chartLayout("Bug Risk Trend"), xaxis: { title: "History" }, yaxis: { title: "Bug Risk %" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />
                </div>
              </div>
            </section>
          )}

          {analysis && activePage === "Architecture" && (
            <section className="card two-column">
              <div>
                <h2>Classes → relationships (Graphviz)</h2>
                <div className="graph-card">
                  <Graphviz dot={`digraph G { rankdir=LR; node [shape=box style=filled fillcolor=lightblue]; ${classInfo.classes.map((c) => `"${c}";`).join("\n")} ${classInfo.edges.map(([a, b]) => `"${a}" -> "${b}";`).join("\n")} }`} options={{ zoom: true }} />
                </div>
                <p className="helper-text">Singleton / Factory heuristics are included in the graph edges.</p>
              </div>
              <div>
                <h2>SHAP Explanation</h2>
                {analysis.bug_prediction.shap_explanation ? (
                  <div className="chart-card clickable-chart" onClick={() => setExpanded("shap")}>
                    <Plot data={[{ type: "bar", orientation: "h", x: Object.values(analysis.bug_prediction.shap_explanation), y: Object.keys(analysis.bug_prediction.shap_explanation), marker: { color: "#60a5fa" } }]} layout={{ ...chartLayout("Feature Contribution (SHAP)"), margin: { t: 45, b: 35, l: 130, r: 20 } }} style={{ width: "100%", height: "100%" }} useResizeHandler />
                  </div>
                ) : <p className="helper-text">SHAP values are unavailable for this prediction.</p>}
              </div>
            </section>
          )}

          {analysis && activePage === "Project Health" && (
            <section className="card two-column">
              <div><h2>Project Health Score</h2><div className="kpi-score">{projectScore}/100</div><p className="helper-text">Based on quality, security, complexity and bug risk.</p></div>
              <div><h2>Quick Diagnosis</h2><p className="helper-text">Your bug risk is {(analysis.bug_prediction.bug_probability || 0) > 0.6 ? "high" : "moderate"} mainly because LOC is {analysis.metrics.lines_of_code} and complexity is {analysis.metrics.cyclomatic_complexity.toFixed(2)}.</p></div>
            </section>
          )}

          {analysis && activePage === "Summary & Roadmap" && (
            <section className="card">
              <h2>Summary & Learning Roadmap</h2>
              <p className="helper-text">File {analysis.file_name} has maintainability {analysis.metrics.maintainability_index.toFixed(2)}, bug risk {((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(1)}%, and project score {projectScore}/100.</p>
              <ul className="compact-list">
                <li>Week 1-2: Reduce long functions and duplicated logic.</li>
                <li>Week 3-4: Apply Factory/Singleton patterns only where needed.</li>
                <li>Week 5-6: Add stronger tests and security checks in CI.</li>
                <li>Week 7+: Improve architecture and async programming skills.</li>
              </ul>
            </section>
          )}
        </main>
      </div>

      {expanded && analysis && (
        <div className="chart-modal-overlay" onClick={() => setExpanded(null)}>
          <div className="chart-modal" onClick={(e) => e.stopPropagation()}>
            <button className="secondary-button modal-close" onClick={() => setExpanded(null)}>Close</button>
            <div className="chart-modal-body">
              {expanded === "security" && <Plot data={securityPieData} layout={{ ...chartLayout("Security Distribution (Expanded)"), margin: { t: 50, b: 30, l: 30, r: 30 } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "shap" && analysis.bug_prediction.shap_explanation && <Plot data={[{ type: "bar", orientation: "h", x: Object.values(analysis.bug_prediction.shap_explanation), y: Object.keys(analysis.bug_prediction.shap_explanation), marker: { color: "#60a5fa" } }]} layout={{ ...chartLayout("SHAP (Expanded)"), margin: { t: 50, b: 30, l: 180, r: 30 } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "growth" && <Plot data={[{ x: trendX, y: skillTrend, type: "scatter", mode: "lines+markers", line: { width: 4, color: "#60a5fa" } }]} layout={{ ...chartLayout("Your Growth (Expanded)"), xaxis: { title: "History" }, yaxis: { title: "Technical Depth Score" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "bug" && <Plot data={[{ x: trendX, y: bugTrend, type: "scatter", mode: "lines+markers", line: { width: 4, color: "#ef4444" } }]} layout={{ ...chartLayout("Bug Trend (Expanded)"), xaxis: { title: "History" }, yaxis: { title: "Bug Risk %" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
              {expanded === "quality" && <Plot data={[{ x: trendX, y: qualityTrend, type: "scatter", mode: "lines+markers", line: { width: 4, color: "#22c55e" } }]} layout={{ ...chartLayout("Quality Evolution (Expanded)"), xaxis: { title: "History" }, yaxis: { title: "Maintainability Index" } }} style={{ width: "100%", height: "100%" }} useResizeHandler />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
import React, { useState } from "react";
import axios from "axios";
import Plot from "react-plotly.js";
import { jsPDF } from "jspdf";

const BACKEND_URL = "http://localhost:8000/api";

function App() {
  const [uploadingFile, setUploadingFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [trainResult, setTrainResult] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("Upload a Python file and run analysis.");
  const [theme, setTheme] = useState("dark");
  const [expandedChart, setExpandedChart] = useState(null);

  const handleFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    setUploadingFile(file || null);
    setAnalysis(null);
    setError(null);
  };

  const handleTrainModels = async () => {
    setIsTraining(true);
    setTrainResult(null);
    setError(null);

    try {
      const response = await axios.post(`${BACKEND_URL}/train-models`);
      setTrainResult(response.data);
      setNotice("Models trained successfully. You can now run bug prediction.");
    } catch (err) {
      setError("Failed to train ML models. Check backend logs.");
    } finally {
      setIsTraining(false);
    }
  };

  const handleAnalyze = async () => {
    if (!uploadingFile) {
      setError("Please select a Python file first.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadingFile);

      const response = await axios.post(`${BACKEND_URL}/analyze`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setAnalysis(response.data);
      setNotice("Analysis completed successfully.");
    } catch (err) {
      if (err.response && err.response.data && err.response.data.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Failed to analyze file. Check backend is running.");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getRiskTone = () => {
    if (!analysis) return "neutral";
    const bug = analysis.bug_prediction.bug_probability || 0;
    if (bug > 0.7) return "danger";
    if (bug > 0.45) return "warning";
    return "safe";
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const exportSummaryPdf = () => {
    if (!analysis) return;

    const doc = new jsPDF();
    const lines = [
      "Code Intelligence Summary Report",
      `File: ${analysis.file_name}`,
      `Language: ${analysis.language}`,
      "",
      "Prediction Summary",
      `- Model Used: ${analysis.bug_prediction.model_used}`,
      `- Predicted Label: ${analysis.bug_prediction.predicted_label}`,
      `- Bug Probability: ${((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(2)}%`,
      `- CI/CD Merge: ${analysis.cicd_gate.allowed_to_merge ? "Allowed" : "Blocked"}`,
      "",
      "Code Metrics",
      `- LOC: ${analysis.metrics.lines_of_code}`,
      `- Cyclomatic Complexity: ${analysis.metrics.cyclomatic_complexity.toFixed(2)}`,
      `- Maintainability Index: ${analysis.metrics.maintainability_index.toFixed(2)}`,
      `- Duplication: ${analysis.metrics.duplication_percentage.toFixed(2)}%`,
      "",
      "Security",
      `- Total Issues: ${analysis.security.total_issues}`,
      `- Critical: ${analysis.security.critical_issues}, High: ${analysis.security.high_issues}, Medium: ${analysis.security.medium_issues}, Low: ${analysis.security.low_issues}`,
      "",
      "Developer Profile",
      `- Technical Depth: ${analysis.developer_profile.technical_depth_score.toFixed(2)}`,
      `- Skill Level: ${analysis.developer_profile.developer_skill_level}`,
    ];

    doc.setFontSize(12);
    doc.text(lines, 14, 16);
    doc.save(`summary_${analysis.file_name || "report"}.pdf`);
  };

  const renderExpandedChart = () => {
    if (!analysis || !expandedChart) return null;

    const commonLayout = {
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
      margin: { t: 55, b: 55, l: 70, r: 25 },
    };

    const securityValues = [
      analysis.security.critical_issues,
      analysis.security.high_issues,
      analysis.security.medium_issues,
      analysis.security.low_issues,
    ];
    const totalSecurity = securityValues.reduce((sum, v) => sum + v, 0);

    if (expandedChart === "quality") {
      return (
        <Plot
          data={[
            {
              x: ["Complexity", "Maintainability", "Duplication"],
              y: [
                analysis.metrics.cyclomatic_complexity,
                analysis.metrics.maintainability_index,
                analysis.metrics.duplication_percentage,
              ],
              type: "bar",
              marker: { color: ["#a78bfa", "#22c55e", "#f59e0b"] },
            },
          ]}
          layout={{ ...commonLayout, title: "Quality Metrics Mix (Expanded)" }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      );
    }

    if (expandedChart === "bug") {
      return (
        <Plot
          data={[
            {
              values: [
                (analysis.bug_prediction.bug_probability || 0) * 100,
                100 - (analysis.bug_prediction.bug_probability || 0) * 100,
              ],
              labels: ["Bug Risk", "Safe Portion"],
              type: "pie",
              hole: 0.6,
              marker: { colors: ["#ef4444", "#22c55e"] },
              textinfo: "label+percent",
            },
          ]}
          layout={{ ...commonLayout, title: "Defect Risk Split (Expanded)" }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      );
    }

    if (expandedChart === "developer") {
      return (
        <Plot
          data={[
            {
              type: "scatterpolar",
              r: [
                analysis.developer_profile.technical_depth_score,
                Math.min(100, analysis.metrics.maintainability_index),
                Math.min(100, analysis.metrics.cyclomatic_complexity * 6),
                Math.min(100, analysis.developer_profile.detected_patterns.length * 20),
                Math.min(100, analysis.developer_profile.advanced_construct_usage.length * 20),
              ],
              theta: [
                "Tech Depth",
                "Maintainability",
                "Complexity Impact",
                "Patterns",
                "Advanced Usage",
              ],
              fill: "toself",
              marker: { color: "#60a5fa" },
              name: "Developer Profile",
            },
          ]}
          layout={{
            ...commonLayout,
            title: "Developer Intelligence Radar (Expanded)",
            polar: {
              radialaxis: {
                visible: true,
                range: [0, 100],
                tickfont: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
              },
            },
          }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      );
    }

    if (expandedChart === "security") {
      return (
        <Plot
          data={[
            totalSecurity > 0
              ? {
                  values: securityValues,
                  labels: ["Critical", "High", "Medium", "Low"],
                  type: "pie",
                  marker: { colors: ["#dc2626", "#f97316", "#eab308", "#22c55e"] },
                  textinfo: "label+value",
                }
              : {
                  values: [1],
                  labels: ["No Issues Found"],
                  type: "pie",
                  marker: { colors: ["#22c55e"] },
                  textinfo: "label",
                },
          ]}
          layout={{ ...commonLayout, title: "Security Distribution (Expanded)" }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      );
    }

    if (expandedChart === "shap" && analysis.bug_prediction.shap_explanation) {
      return (
        <Plot
          data={[
            {
              type: "bar",
              orientation: "h",
              x: Object.values(analysis.bug_prediction.shap_explanation),
              y: Object.keys(analysis.bug_prediction.shap_explanation),
              marker: { color: "#60a5fa" },
            },
          ]}
          layout={{ ...commonLayout, title: "Feature Contribution (SHAP) (Expanded)" }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
        />
      );
    }

    return null;
  };

  return (
    <div className={`app-root ${theme}`}>
      <header className="app-header">
        <div>
          <h1>Code Intelligence AI Dashboard</h1>
          <p>AI-Powered Static Analysis, Bug Prediction and Developer Intelligence</p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={exportSummaryPdf}
            disabled={!analysis}
            title={analysis ? "Download summary PDF" : "Run analysis first"}
          >
            Export Summary PDF
          </button>
          <button className="secondary-button" onClick={toggleTheme}>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <h2>Model Management</h2>
          <button
            className="primary-button"
            onClick={handleTrainModels}
            disabled={isTraining}
          >
            {isTraining ? "Training models..." : "Train ML Models"}
          </button>
          {trainResult && (
            <div className="sidebar-card">
              <p>
                <strong>Best Model:</strong> {trainResult.best_model}
              </p>
              <p>
                <strong>Accuracy:</strong>{" "}
                {trainResult.accuracy != null
                  ? Number(trainResult.accuracy).toFixed(4)
                  : "N/A"}
              </p>
            </div>
          )}

          <div className="sidebar-card">
            <p className="subtle-label">Session Status</p>
            <p>{notice}</p>
          </div>

          <div className="sidebar-footer">
            <p>Upload a file and get complete analysis in one click.</p>
          </div>
        </aside>

        <main className="main-content">
          <section className="card">
            <h2>Upload Python File</h2>
            <p className="helper-text">
              Upload a <code>.py</code> file to run static analysis, security checks, and bug
              prediction.
            </p>

            <div className="upload-row">
              <input
                type="file"
                accept=".py"
                onChange={handleFileChange}
                className="file-input"
              />
              <button
                className="primary-button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || !uploadingFile}
              >
                {isAnalyzing ? "Analyzing..." : "Analyze"}
              </button>
            </div>

            {uploadingFile && (
              <p className="helper-text">
                Selected file: <strong>{uploadingFile.name}</strong>
              </p>
            )}

            {error && <div className="error-banner">{error}</div>}
          </section>

          {analysis && (
            <>
              <section className={`card risk-card ${getRiskTone()}`}>
                <h2>Project Risk Snapshot</h2>
                <div className="metrics-grid">
                  <div className="metric-tile">
                    <span className="metric-label">Prediction</span>
                    <span className="metric-value">{analysis.bug_prediction.predicted_label}</span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Bug Probability</span>
                    <span className="metric-value">
                      {((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Merge Gate</span>
                    <span className="metric-value">
                      {analysis.cicd_gate.allowed_to_merge ? "Allowed" : "Blocked"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="card">
                <h2>Complete File Summary</h2>
                <p className="helper-text">
                  <strong>{analysis.file_name}</strong> is analyzed as{" "}
                  <strong>{analysis.language}</strong>. The model predicts{" "}
                  <strong>{analysis.bug_prediction.predicted_label}</strong> with{" "}
                  <strong>{((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(1)}%</strong>{" "}
                  probability. Code quality has maintainability index{" "}
                  <strong>{analysis.metrics.maintainability_index.toFixed(2)}</strong>, average complexity{" "}
                  <strong>{analysis.metrics.cyclomatic_complexity.toFixed(2)}</strong>, and duplication{" "}
                  <strong>{analysis.metrics.duplication_percentage.toFixed(2)}%</strong>. Security scan found{" "}
                  <strong>{analysis.security.total_issues}</strong> issues and CI/CD gate is{" "}
                  <strong>{analysis.cicd_gate.allowed_to_merge ? "allowed to merge" : "blocked"}</strong>.
                </p>
              </section>

              <section className="card">
                <h2>Code Metrics</h2>
                <div className="metrics-grid">
                  <div className="metric-tile">
                    <span className="metric-label">Lines of Code</span>
                    <span className="metric-value">
                      {analysis.metrics.lines_of_code}
                    </span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Cyclomatic Complexity</span>
                    <span className="metric-value">
                      {analysis.metrics.cyclomatic_complexity.toFixed(2)}
                    </span>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-label">Maintainability Index</span>
                    <span className="metric-value">
                      {analysis.metrics.maintainability_index.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="charts-grid">
                  <div className="chart-card clickable-chart" onClick={() => setExpandedChart("quality")}>
                    <Plot
                      data={[
                        {
                          x: ["Complexity", "Maintainability", "Duplication"],
                          y: [
                            analysis.metrics.cyclomatic_complexity,
                            analysis.metrics.maintainability_index,
                            analysis.metrics.duplication_percentage,
                          ],
                          type: "bar",
                          marker: { color: ["#a78bfa", "#22c55e", "#f59e0b"] },
                        },
                      ]}
                      layout={{
                        title: "Quality Metrics Mix",
                        margin: { t: 45, b: 40, l: 40, r: 15 },
                        paper_bgcolor: "transparent",
                        plot_bgcolor: "transparent",
                        font: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
                      }}
                      style={{ width: "100%", height: "100%" }}
                      useResizeHandler
                    />
                  </div>
                </div>
              </section>

              <section className="card two-column">
                <div>
                  <h2>Security Analysis</h2>
                  <p>
                    <strong>Total Issues:</strong>{" "}
                    {analysis.security.total_issues}
                  </p>
                  <p>
                    <strong>Critical:</strong>{" "}
                    {analysis.security.critical_issues}
                  </p>
                  <p>
                    <strong>High:</strong> {analysis.security.high_issues}
                  </p>
                  <p>
                    <strong>Medium:</strong> {analysis.security.medium_issues}
                  </p>
                  <p>
                    <strong>Low:</strong> {analysis.security.low_issues}
                  </p>

                  {analysis.security.issues_summary &&
                    analysis.security.issues_summary.length > 0 && (
                      <div className="issues-list">
                        <h3>Top Security Issues</h3>
                        <ul>
                          {analysis.security.issues_summary.map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>

                <div>
                  <h2>Bug Prediction</h2>
                  <div className="chart-card clickable-chart" onClick={() => setExpandedChart("bug")}>
                    <Plot
                      data={[
                        {
                          values: [
                            (analysis.bug_prediction.bug_probability || 0) * 100,
                            100 - (analysis.bug_prediction.bug_probability || 0) * 100,
                          ],
                          labels: ["Bug Risk", "Safe Portion"],
                          type: "pie",
                          hole: 0.6,
                          marker: { colors: ["#ef4444", "#22c55e"] },
                          textinfo: "label+percent",
                        },
                      ]}
                      layout={{
                        title: "Defect Risk Split",
                        margin: { t: 45, b: 15, l: 15, r: 15 },
                        showlegend: true,
                        paper_bgcolor: "transparent",
                        font: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
                      }}
                      style={{ width: "100%", height: "100%" }}
                      useResizeHandler
                    />
                  </div>
                  <p className="helper-text">
                    Prediction:{" "}
                    <strong>{analysis.bug_prediction.predicted_label}</strong>
                  </p>
                </div>
              </section>

              <section className="card two-column">
                <div>
                  <h2>Developer Intelligence</h2>
                  <div className="chart-card clickable-chart" onClick={() => setExpandedChart("developer")}>
                    <Plot
                      data={[
                        {
                          type: "scatterpolar",
                          r: [
                            analysis.developer_profile.technical_depth_score,
                            Math.min(100, analysis.metrics.maintainability_index),
                            Math.min(100, analysis.metrics.cyclomatic_complexity * 6),
                            Math.min(100, analysis.developer_profile.detected_patterns.length * 20),
                            Math.min(100, analysis.developer_profile.advanced_construct_usage.length * 20),
                          ],
                          theta: [
                            "Tech Depth",
                            "Maintainability",
                            "Complexity Impact",
                            "Patterns",
                            "Advanced Usage",
                          ],
                          fill: "toself",
                          marker: { color: "#60a5fa" },
                          name: "Developer Profile",
                        },
                      ]}
                      layout={{
                        title: "Developer Intelligence Radar",
                        margin: { t: 45, b: 30, l: 30, r: 30 },
                        paper_bgcolor: "transparent",
                        plot_bgcolor: "transparent",
                        font: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
                        polar: {
                          radialaxis: {
                            visible: true,
                            range: [0, 100],
                            tickfont: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
                          },
                        },
                      }}
                      style={{ width: "100%", height: "100%" }}
                      useResizeHandler
                    />
                  </div>
                  <p className="helper-text">
                    Skill Level:{" "}
                    <strong>
                      {analysis.developer_profile.developer_skill_level}
                    </strong>
                  </p>
                </div>

                <div>
                  <h3>Learning Suggestions</h3>
                  <ul>
                    {analysis.developer_profile.learning_suggestions.map(
                      (s, idx) => (
                        <li key={idx}>{s}</li>
                      )
                    )}
                  </ul>

                  {analysis.developer_profile.detected_patterns.length > 0 && (
                    <>
                      <h3>Detected Patterns</h3>
                      <ul>
                        {analysis.developer_profile.detected_patterns.map(
                          (p, idx) => (
                            <li key={idx}>{p}</li>
                          )
                        )}
                      </ul>
                    </>
                  )}

                  {analysis.developer_profile.advanced_construct_usage
                    .length > 0 && (
                    <>
                      <h3>Advanced Constructs</h3>
                      <ul>
                        {analysis.developer_profile.advanced_construct_usage.map(
                          (c, idx) => (
                            <li key={idx}>{c}</li>
                          )
                        )}
                      </ul>
                    </>
                  )}
                </div>
              </section>

              <section className="card two-column">
                <div>
                  <h2>Security Distribution</h2>
                  <div className="chart-card clickable-chart" onClick={() => setExpandedChart("security")}>
                    <Plot
                      data={[
                        analysis.security.total_issues > 0
                          ? {
                              values: [
                                analysis.security.critical_issues,
                                analysis.security.high_issues,
                                analysis.security.medium_issues,
                                analysis.security.low_issues,
                              ],
                              labels: ["Critical", "High", "Medium", "Low"],
                              type: "pie",
                              marker: { colors: ["#dc2626", "#f97316", "#eab308", "#22c55e"] },
                              textinfo: "label+value",
                            }
                          : {
                              values: [1],
                              labels: ["No Issues Found"],
                              type: "pie",
                              marker: { colors: ["#22c55e"] },
                              textinfo: "label",
                            },
                      ]}
                      layout={{
                        margin: { t: 20, b: 10, l: 10, r: 10 },
                        paper_bgcolor: "transparent",
                        font: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
                      }}
                      style={{ width: "100%", height: "100%" }}
                      useResizeHandler
                    />
                  </div>
                </div>

                <div>
                  <h2>SHAP Explanation</h2>
                  {analysis.bug_prediction.shap_explanation ? (
                    <div className="chart-card clickable-chart" onClick={() => setExpandedChart("shap")}>
                      <Plot
                        data={[
                          {
                            type: "bar",
                            orientation: "h",
                            x: Object.values(analysis.bug_prediction.shap_explanation),
                            y: Object.keys(analysis.bug_prediction.shap_explanation),
                            marker: { color: "#60a5fa" },
                          },
                        ]}
                        layout={{
                          title: "Feature Contribution (SHAP)",
                          margin: { t: 45, b: 30, l: 120, r: 15 },
                          paper_bgcolor: "transparent",
                          plot_bgcolor: "transparent",
                          font: { color: theme === "dark" ? "#e5e7eb" : "#111827" },
                        }}
                        style={{ width: "100%", height: "100%" }}
                        useResizeHandler
                      />
                    </div>
                  ) : (
                    <p className="helper-text">
                      SHAP values are not available for this prediction.
                    </p>
                  )}
                </div>
              </section>

              <section className="card two-column">
                <div>
                  <h2>Compliance Report</h2>
                  {analysis.compliance.compliant ? (
                    <div className="status-pill success">Code is compliant</div>
                  ) : (
                    <div className="status-pill error">
                      Compliance violations detected
                    </div>
                  )}
                  <ul className="compact-list">
                    <li>
                      Documentation present:{" "}
                      <strong>
                        {analysis.compliance.documentation_present
                          ? "Yes"
                          : "No"}
                      </strong>
                    </li>
                    <li>
                      Max function length violation:{" "}
                      <strong>
                        {analysis.compliance.max_function_length_violation
                          ? "Yes"
                          : "No"}
                      </strong>
                    </li>
                    <li>
                      Hardcoded secrets detected:{" "}
                      <strong>
                        {analysis.compliance.hardcoded_secrets_detected
                          ? "Yes"
                          : "No"}
                      </strong>
                    </li>
                    <li>
                      Type hint coverage OK:{" "}
                      <strong>
                        {analysis.compliance.type_hint_coverage_ok
                          ? "Yes"
                          : "No"}
                      </strong>
                    </li>
                  </ul>
                </div>

                <div>
                  <h2>CI/CD Gate Status</h2>
                  {analysis.cicd_gate.allowed_to_merge ? (
                    <div className="status-pill success">Allowed to Merge</div>
                  ) : (
                    <div className="status-pill error">Blocked from Merge</div>
                  )}

                  {!analysis.cicd_gate.allowed_to_merge &&
                    analysis.cicd_gate.blocking_reasons.length > 0 && (
                      <ul className="compact-list">
                        {analysis.cicd_gate.blocking_reasons.map(
                          (reason, idx) => (
                            <li key={idx}>{reason}</li>
                          )
                        )}
                      </ul>
                    )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {expandedChart && (
        <div className="chart-modal-overlay" onClick={() => setExpandedChart(null)}>
          <div className="chart-modal" onClick={(e) => e.stopPropagation()}>
            <button className="secondary-button modal-close" onClick={() => setExpandedChart(null)}>
              Close
            </button>
            <div className="chart-modal-body">{renderExpandedChart()}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

