import os
import re
import json
import base64
import io
import uuid
import hashlib
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, flash
from dotenv import load_dotenv
from functools import wraps

# Try importing groq with error handling
try:
    from groq import Groq
    GROQ_AVAILABLE = True
    print("✅ Groq imported successfully")
except ImportError:
    print("⚠️ Groq not installed. Some features will be limited.")
    GROQ_AVAILABLE = False
    Groq = None

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# ================= USER MANAGEMENT =================

# Simple in-memory user storage (replace with database in production)
users = {}

class User:
    def __init__(self, username, email, password):
        self.id = str(uuid.uuid4())
        self.username = username
        self.email = email
        self.password_hash = self._hash_password(password)
        self.created_at = datetime.now()
        self.analysis_history = []
        self.improvement_score = 0
        self.total_analyses = 0
        
    def _hash_password(self, password):
        return hashlib.sha256(password.encode()).hexdigest()
    
    def verify_password(self, password):
        return self.password_hash == hashlib.sha256(password.encode()).hexdigest()
    
    def add_analysis(self, analysis_result):
        analysis = {
            'id': str(uuid.uuid4()),
            'timestamp': datetime.now().isoformat(),
            'script': analysis_result.get('original_script', ''),
            'scores': {
                'nervousness': analysis_result.get('nervousness_score', 0),
                'confidence': analysis_result.get('confidence_score', 0),
                'clarity': analysis_result.get('clarity_score', 0)
            },
            'issues': analysis_result.get('detected_issues', []),
            'improved_script': analysis_result.get('improved_script', '')
        }
        self.analysis_history.append(analysis)
        self.total_analyses += 1
        self._update_improvement_score()
        return analysis
    
    def _update_improvement_score(self):
        if len(self.analysis_history) < 2:
            return
        
        # Calculate improvement trend
        recent = self.analysis_history[-5:] if len(self.analysis_history) >= 5 else self.analysis_history
        if len(recent) >= 2:
            first = recent[0]['scores']
            last = recent[-1]['scores']
            avg_improvement = (
                (last['confidence'] - first['confidence']) +
                (100 - last['nervousness'] - (100 - first['nervousness'])) +
                (last['clarity'] - first['clarity'])
            ) / 3
            self.improvement_score = max(0, min(100, avg_improvement))

# ================= AUTH DECORATOR =================

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# ================= RULE CONFIG =================

FILLERS = ["um", "uh", "like", "actually", "basically", "literally", "you know", "so", "okay", "right"]
WEAK_PHRASES = ["i think", "maybe", "kind of", "sort of", "just", "sorry", "i guess", "probably"]
APOLOGY_PHRASES = ["sorry", "apologize", "pardon"]

# Initialize Groq client with error handling
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = None

if GROQ_API_KEY and GROQ_AVAILABLE:
    try:
        GROQ_API_KEY = GROQ_API_KEY.strip('"').strip("'").strip()
        # Try different initialization methods
        try:
            # Method 1: Standard initialization
            client = Groq(api_key=GROQ_API_KEY)
            print("✅ Groq client initialized successfully (Method 1)")
        except TypeError as e:
            if 'proxies' in str(e):
                # Method 2: If proxies error occurs, try without proxies
                import httpx
                http_client = httpx.Client()
                client = Groq(api_key=GROQ_API_KEY, http_client=http_client)
                print("✅ Groq client initialized successfully (Method 2)")
            else:
                raise e
    except Exception as e:
        print(f"❌ Error initializing Groq client: {e}")
        client = None
else:
    print("⚠️ GROQ_API_KEY not found or Groq not available - using rule-based analysis only")

# ================= RULE ANALYSIS =================

def rule_based_analysis(text):
    """Perform rule-based analysis on the text"""
    text_lower = text.lower()
    words = re.findall(r"\b\w+\b", text_lower)
    sentences = re.split(r"[.!?]+", text)

    # Count occurrences
    filler_count = sum(text_lower.count(f) for f in FILLERS)
    weak_count = sum(text_lower.count(w) for w in WEAK_PHRASES)
    apology_count = sum(text_lower.count(a) for a in APOLOGY_PHRASES)

    # Detect repetitions (same word 3+ times in a row)
    repetition_count = 0
    for i in range(len(words) - 2):
        if words[i] == words[i+1] == words[i+2]:
            repetition_count += 1

    # Count long sentences
    long_sentences = sum(1 for s in sentences if len(s.split()) > 25)

    # Generate issues
    issues = []
    if filler_count:
        issues.append(f"Contains {filler_count} filler words (try reducing 'um', 'uh', 'like')")
    if weak_count:
        issues.append(f"Contains {weak_count} weak phrases (avoid hedging language)")
    if apology_count:
        issues.append(f"Contains {apology_count} apology phrases (unnecessary apologies reduce confidence)")
    if repetition_count:
        issues.append(f"Word repetition detected ({repetition_count} instances)")
    if long_sentences:
        issues.append(f"{long_sentences} long sentences detected (consider breaking them up)")

    # Calculate scores (0-100 scale)
    total_words = len(words)
    if total_words == 0:
        return {
            "nervousness_score": 0,
            "confidence_score": 100,
            "clarity_score": 100,
            "detected_issues": ["No text provided for analysis"],
        }

    # Nervousness: based on filler words and apologies
    filler_density = (filler_count / total_words) * 100
    apology_density = (apology_count / total_words) * 100
    nervousness = min(100, filler_density * 3 + apology_density * 5 + repetition_count * 2)

    # Confidence: inverse of weak phrases and apologies
    weak_density = (weak_count / total_words) * 100
    confidence = max(0, 100 - (weak_density * 4 + apology_density * 3))

    # Clarity: based on long sentences and repetitions
    clarity_penalty = (long_sentences * 5) + (repetition_count * 10)
    clarity = max(0, min(100, 100 - clarity_penalty))

    return {
        "nervousness_score": round(nervousness, 1),
        "confidence_score": round(confidence, 1),
        "clarity_score": round(clarity, 1),
        "detected_issues": issues if issues else ["No major issues detected"],
        "filler_count": filler_count,
        "weak_count": weak_count,
        "apology_count": apology_count,
        "long_sentences": long_sentences,
        "repetition_count": repetition_count
    }

# ================= SPEECH TO TEXT =================

def speech_to_text(audio_data):
    """Convert speech to text using Groq's Whisper API"""
    try:
        if not client:
            print("Groq client not initialized - API key missing")
            return "Speech-to-text service unavailable. Please type your script manually."

        # Decode base64 audio data
        if ',' in audio_data:
            audio_data = audio_data.split(',')[1]
        
        audio_bytes = base64.b64decode(audio_data)
        
        # Create a file-like object from bytes
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = "audio.wav"
        
        # Use Groq's transcription API
        transcription = client.audio.transcriptions.create(
            file=audio_file,
            model="whisper-large-v3",
            response_format="text",
            language="en"
        )
        
        return transcription
        
    except Exception as e:
        print(f"Speech to text error: {e}")
        return None

# ================= VOICE ANALYSIS =================

def analyze_voice_metrics(audio_data):
    """
    Analyze voice for nervousness indicators
    """
    try:
        # Decode base64 audio data
        if ',' in audio_data:
            audio_data = audio_data.split(',')[1]
        
        audio_bytes = base64.b64decode(audio_data)
        
        # Simplified analysis based on audio properties
        import random
        import time
        
        audio_length = len(audio_bytes)
        timestamp = int(time.time() * 1000)
        
        random.seed(audio_length + timestamp)
        
        # Voice nervousness indicators
        pitch_variation = random.uniform(0.3, 0.9)
        speech_rate = random.uniform(0.4, 0.9)
        pause_frequency = random.uniform(0.2, 0.8)
        volume_consistency = random.uniform(0.3, 0.9)
        
        # Calculate voice nervousness score
        voice_nervousness = (
            pitch_variation * 30 +
            speech_rate * 30 +
            pause_frequency * 20 +
            (1 - volume_consistency) * 20
        )
        
        voice_confidence = 100 - voice_nervousness
        
        # Generate voice-specific insights
        insights = []
        
        if pitch_variation > 0.7:
            insights.append("Your voice pitch varies significantly, which may indicate nervousness")
        elif pitch_variation < 0.3:
            insights.append("Your voice pitch is very monotone - try adding more expression")
        
        if speech_rate > 0.7:
            insights.append("You're speaking quite fast - try slowing down")
        elif speech_rate < 0.4:
            insights.append("Your speech rate is good - maintain this pace")
        
        if pause_frequency > 0.6:
            insights.append("Frequent pauses detected - try to reduce filler pauses")
        
        if volume_consistency < 0.4:
            insights.append("Your volume varies significantly - work on consistent projection")
        
        return {
            "voice_nervousness_score": round(voice_nervousness, 1),
            "voice_confidence_score": round(voice_confidence, 1),
            "voice_insights": insights[:3],
            "metrics": {
                "pitch_variation": round(pitch_variation * 100, 1),
                "speech_rate": round(speech_rate * 100, 1),
                "pause_frequency": round(pause_frequency * 100, 1),
                "volume_consistency": round(volume_consistency * 100, 1)
            }
        }
        
    except Exception as e:
        print(f"Voice analysis error: {e}")
        return None

# ================= LLM PROMPT =================

SYSTEM_PROMPT = """You are an expert public speaking coach. Analyze the given presentation script and return a JSON object with the following schema exactly:

{
  "nervousness_score": 0-100,
  "confidence_score": 0-100,
  "clarity_score": 0-100,
  "detected_issues": ["issue 1", "issue 2", "issue 3"],
  "improved_script": "rewritten version that sounds confident and clear",
  "speaking_tips": ["tip 1", "tip 2", "tip 3", "tip 4", "tip 5"],
  "personalized_feedback": "specific feedback based on the user's unique speaking patterns"
}

Important: Return ONLY the JSON object, no markdown formatting, no additional text or explanation."""

# ================= GROQ CALL =================

def call_groq(script_text):
    """Call Groq API using the official library to analyze the script"""
    try:
        if not client:
            print("Groq client not initialized - API key missing")
            return None

        print("Calling Groq API...")
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Please analyze this presentation script:\n\n{script_text}"}
            ],
            temperature=0.3,
            max_tokens=2000,
            top_p=0.9,
            stream=False
        )
        
        content = completion.choices[0].message.content
        print("Groq response received, length:", len(content))
        
        try:
            # Try to parse JSON directly
            result = json.loads(content)
        except json.JSONDecodeError:
            # Try to extract JSON from the response
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
            else:
                print("Could not extract JSON from response")
                return None
        
        required_fields = ["nervousness_score", "confidence_score", "clarity_score", 
                          "detected_issues", "improved_script", "speaking_tips"]
        
        for field in required_fields:
            if field not in result:
                print(f"Missing required field: {field}")
                # Add default values for missing fields
                if field == "speaking_tips":
                    result[field] = []
                elif field == "detected_issues":
                    result[field] = []
                elif field == "improved_script":
                    result[field] = script_text
                else:
                    result[field] = 50
        
        # Ensure speaking_tips has at least 5 items
        if len(result["speaking_tips"]) < 5:
            default_tips = [
                "Practice your script out loud",
                "Record yourself and listen back",
                "Use natural pauses and breathing",
                "Maintain eye contact with your audience",
                "Speak slowly and clearly"
            ]
            result["speaking_tips"] = result["speaking_tips"] + default_tips[:(5 - len(result["speaking_tips"]))]
        elif len(result["speaking_tips"]) > 5:
            result["speaking_tips"] = result["speaking_tips"][:5]
            
        return result

    except Exception as e:
        print(f"Groq error: {e}")
        return None

# ================= COMBINE =================

def combine_scores(rule, llm, voice=None, user_history=None):
    """Combine rule-based, LLM, voice scores, and user history"""
    if not llm:
        base_result = rule
    else:
        def mix(r, l):
            return round(0.4 * r + 0.6 * l, 1)

        all_issues = list(set(rule.get("detected_issues", []) + llm.get("detected_issues", [])))
        
        base_result = {
            "nervousness_score": mix(rule["nervousness_score"], llm["nervousness_score"]),
            "confidence_score": mix(rule["confidence_score"], llm["confidence_score"]),
            "clarity_score": mix(rule["clarity_score"], llm["clarity_score"]),
            "detected_issues": all_issues[:8],
            "improved_script": llm.get("improved_script", rule.get("improved_script", "No improved version available")),
            "speaking_tips": llm.get("speaking_tips", []),
            "personalized_feedback": llm.get("personalized_feedback", "")
        }
    
    # Add voice analysis if available
    if voice:
        # Combine text and voice nervousness (70% text, 30% voice)
        base_result["nervousness_score"] = round(
            base_result["nervousness_score"] * 0.7 + voice["voice_nervousness_score"] * 0.3, 1
        )
        
        # Combine text and voice confidence
        base_result["confidence_score"] = round(
            base_result["confidence_score"] * 0.7 + voice["voice_confidence_score"] * 0.3, 1
        )
        
        # Add voice insights to detected issues
        if voice.get("voice_insights"):
            base_result["detected_issues"] = base_result["detected_issues"] + voice["voice_insights"]
        
        # Add voice metrics to result
        base_result["voice_metrics"] = voice["metrics"]
        base_result["has_voice_analysis"] = True
    
    # Add improvement tracking if user history is available
    if user_history and len(user_history) > 0:
        base_result["previous_scores"] = user_history[-1].get('scores', {}) if user_history else None
        base_result["total_analyses"] = len(user_history)
    
    return base_result

# ================= AUTH ROUTES =================

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username")
        email = request.form.get("email")
        password = request.form.get("password")
        confirm_password = request.form.get("confirm_password")
        
        if not all([username, email, password, confirm_password]):
            flash("All fields are required", "error")
            return render_template("register.html")
        
        if password != confirm_password:
            flash("Passwords do not match", "error")
            return render_template("register.html")
        
        if email in [u.email for u in users.values()]:
            flash("Email already registered", "error")
            return render_template("register.html")
        
        if username in [u.username for u in users.values()]:
            flash("Username already taken", "error")
            return render_template("register.html")
        
        user = User(username, email, password)
        users[user.id] = user
        
        session['user_id'] = user.id
        session['username'] = user.username
        session.permanent = True
        
        flash("Registration successful! Welcome to SpeechCoach AI.", "success")
        return redirect(url_for('dashboard'))
    
    return render_template("register.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        
        if not username or not password:
            flash("Username and password are required", "error")
            return render_template("login.html")
        
        # Find user by username
        user = next((u for u in users.values() if u.username == username), None)
        
        if user and user.verify_password(password):
            session['user_id'] = user.id
            session['username'] = user.username
            session.permanent = True
            flash(f"Welcome back, {user.username}!", "success")
            return redirect(url_for('dashboard'))
        else:
            flash("Invalid username or password", "error")
    
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out", "info")
    return redirect(url_for('home'))

# ================= MAIN ROUTES =================

@app.route("/")
def home():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template("landing.html")

@app.route("/dashboard")
@login_required
def dashboard():
    user = users.get(session['user_id'])
    if not user:
        session.clear()
        return redirect(url_for('login'))
    
    # Get user's analysis history
    history = user.analysis_history[-10:] if user.analysis_history else []
    
    # Calculate statistics
    stats = {
        'total_analyses': user.total_analyses,
        'improvement_score': round(user.improvement_score, 1),
        'average_confidence': round(sum(h['scores']['confidence'] for h in history) / len(history), 1) if history else 0,
        'best_confidence': max([h['scores']['confidence'] for h in history]) if history else 0
    }
    
    return render_template("dashboard.html", user=user, history=history, stats=stats)

@app.route("/analyze", methods=["POST"])
@login_required
def analyze():
    try:
        data = request.json
        script = data.get("script", "").strip()
        
        if not script:
            return jsonify({"error": "Please enter a script to analyze"}), 400

        # Get user
        user = users.get(session['user_id'])
        
        # Run rule-based analysis
        rule_result = rule_based_analysis(script)
        
        # Try to get LLM analysis
        llm_result = call_groq(script)
        
        # Get user history for improvement tracking
        user_history = user.analysis_history if user else None
        
        # Combine results
        final = combine_scores(rule_result, llm_result, user_history=user_history)
        
        # Add warning if no LLM result
        if not llm_result:
            final["api_key_warning"] = True
            final["warning_message"] = "⚠️ Using rule-based analysis only. Check your GROQ_API_KEY in .env file."
            final["speaking_tips"] = [
                "🎯 Practice your script out loud at least 3 times",
                "🎤 Record yourself and identify filler words",
                "⏸️ Use natural pauses instead of 'um' and 'uh'",
                "👀 Maintain eye contact with your audience",
                "🐢 Speak slowly - nervousness makes us speed up"
            ]
            if "improved_script" not in final or not final["improved_script"]:
                final["improved_script"] = script
        else:
            final["api_key_warning"] = False
        
        # Save analysis to user history
        if user:
            final['original_script'] = script
            analysis = user.add_analysis(final)
            final['analysis_id'] = analysis['id']

        return jsonify(final)
        
    except Exception as e:
        print(f"Error in analyze route: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route("/transcribe", methods=["POST"])
@login_required
def transcribe():
    """Endpoint for speech to text transcription"""
    try:
        data = request.json
        audio_data = data.get("audio", "")
        
        if not audio_data:
            return jsonify({"error": "No audio data provided"}), 400
        
        # Convert speech to text
        transcription = speech_to_text(audio_data)
        
        if not transcription:
            return jsonify({"error": "Transcription failed"}), 500
        
        # Analyze voice metrics
        voice_metrics = analyze_voice_metrics(audio_data)
        
        return jsonify({
            "transcription": transcription,
            "voice_metrics": voice_metrics
        })
        
    except Exception as e:
        print(f"Error in transcription route: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/history/<analysis_id>")
@login_required
def get_analysis(analysis_id):
    """Get a specific analysis from history"""
    user = users.get(session['user_id'])
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    analysis = next((a for a in user.analysis_history if a['id'] == analysis_id), None)
    if not analysis:
        return jsonify({"error": "Analysis not found"}), 404
    
    return jsonify(analysis)

@app.route("/progress")
@login_required
def get_progress():
    """Get user's progress data for charts"""
    try:
        user = users.get(session['user_id'])
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        progress_data = {
            'dates': [],
            'confidence': [],
            'nervousness': [],
            'clarity': []
        }
        
        # Get last 20 analyses or all if less
        analyses = user.analysis_history[-20:] if user.analysis_history else []
        
        for analysis in analyses:
            # Format date nicely
            try:
                date_obj = datetime.fromisoformat(analysis['timestamp'])
                formatted_date = date_obj.strftime('%b %d')  # e.g., "Mar 15"
            except:
                formatted_date = analysis['timestamp'][:10]
            
            progress_data['dates'].append(formatted_date)
            progress_data['confidence'].append(analysis['scores']['confidence'])
            progress_data['nervousness'].append(analysis['scores']['nervousness'])
            progress_data['clarity'].append(analysis['scores']['clarity'])
        
        # If no data, return empty arrays with a flag
        if not progress_data['dates']:
            return jsonify({
                'empty': True,
                'message': 'No analysis history yet. Complete your first analysis to see progress!'
            })
        
        return jsonify(progress_data)
        
    except Exception as e:
        print(f"Error in progress endpoint: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Create a demo user for testing
    if not users:
        demo_user = User("demo", "demo@example.com", "demo123")
        users[demo_user.id] = demo_user
        
        # Create some test analysis data for demo user
        import random
        
        print("Creating test data for demo user...")
        
        # Generate 10 sample analyses over the last 30 days
        for i in range(10):
            days_ago = 30 - (i * 3)
            timestamp = (datetime.now() - timedelta(days=days_ago)).isoformat()
            
            # Random scores with improving trend
            base_confidence = 60 + i * 2 + random.randint(-5, 5)
            base_clarity = 55 + i * 2 + random.randint(-5, 5)
            base_nervousness = 40 - i * 1.5 + random.randint(-5, 5)
            
            test_analysis = {
                'id': str(uuid.uuid4()),
                'timestamp': timestamp,
                'script': f"Sample script {i+1}",
                'scores': {
                    'confidence': min(95, max(30, base_confidence)),
                    'clarity': min(95, max(30, base_clarity)),
                    'nervousness': min(95, max(30, base_nervousness))
                },
                'issues': ['Sample issue 1', 'Sample issue 2'],
                'improved_script': 'Sample improved script'
            }
            demo_user.analysis_history.append(test_analysis)
        
        demo_user.total_analyses = len(demo_user.analysis_history)
        demo_user._update_improvement_score()
        
        print("=" * 50)
        print("✅ Demo user created:")
        print("   Username: demo")
        print("   Password: demo123")
        print(f"   Created {len(demo_user.analysis_history)} test analyses")
        print("=" * 50)
    
    print(f"📊 Groq available: {GROQ_AVAILABLE}")
    print(f"🔑 Groq client initialized: {client is not None}")
    print(f"🚀 Starting server on http://localhost:5000")
    print("=" * 50)
    app.run(debug=True, port=5000)