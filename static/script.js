// script.js - Complete SpeechCoach AI Frontend (UPDATED)

document.addEventListener("DOMContentLoaded", function () {
  // Initialize all elements
  initializeElements();

  // Set up event listeners
  setupEventListeners();

  // Load progress chart if on dashboard
  if (document.getElementById("progressChart")) {
    loadProgressChart();
  }

  // Add sample button
  addSampleButton();
});

// ==================== ELEMENT INITIALIZATION ====================

function initializeElements() {
  // Main elements
  window.analyzeBtn = document.getElementById("analyze-btn");
  window.scriptTextarea = document.getElementById("script");
  window.resultsSection = document.getElementById("results");
  window.loadingDiv = document.getElementById("loading");
  window.apiWarning = document.getElementById("api-warning");
  window.warningMessage = document.getElementById("warning-message");
  window.timestampEl = document.getElementById("timestamp");

  // Voice recording elements
  window.recordBtn = document.getElementById("record-btn");
  window.voiceStatus = document.getElementById("voice-status");
  window.voiceMetrics = document.getElementById("voice-metrics");
  window.voiceNervousnessBar = document.getElementById("voice-nervousness-progress");
  window.voiceNervousnessValue = document.getElementById("voice-nervousness-value");
  window.transcriptionStatus = document.getElementById("transcription-status");

  // Score elements
  window.nervousnessProgress = document.getElementById("nervousness-progress");
  window.confidenceProgress = document.getElementById("confidence-progress");
  window.clarityProgress = document.getElementById("clarity-progress");
  window.nervousnessValue = document.getElementById("nervousness-value");
  window.confidenceValue = document.getElementById("confidence-value");
  window.clarityValue = document.getElementById("clarity-value");

  // List elements
  window.issuesList = document.getElementById("issues-list");
  window.improvedScript = document.getElementById("improved-script");
  window.tipsList = document.getElementById("tips-list");

  // Copy button
  window.copyBtn = document.getElementById("copy-script");

  // Voice recording variables
  window.mediaRecorder = null;
  window.audioChunks = [];
  window.isRecording = false;
  window.voiceAnalysisResult = null;
  window.transcriptionText = "";
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      analyzeScript();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", copyImprovedScript);
  }

  if (recordBtn) {
    recordBtn.addEventListener("click", toggleRecording);
  }

  if (scriptTextarea) {
    scriptTextarea.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        analyzeScript();
      }
    });
  }

  // History items click handlers (works for server-rendered items)
  bindHistoryClicks();
}

function bindHistoryClicks() {
  document.querySelectorAll(".history-item").forEach((item) => {
    // avoid duplicate bindings
    if (item.dataset.bound === "1") return;
    item.dataset.bound = "1";

    item.addEventListener("click", function () {
      const analysisId = this.dataset.analysisId;
      if (analysisId) {
        loadHistoricalAnalysis(analysisId);
      }
    });
  });
}

// ==================== VOICE RECORDING ====================

async function toggleRecording() {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    transcriptionText = "";

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      await transcribeAudio(audioBlob);

      // Stop all audio tracks
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;

    recordBtn.classList.add("recording");
    recordBtn.innerHTML = '<span class="btn-icon">⏹️</span> Stop Recording';
    if (voiceStatus) {
      voiceStatus.textContent = "Recording... Speak your presentation";
      voiceStatus.classList.add("recording");
    }
    if (transcriptionStatus) transcriptionStatus.textContent = "Listening...";
  } catch (err) {
    console.error("Error accessing microphone:", err);
    showNotification("Could not access microphone. Please check permissions.", "error");
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;

    recordBtn.classList.remove("recording");
    recordBtn.innerHTML = '<span class="btn-icon">🎤</span> Start Recording';
    if (voiceStatus) {
      voiceStatus.textContent = "Processing speech...";
      voiceStatus.classList.remove("recording");
    }
    if (transcriptionStatus) transcriptionStatus.textContent = "Transcribing...";
  }
}

async function transcribeAudio(audioBlob) {
  try {
    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);

    reader.onloadend = async function () {
      const base64Audio = reader.result;

      const response = await fetch("/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio }),
      });

      if (!response.ok) throw new Error("Transcription failed");

      const result = await response.json();

      if (result.transcription) {
        transcriptionText = result.transcription;
        if (scriptTextarea) scriptTextarea.value = transcriptionText;
        if (transcriptionStatus) transcriptionStatus.textContent = "Transcription complete! You can edit the text above.";
      }

      if (result.voice_metrics) {
        voiceAnalysisResult = result.voice_metrics;
        updateVoiceMetrics(result.voice_metrics);
      }

      if (voiceStatus) voiceStatus.textContent = "Recording complete!";
      showNotification("Speech transcribed successfully!", "success");
    };
  } catch (error) {
    console.error("Error transcribing audio:", error);
    if (voiceStatus) voiceStatus.textContent = "Transcription failed";
    if (transcriptionStatus) transcriptionStatus.textContent = "Failed to transcribe. Please try again.";
    showNotification("Transcription failed. Please try again.", "error");
  }
}

function updateVoiceMetrics(metrics) {
  if (!metrics) return;
  if (voiceMetrics) voiceMetrics.classList.remove("hidden");

  if (voiceNervousnessBar && voiceNervousnessValue) {
    const voiceNervousness = metrics.voice_nervousness_score || 0;
    voiceNervousnessBar.style.width = `${voiceNervousness}%`;
    voiceNervousnessValue.textContent = voiceNervousness;
  }

  const metricsHtml = `
    <div class="voice-metrics-grid">
      <div class="metric-item">
        <span class="metric-label">Pitch Variation:</span>
        <span class="metric-value">${metrics.metrics?.pitch_variation ?? 0}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">Speech Rate:</span>
        <span class="metric-value">${metrics.metrics?.speech_rate ?? 0}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">Pause Frequency:</span>
        <span class="metric-value">${metrics.metrics?.pause_frequency ?? 0}%</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">Volume Consistency:</span>
        <span class="metric-value">${metrics.metrics?.volume_consistency ?? 0}%</span>
      </div>
    </div>
  `;

  const metricsContainer = document.getElementById("voice-metrics-details");
  if (metricsContainer) metricsContainer.innerHTML = metricsHtml;
}

// ==================== SCRIPT ANALYSIS ====================

async function analyzeScript() {
  const script = (scriptTextarea?.value || "").trim();

  if (!script) {
    showNotification("Please enter a script to analyze", "warning");
    return;
  }

  // Show loading
  if (loadingDiv) loadingDiv.classList.remove("hidden");
  if (resultsSection) resultsSection.classList.add("hidden");

  // Update timestamp
  updateTimestamp();

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Analysis failed");
    }

    const data = await response.json();

    // If we have voice analysis, combine with text analysis
    if (voiceAnalysisResult) {
      data.nervousness_score = Math.round(
        (data.nervousness_score || 0) * 0.7 + (voiceAnalysisResult.voice_nervousness_score || 0) * 0.3
      );

      data.confidence_score = Math.round(
        (data.confidence_score || 0) * 0.7 + (voiceAnalysisResult.voice_confidence_score || 0) * 0.3
      );

      if (voiceAnalysisResult.voice_insights) {
        data.detected_issues = [...(data.detected_issues || []), ...voiceAnalysisResult.voice_insights];
      }

      data.has_voice_analysis = true;
    }

    // Show/hide API warning
    if (data.api_key_warning) {
      if (warningMessage) {
        warningMessage.textContent =
          data.warning_message ||
          "⚠️ Using rule-based analysis only. Add GROQ_API_KEY to .env for AI-powered analysis.";
      }
      if (apiWarning) apiWarning.classList.remove("hidden");
    } else {
      if (apiWarning) apiWarning.classList.add("hidden");
    }

    // Update UI with results
    updateScores(data);
    updateIssues(data.detected_issues);
    updateImprovedScript(data.improved_script);
    updateTips(data.speaking_tips);

    // Show results
    if (resultsSection) {
      resultsSection.classList.remove("hidden");
      resultsSection.style.animation = "none";
      resultsSection.offsetHeight; // reflow
      resultsSection.style.animation = "fadeInUp 0.6s ease";
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // ✅ Update history instantly on 
    //  (NO refresh)
    if (window.location.pathname === "/dashboard") {
      prependHistoryItemFromAnalyze(data);
      // also refresh chart data (optional)
      if (document.getElementById("progressChart")) {
        loadProgressChart();
      }
    }

    showNotification("Analysis complete!", "success");
  } catch (error) {
    console.error("Error:", error);
    showNotification(error.message || "An error occurred during analysis. Please try again.", "error");
  } finally {
    if (loadingDiv) loadingDiv.classList.add("hidden");
  }
}

function updateTimestamp() {
  if (!timestampEl) return;

  const now = new Date();
  const options = { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true };
  timestampEl.textContent = `Analyzed at ${now.toLocaleTimeString("en-US", options)}`;
}

function updateScores(scores) {
  const nervousness = scores.nervousness_score || 0;
  const confidence = scores.confidence_score || 0;
  const clarity = scores.clarity_score || 0;

  animateProgressBar(nervousnessProgress, nervousness);
  animateProgressBar(confidenceProgress, confidence);
  animateProgressBar(clarityProgress, clarity);

  if (nervousnessValue) nervousnessValue.textContent = nervousness;
  if (confidenceValue) confidenceValue.textContent = confidence;
  if (clarityValue) clarityValue.textContent = clarity;
}

function animateProgressBar(element, targetWidth) {
  if (!element) return;

  const currentWidth = parseInt(element.style.width) || 0;
  const step = (targetWidth - currentWidth) / 20;
  let current = currentWidth;

  const animate = () => {
    current += step;
    if (
      (step > 0 && current < targetWidth) ||
      (step < 0 && current > targetWidth)
    ) {
      element.style.width = `${current}%`;
      requestAnimationFrame(animate);
    } else {
      element.style.width = `${targetWidth}%`;
    }
  };

  requestAnimationFrame(animate);
}

function updateIssues(issues) {
  if (!issues || issues.length === 0) {
    issues = ["No major issues detected - your script looks good!"];
  }
  if (issuesList) {
    issuesList.innerHTML = issues.map((issue) => `<li>${issue}</li>`).join("");
  }
}

function updateImprovedScript(script) {
  if (!script || script === "No improved version available") {
    script = "Add your GROQ API key to get AI-powered script improvements.";
  }
  if (improvedScript) improvedScript.textContent = script;
}

function updateTips(tips) {
  if (!tips || tips.length === 0) {
    tips = [
      "🎯 Practice your script out loud at least 3 times",
      "🎤 Record yourself and identify filler words",
      '⏸️ Use natural pauses instead of "um" and "uh"',
      "👀 Maintain eye contact with your audience",
      "🐢 Speak slowly - nervousness makes us speed up",
    ];
  }
  if (tipsList) {
    tipsList.innerHTML = tips.map((tip) => `<li>${tip}</li>`).join("");
  }
}

// ==================== HISTORY MANAGEMENT (UPDATED) ====================

function prependHistoryItemFromAnalyze(data) {
  const historyList = document.getElementById("history-list");
  if (!historyList) return;

  // remove empty message
  const emptyMsg = historyList.querySelector("p");
  if (emptyMsg && emptyMsg.textContent.toLowerCase().includes("no analyses")) {
    emptyMsg.remove();
  }

  // ✅ IMPORTANT: backend should return analysis_id
  const analysisId = data.analysis_id || data.id;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const conf = Math.round(data.confidence_score || 0);
  const nerv = Math.round(data.nervousness_score || 0);
  const clar = Math.round(data.clarity_score || 0);

  const item = document.createElement("div");
  item.className = "history-item";
  item.dataset.analysisId = analysisId || "";
  item.dataset.bound = "1";

  item.innerHTML = `
    <div class="history-date">${dateStr} at ${timeStr}</div>
    <div class="history-scores">
      <span class="history-score confidence">💪 ${conf}%</span>
      <span class="history-score nervousness">😰 ${nerv}%</span>
      <span class="history-score clarity">🎯 ${clar}%</span>
    </div>
  `;

  if (analysisId) {
    item.addEventListener("click", () => loadHistoricalAnalysis(analysisId));
  } else {
    // fallback warning
    item.addEventListener("click", () => {
      showNotification("History item ID missing. Add analysis_id in /analyze response.", "warning");
    });
  }

  historyList.prepend(item);
}

function loadHistoricalAnalysis(analysisId) {
  if (loadingDiv) loadingDiv.classList.remove("hidden");

  fetch(`/history/${analysisId}`)
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load analysis");
      return response.json();
    })
    .then((data) => {
      if (scriptTextarea) scriptTextarea.value = data.script || "";

      // Update scores
      if (data.scores) {
        updateScores({
          nervousness_score: data.scores.nervousness || 0,
          confidence_score: data.scores.confidence || 0,
          clarity_score: data.scores.clarity || 0,
        });
      }

      // Update issues
      if (data.issues) updateIssues(data.issues);
      else if (data.detected_issues) updateIssues(data.detected_issues);

      // Update improved script
      if (data.improved_script) updateImprovedScript(data.improved_script);

      // Update tips
      if (data.speaking_tips) updateTips(data.speaking_tips);

      if (resultsSection) resultsSection.classList.remove("hidden");

      const date = data.timestamp ? new Date(data.timestamp).toLocaleString() : "previous session";
      showNotification(`Loaded analysis from ${date}`, "info");

      if (resultsSection) resultsSection.scrollIntoView({ behavior: "smooth" });
    })
    .catch((error) => {
      console.error("Error loading analysis:", error);
      showNotification("Failed to load analysis", "error");
    })
    .finally(() => {
      if (loadingDiv) loadingDiv.classList.add("hidden");
    });
}

// ==================== PROGRESS CHART ====================

function loadProgressChart() {
  const chartContainer = document.getElementById("progressChart");
  if (!chartContainer) return;

  const parentContainer = chartContainer.parentElement;

  parentContainer.innerHTML =
    '<div style="text-align: center; color: #94a3b8; padding: 3rem;">Loading progress data...</div>';

  fetch("/progress")
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load progress data");
      return response.json();
    })
    .then((data) => {
      if (data.error) throw new Error(data.error);

      if (data.empty || !data.dates || data.dates.length === 0) {
        parentContainer.innerHTML = `
          <div style="text-align: center; padding: 3rem;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">📊</div>
            <h3 style="color: #e2e8f0; margin-bottom: 0.5rem;">No Data Yet</h3>
            <p style="color: #94a3b8;">${data.message || "Complete your first analysis to see your progress!"}</p>
          </div>
        `;
        return;
      }

      parentContainer.innerHTML = '<canvas id="progressChart"></canvas>';
      const newCanvas = document.getElementById("progressChart");
      const ctx = newCanvas.getContext("2d");

      if (window.progressChartInstance) {
        window.progressChartInstance.destroy();
      }

      window.progressChartInstance = new Chart(ctx, {
        type: "line",
        data: {
          labels: data.dates,
          datasets: [
            {
              label: "Confidence",
              data: data.confidence,
              borderColor: "#4ade80",
              backgroundColor: "rgba(74, 222, 128, 0.1)",
              tension: 0.4,
              fill: false,
              borderWidth: 3,
              pointBackgroundColor: "#4ade80",
              pointBorderColor: "#fff",
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: "Clarity",
              data: data.clarity,
              borderColor: "#60a5fa",
              backgroundColor: "rgba(96, 165, 250, 0.1)",
              tension: 0.4,
              fill: false,
              borderWidth: 3,
              pointBackgroundColor: "#60a5fa",
              pointBorderColor: "#fff",
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: "Nervousness",
              data: data.nervousness,
              borderColor: "#f87171",
              backgroundColor: "rgba(248, 113, 113, 0.1)",
              tension: 0.4,
              fill: false,
              borderWidth: 3,
              pointBackgroundColor: "#f87171",
              pointBorderColor: "#fff",
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: {
                color: "#94a3b8",
                font: { family: "Inter", size: 12, weight: "500" },
                usePointStyle: true,
                pointStyle: "circle",
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              grid: { color: "rgba(255, 255, 255, 0.05)", drawBorder: false, lineWidth: 1 },
              ticks: {
                color: "#94a3b8",
                stepSize: 20,
                font: { family: "Inter", size: 11 },
                callback: (value) => value + "%",
              },
            },
            x: {
              grid: { display: false },
              ticks: {
                color: "#94a3b8",
                maxRotation: 45,
                minRotation: 45,
                font: { family: "Inter", size: 11 },
              },
            },
          },
        },
      });
    })
    .catch((error) => {
      console.error("Error loading progress chart:", error);
      parentContainer.innerHTML = `
        <div style="text-align: center; padding: 3rem;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
          <h3 style="color: #f87171; margin-bottom: 0.5rem;">Failed to Load Data</h3>
          <p style="color: #94a3b8; margin-bottom: 1rem;">${error.message || "Please try again later"}</p>
          <button onclick="loadProgressChart()" class="btn-secondary" style="margin-top: 0.5rem;">
            <span class="btn-icon">🔄</span> Retry
          </button>
        </div>
      `;
    });
}

// ==================== UTILITY FUNCTIONS ====================

function copyImprovedScript() {
  const script = improvedScript?.textContent || "";

  if (!script || script.includes("Add your GROQ API key")) {
    showNotification("No improved script available to copy", "warning");
    return;
  }

  navigator.clipboard
    .writeText(script)
    .then(() => {
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '<span class="btn-icon">✓</span> Copied!';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);

      showNotification("Script copied to clipboard!", "success");
    })
    .catch((err) => {
      console.error("Copy failed:", err);
      showNotification("Failed to copy script", "error");
    });
}

function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 24px;
    background: ${
      type === "success"
        ? "rgba(74, 222, 128, 0.95)"
        : type === "warning"
        ? "rgba(251, 191, 36, 0.95)"
        : type === "error"
        ? "rgba(248, 113, 113, 0.95)"
        : "rgba(96, 165, 250, 0.95)"
    };
    color: white;
    border-radius: 8px;
    font-weight: 500;
    z-index: 2000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    font-family: 'Inter', sans-serif;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      if (notification.parentNode) document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

function addSampleButton() {
  const controls = document.querySelector(".controls");
  if (!controls) return;

  if (document.getElementById("sample-btn")) return;

  const sampleBtn = document.createElement("button");
  sampleBtn.id = "sample-btn";
  sampleBtn.className = "btn-secondary";
  sampleBtn.innerHTML = '<span class="btn-icon"></span> Load Sample';
  sampleBtn.type = "button";
  sampleBtn.onclick = () => {
    if (scriptTextarea) {
      scriptTextarea.value = `Good morning everyone. Um, I think I'm going to talk about, like, our project. Sorry if I'm nervous, but basically we've been working on this for, you know, a while. So, yeah, let me just start by saying that we've developed a really, really, really amazing product that will, kind of, change how people interact with technology. I guess we're pretty excited about it. Maybe you'll find it interesting too. So, without further ado, let me, um, show you what we've built.`;
    }
    showNotification("Sample script loaded!", "success");
  };

  controls.appendChild(sampleBtn);
}

// ==================== CSS ANIMATIONS ====================

const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes slideOut {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(20px); }
  }
  .notification { pointer-events: none; }
`;
document.head.appendChild(style);

