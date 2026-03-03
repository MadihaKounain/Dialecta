"""
DIALECTA — AI Debate Arena
Flask backend application
"""

import os
import json
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session
import anthropic

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dialecta-secret-key-change-in-prod")

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# In-memory debate history (JSON-based, no SQL)
DEBATES_FILE = "debates.json"


# ─────────────────────────────────────────────
# Debate Storage Helpers
# ─────────────────────────────────────────────

def load_debates():
    if os.path.exists(DEBATES_FILE):
        with open(DEBATES_FILE, "r") as f:
            return json.load(f)
    return {}


def save_debates(debates):
    with open(DEBATES_FILE, "w") as f:
        json.dump(debates, f, indent=2)


def save_debate_record(debate_id, record):
    debates = load_debates()
    debates[debate_id] = record
    save_debates(debates)


# ─────────────────────────────────────────────
# AI Agent Logic
# ─────────────────────────────────────────────

TONE_DESCRIPTIONS = {
    "academic": "Use academic, scholarly language with references to well-known research, careful reasoning, and a measured, objective tone.",
    "formal": "Use formal, structured language appropriate for a professional debate setting. Be precise and organized.",
    "aggressive": "Use assertive, direct, occasionally combative language. Be bold and challenge the opponent forcefully while staying fact-based.",
    "socratic": "Use questioning techniques, probe assumptions, and employ the Socratic method to expose weaknesses in the opposing view.",
}

PHASE_INSTRUCTIONS = {
    "opening": "This is your OPENING STATEMENT. Present your primary thesis and two or three core arguments that support your position.",
    "rebuttal": "This is your REBUTTAL ROUND. Directly identify and counter the opponent's main claim and reasoning.",
    "cross": "This is your CROSS-ARGUMENT ROUND. Introduce a new angle or dimension of the debate while dismantling the opponent's framework.",
    "closing": "This is your CLOSING STATEMENT. Summarize why your position has prevailed, referencing key points and conceding nothing.",
}

PHASE_LABELS = {
    "opening": "Opening Statement",
    "rebuttal": "Rebuttal",
    "cross": "Cross-Argument",
    "closing": "Closing Statement",
}


def build_system_prompt(agent, topic, tone, phase, opponent_claim=None):
    position = "PRO — firmly in favor of the motion" if agent == "pro" else "CON — firmly against the motion"
    tone_desc = TONE_DESCRIPTIONS.get(tone, TONE_DESCRIPTIONS["academic"])
    phase_instr = PHASE_INSTRUCTIONS.get(phase, "")

    if opponent_claim:
        phase_instr += f'\n\nYour opponent\'s last claim was: "{opponent_claim}"'

    return f"""You are an expert AI debate agent taking the position of {position} on the topic: "{topic}".

{tone_desc}

{phase_instr}

You MUST respond ONLY with a valid JSON object. No markdown, no backticks, no extra text.
The JSON must have exactly these keys:

{{
  "claim": "Your main claim/thesis for this argument (1-2 sentences)",
  "reasoning": "Logical reasoning explaining why your claim is true (2-3 sentences)",
  "evidence": "Specific examples, data points, or historical facts supporting your claim (2-3 sentences)",
  "validity": "Plain English explanation of why this argument is logically sound (1-2 sentences)",
  "logical_score": <integer 0-100>,
  "clarity_score": <integer 0-100>,
  "evidence_score": <integer 0-100>,
  "fallacy": "<name of logical fallacy if intentionally used for rhetorical effect, or null>",
  "fallacy_explanation": "<plain English explanation of the fallacy if present, or null>",
  "bias_type": "<one of: emotional_language | exaggeration | one_sided_framing | loaded_language, or null>",
  "bias_explanation": "<plain English explanation of bias if present, or null>"
}}"""


def generate_argument(agent, topic, tone, phase, opponent_claim=None):
    system = build_system_prompt(agent, topic, tone, phase, opponent_claim)
    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=900,
        system=system,
        messages=[{"role": "user", "content": f"Generate your {PHASE_LABELS[phase]} argument now."}],
    )

    raw = response.content[0].text.strip()
    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    data = json.loads(raw)

    # Normalize scores to integers
    for key in ("logical_score", "clarity_score", "evidence_score"):
        data[key] = max(0, min(100, int(data.get(key, 60))))

    return data


def determine_winner(pro_scores, con_scores, pro_fallacies, con_fallacies):
    pro_total = sum(pro_scores) - (pro_fallacies * 5)
    con_total = sum(con_scores) - (con_fallacies * 5)
    pro_avg = sum(pro_scores) / len(pro_scores) if pro_scores else 0
    con_avg = sum(con_scores) / len(con_scores) if con_scores else 0

    margin = abs(pro_total - con_total)

    if margin < 5:
        winner = "draw"
        winner_label = "DRAW"
        reasoning = (
            "Both agents presented arguments of comparable quality. "
            "The debate was evenly matched in reasoning, evidence, and logical consistency."
        )
    elif pro_total > con_total:
        winner = "pro"
        winner_label = "ADVOCATE (Pro)"
        reasoning = (
            f"The Pro position wins by reasoning quality. "
            f"Average argument strength: {pro_avg:.1f} vs {con_avg:.1f}. "
            f"The Advocate demonstrated superior logical consistency"
            + (" and committed fewer logical fallacies." if pro_fallacies < con_fallacies else ".")
        )
    else:
        winner = "con"
        winner_label = "CHALLENGER (Con)"
        reasoning = (
            f"The Con position wins by reasoning quality. "
            f"Average argument strength: {con_avg:.1f} vs {pro_avg:.1f}. "
            f"The Challenger demonstrated superior logical consistency"
            + (" and committed fewer logical fallacies." if con_fallacies < pro_fallacies else ".")
        )

    return {
        "winner": winner,
        "winner_label": winner_label,
        "reasoning": reasoning,
        "pro_total": round(pro_total, 1),
        "con_total": round(con_total, 1),
        "pro_avg": round(pro_avg, 1),
        "con_avg": round(con_avg, 1),
    }


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/debate")
def debate_page():
    return render_template("debate.html")


@app.route("/results")
def results_page():
    return render_template("results.html")


@app.route("/history")
def history_page():
    debates = load_debates()
    history = [
        {
            "id": did,
            "topic": d.get("topic", "Unknown"),
            "winner": d.get("winner_data", {}).get("winner_label", "?"),
            "date": d.get("date", ""),
            "rounds": len(d.get("arguments", [])) // 2,
        }
        for did, d in sorted(debates.items(), key=lambda x: x[1].get("date", ""), reverse=True)
    ]
    return render_template("history.html", history=history)


@app.route("/api/start-debate", methods=["POST"])
def start_debate():
    data = request.get_json()
    topic = data.get("topic", "").strip()
    tone = data.get("tone", "academic")
    total_rounds = int(data.get("rounds", 3))

    if not topic:
        return jsonify({"error": "Topic is required"}), 400

    debate_id = str(uuid.uuid4())[:8]
    session["debate_id"] = debate_id
    session["topic"] = topic
    session["tone"] = tone
    session["total_rounds"] = total_rounds

    # Determine active phases
    phase_map = {2: ["opening", "closing"], 3: ["opening", "rebuttal", "closing"], 4: ["opening", "rebuttal", "cross", "closing"]}
    phases = phase_map.get(total_rounds, phase_map[3])

    record = {
        "id": debate_id,
        "topic": topic,
        "tone": tone,
        "phases": phases,
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "arguments": [],
        "pro_scores": [],
        "con_scores": [],
        "pro_fallacies": 0,
        "con_fallacies": 0,
        "fallacy_log": [],
        "bias_log": [],
        "winner_data": None,
    }
    save_debate_record(debate_id, record)

    return jsonify({"debate_id": debate_id, "phases": phases, "phase_labels": PHASE_LABELS})


@app.route("/api/generate-argument", methods=["POST"])
def generate_argument_route():
    data = request.get_json()
    debate_id = data.get("debate_id")
    agent = data.get("agent")  # "pro" or "con"
    phase = data.get("phase")
    opponent_claim = data.get("opponent_claim")

    debates = load_debates()
    if debate_id not in debates:
        return jsonify({"error": "Debate not found"}), 404

    record = debates[debate_id]
    topic = record["topic"]
    tone = record["tone"]

    try:
        arg = generate_argument(agent, topic, tone, phase, opponent_claim)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Failed to parse AI response: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Compute overall score
    overall = round((arg["logical_score"] + arg["clarity_score"] + arg["evidence_score"]) / 3)
    arg["overall_score"] = overall
    arg["agent"] = agent
    arg["phase"] = phase
    arg["phase_label"] = PHASE_LABELS.get(phase, phase)

    # Update record
    record["arguments"].append(arg)
    if agent == "pro":
        record["pro_scores"].append(overall)
        if arg.get("fallacy"):
            record["pro_fallacies"] += 1
            record["fallacy_log"].append({"agent": "pro", "fallacy": arg["fallacy"], "explanation": arg.get("fallacy_explanation", "")})
    else:
        record["con_scores"].append(overall)
        if arg.get("fallacy"):
            record["con_fallacies"] += 1
            record["fallacy_log"].append({"agent": "con", "fallacy": arg["fallacy"], "explanation": arg.get("fallacy_explanation", "")})

    if arg.get("bias_type"):
        record["bias_log"].append({"agent": agent, "type": arg["bias_type"], "explanation": arg.get("bias_explanation", "")})

    save_debate_record(debate_id, record)

    return jsonify(arg)


@app.route("/api/finalize-debate", methods=["POST"])
def finalize_debate():
    data = request.get_json()
    debate_id = data.get("debate_id")

    debates = load_debates()
    if debate_id not in debates:
        return jsonify({"error": "Debate not found"}), 404

    record = debates[debate_id]
    winner_data = determine_winner(
        record["pro_scores"],
        record["con_scores"],
        record["pro_fallacies"],
        record["con_fallacies"],
    )
    record["winner_data"] = winner_data
    save_debate_record(debate_id, record)

    return jsonify({"winner_data": winner_data, "record": record})


@app.route("/api/debate/<debate_id>", methods=["GET"])
def get_debate(debate_id):
    debates = load_debates()
    if debate_id not in debates:
        return jsonify({"error": "Not found"}), 404
    return jsonify(debates[debate_id])


if __name__ == "__main__":
    app.run(debug=True, port=5000)
