import React, { useMemo, useState } from "react";
import axios from "axios";
import Plot from "react-plotly.js";
import { Graphviz } from "graphviz-react";
import { jsPDF } from "jspdf";


const BACKEND_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const PAGES = [
  "Overview",
  "Bug Prediction",
  "Developer Intelligence",
  "Code Metrics",
  "Security Analysis",
  "Trends",
  "Architecture",
  "Project Health",
  "Summary & Roadmap",
];

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
        m[2]
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((p) => edges.add(`${p}->${m[1]}`));
      }
      if (code.includes("__new__")) edges.add(`Singleton->${m[1]}`);
      if (code.includes("Factory")) edges.add(`Factory->${m[1]}`);
    }
    if (name.endsWith(".py") && !code.includes("class ")) {
      edges.add(`Module->${name.replace(".py", "")}`);
    }
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

export default function AppNew() {
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
  const themeColor = theme === "dark" ? "#e5e7eb" : "#111827";

  const hasHistory = history.length > 0;
  const trendX = hasHistory ? history.map((_, i) => `Run ${i + 1}`) : analysis ? ["Current"] : [];
  const bugTrend = hasHistory
    ? history.map((h) => (h.bug_prediction.bug_probability || 0) * 100)
    : analysis
      ? [(analysis.bug_prediction.bug_probability || 0) * 100]
      : [];
  const qualityTrend = hasHistory
    ? history.map((h) => h.metrics.maintainability_index)
    : analysis
      ? [analysis.metrics.maintainability_index]
      : [];
  const skillTrend = hasHistory
    ? history.map((h) => h.developer_profile.technical_depth_score)
    : analysis
      ? [analysis.developer_profile.technical_depth_score]
      : [];

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
        `Project Score: ${projectScore}/100`,
        `File: ${analysis.file_name}`,
        `Bug Risk: ${((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(2)}%`,
      ],
      14,
      16
    );
    doc.save(`summary_${analysis.file_name || "report"}.pdf`);
  };

  const chartLayout = (title) => ({
    title: { text: title, font: { size: 20 } },
    margin: { t: 70, b: 65, l: 75, r: 35 },
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: themeColor, size: 14 },
    hovermode: "x unified",
    xaxis: { automargin: true, tickfont: { size: 13 }, title: { font: { size: 14 } } },
    yaxis: { automargin: true, tickfont: { size: 13 }, title: { font: { size: 14 } } },
  });

  const qualitySeries = {
    x: trendX,
    y: qualityTrend,
    type: "bar",
    marker: { color: "#22c55e" },
    name: "Maintainability",
    hovertemplate: "Run: %{x}<br>Maintainability: %{y:.2f}<extra></extra>",
  };

  const growthSeries = {
    x: trendX,
    y: skillTrend,
    type: "bar",
    marker: { color: "#60a5fa" },
    name: "Skill",
    hovertemplate: "Run: %{x}<br>Skill Score: %{y:.2f}<extra></extra>",
  };

  const bugSeries = {
    x: trendX,
    y: bugTrend,
    type: "bar",
    marker: { color: "#ef4444" },
    name: "Bug Risk",
    hovertemplate: "Run: %{x}<br>Bug Risk: %{y:.2f}%<extra></extra>",
  };

  const qualityTrendSeries = {
    x: trendX,
    y: qualityTrend,
    type: "bar",
    marker: { color: "#22c55e" },
    name: "Quality",
    hovertemplate: "Run: %{x}<br>Quality: %{y:.2f}<extra></extra>",
  };

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
            hovertemplate: "%{label}: %{value}<extra></extra>",
          },
        ]
      : [
          {
            values: [1],
            labels: ["No Issues Found"],
            type: "pie",
            textinfo: "label",
            marker: { colors: ["#22c55e"] },
          },
        ];

  const bugDonutData = [
    {
      values: [
        (analysis?.bug_prediction.bug_probability || 0) * 100,
        100 - (analysis?.bug_prediction.bug_probability || 0) * 100,
      ],
      labels: ["Bug Risk", "Safe Portion"],
      type: "pie",
      hole: 0.6,
      marker: { colors: ["#ef4444", "#22c55e"] },
      textinfo: "label+percent",
      hovertemplate: "%{label}: %{percent}<extra></extra>",
    },
  ];

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

          {analysis && activePage === "Code Metrics" && (
            <section className="card">
              <h2>Code quality evolution</h2>
              <div className="chart-card clickable-chart" onClick={() => setExpanded("quality")}>
                <Plot
                  data={[
                    {
                      x: ["Maintainability", "Cyclomatic Complexity", "Duplication %", "Code Smells"],
                      y: [
                        analysis.metrics.maintainability_index,
                        analysis.metrics.cyclomatic_complexity,
                        analysis.metrics.duplication_percentage,
                        analysis.metrics.code_smells,
                      ],
                      type: "bar",
                      marker: { color: ["#22c55e", "#f97316", "#a78bfa", "#ef4444"] },
                      hovertemplate: "%{x}: %{y:.2f}<extra></extra>",
                    },
                  ]}
                  layout={{ ...chartLayout("Code Quality Evolution"), yaxis: { title: "Maintainability Index", range: [0, 100] } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              </div>
              <p className="graph-explain">
                This graph shows how maintainability evolves across analyses. Higher values mean cleaner and easier-to-maintain code.
              </p>
            </section>
          )}

          {analysis && activePage === "Trends" && (
            <section className="card two-column">
              <div>
                <h2>Your Growth</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("growth")}>
                  <Plot
                    data={[growthSeries]}
                    layout={{ ...chartLayout("Skill Improvement Graph"), yaxis: { title: "Technical Depth Score", range: [0, 100] } }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
                <p className="graph-explain">
                  This tracks your technical depth score over time. An upward trend means your code is showing stronger design and advanced constructs.
                </p>
              </div>
              <div>
                <h2>Bug risk trend and quality evolution</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("bug")}>
                  <Plot
                    data={[bugSeries, qualityTrendSeries]}
                    layout={{ ...chartLayout("Bug + Quality Trend"), yaxis: { title: "Score", range: [0, 100] } }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
                <p className="graph-explain">
                  Red shows defect risk while green shows quality. The best pattern is red trending down and green trending up.
                </p>
              </div>
            </section>
          )}

          {analysis && activePage === "Bug Prediction" && (
            <section className="card two-column">
              <div>
                <h2>Bug Prediction</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("bug-donut")}>
                  <Plot
                    data={bugDonutData}
                    layout={{ ...chartLayout("Defect Risk Split"), margin: { t: 60, b: 25, l: 25, r: 25 } }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
                <p className="graph-explain">
                  This donut chart shows how much of the current file is estimated as risky versus safe.
                </p>
              </div>
              <div>
                <h2>Prediction Details</h2>
                <p className="helper-text"><strong>Model:</strong> {analysis.bug_prediction.model_used}</p>
                <p className="helper-text"><strong>Label:</strong> {analysis.bug_prediction.predicted_label}</p>
                <p className="helper-text"><strong>Probability:</strong> {((analysis.bug_prediction.bug_probability || 0) * 100).toFixed(2)}%</p>
              </div>
            </section>
          )}

          {analysis && activePage === "Developer Intelligence" && (
            <section className="card two-column">
              <div>
                <h2>Developer Intelligence</h2>
                <div className="chart-card clickable-chart" onClick={() => setExpanded("developer-radar")}>
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
                        theta: ["Tech Depth", "Maintainability", "Complexity Impact", "Patterns", "Advanced Usage"],
                        fill: "toself",
                        marker: { color: "#60a5fa" },
                        hovertemplate: "%{theta}: %{r:.2f}<extra></extra>",
                      },
                    ]}
                    layout={{
                      ...chartLayout("Developer Intelligence Radar"),
                      polar: {
                        radialaxis: { visible: true, range: [0, 100], tickfont: { color: themeColor, size: 13 } },
                      },
                      showlegend: false,
                    }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
                <p className="graph-explain">
                  This radar chart compares multiple skill dimensions. A larger shape indicates stronger engineering maturity.
                </p>
              </div>
              <div>
                <h2>Skill & Learning</h2>
                <p className="helper-text"><strong>Skill Level:</strong> {analysis.developer_profile.developer_skill_level}</p>
                <h3>Learning Suggestions</h3>
                <ul className="compact-list">
                  {analysis.developer_profile.learning_suggestions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
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
                    layout={{ ...chartLayout("Security Distribution"), margin: { t: 60, b: 30, l: 30, r: 30 } }}
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
                      data={[
                        {
                          type: "bar",
                          orientation: "h",
                          x: Object.values(analysis.bug_prediction.shap_explanation),
                          y: Object.keys(analysis.bug_prediction.shap_explanation),
                          marker: { color: "#60a5fa" },
                          hovertemplate: "%{y}: %{x:.4f}<extra></extra>",
                        },
                      ]}
                      layout={{ ...chartLayout("Feature Contribution (SHAP)"), margin: { t: 60, b: 35, l: 130, r: 20 } }}
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
                <p className="helper-text">Based on quality, security, complexity and bugs.</p>
              </div>
              <div>
                <h2>Human explanation</h2>
                <p className="helper-text">
                  Your bug risk is {(analysis.bug_prediction.bug_probability || 0) > 0.6 ? "high" : "moderate"} mainly because high LOC and high complexity.
                </p>
              </div>
            </section>
          )}

          {analysis && activePage === "Summary & Roadmap" && (
            <section className="card">
              <h2>Learning Roadmap</h2>
              <ul className="compact-list">
                <li>Week 1-2: Reduce duplicated code blocks.</li>
                <li>Week 3-4: Improve design patterns usage.</li>
                <li>Week 5-6: Add stronger tests and security checks.</li>
                <li>Week 7+: Improve architecture and scalability.</li>
              </ul>
            </section>
          )}

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
        </main>
      </div>

      {expanded && analysis && (
        <div className="chart-modal-overlay" onClick={() => setExpanded(null)}>
          <div className="chart-modal" onClick={(e) => e.stopPropagation()}>
            <button className="secondary-button modal-close" onClick={() => setExpanded(null)}>
              Close
            </button>
            <div className="chart-modal-body">
              {expanded === "security" && (
                <Plot
                  data={securityPieData}
                  layout={{ ...chartLayout("Security Distribution (Expanded)"), margin: { t: 60, b: 35, l: 35, r: 35 } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
              {expanded === "shap" && analysis.bug_prediction.shap_explanation && (
                <Plot
                  data={[
                    {
                      type: "bar",
                      orientation: "h",
                      x: Object.values(analysis.bug_prediction.shap_explanation),
                      y: Object.keys(analysis.bug_prediction.shap_explanation),
                      marker: { color: "#60a5fa" },
                      hovertemplate: "%{y}: %{x:.4f}<extra></extra>",
                    },
                  ]}
                  layout={{ ...chartLayout("SHAP (Expanded)"), margin: { t: 60, b: 35, l: 220, r: 35 } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
              {expanded === "growth" && (
                <Plot
                  data={[growthSeries]}
                  layout={{ ...chartLayout("Your Growth (Expanded)"), yaxis: { title: "Technical Depth Score", range: [0, 100] } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
              {expanded === "bug" && (
                <Plot
                  data={[bugSeries, qualityTrendSeries]}
                  layout={{ ...chartLayout("Bug + Quality Trend (Expanded)"), yaxis: { title: "Score", range: [0, 100] } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
              {expanded === "quality" && (
                <Plot
                  data={[
                    {
                      x: ["Maintainability", "Cyclomatic Complexity", "Duplication %", "Code Smells"],
                      y: [
                        analysis.metrics.maintainability_index,
                        analysis.metrics.cyclomatic_complexity,
                        analysis.metrics.duplication_percentage,
                        analysis.metrics.code_smells,
                      ],
                      type: "bar",
                      marker: { color: ["#22c55e", "#f97316", "#a78bfa", "#ef4444"] },
                      hovertemplate: "%{x}: %{y:.2f}<extra></extra>",
                    },
                  ]}
                  layout={{ ...chartLayout("Code Metrics Mix (Expanded)"), yaxis: { title: "Metric Value" } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
              {expanded === "bug-donut" && (
                <Plot
                  data={bugDonutData}
                  layout={{ ...chartLayout("Defect Risk Split (Expanded)"), margin: { t: 60, b: 35, l: 35, r: 35 } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
              {expanded === "developer-radar" && (
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
                      theta: ["Tech Depth", "Maintainability", "Complexity Impact", "Patterns", "Advanced Usage"],
                      fill: "toself",
                      marker: { color: "#60a5fa" },
                      hovertemplate: "%{theta}: %{r:.2f}<extra></extra>",
                    },
                  ]}
                  layout={{
                    ...chartLayout("Developer Intelligence Radar (Expanded)"),
                    polar: { radialaxis: { visible: true, range: [0, 100], tickfont: { color: themeColor, size: 14 } } },
                    showlegend: false,
                  }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
