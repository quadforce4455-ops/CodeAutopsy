import express from "express";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Store for GitHub tokens (in production, use Redis or database)
const githubTokenStore = new Map<string, { token: string; expiresAt: number }>();

const app = express();
app.use(express.json());

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing Gemini API Key.");
  return new GoogleGenAI({ apiKey });
};

const callWithTimeout = async (promise: Promise<any>, ms = 120000) => {
  let timeoutId: NodeJS.Timeout;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Request timed out.")), ms);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timeoutId!);
  return result;
};

// ── /api/autopsy ─────────────────────────────────────────────────────
app.post("/api/autopsy", async (req, res) => {
  try {
    const { code, language } = req.body;
    const ai = getAI();

    const prompt = `You are an expert code reviewer. Analyze the following ${language} code thoroughly.

Code:
${code}

Return a JSON object with:
- score: number 0.0–10.0 (overall quality)
- timeComplexity: string (e.g. "O(n²)" with a short explanation)
- spaceComplexity: string (e.g. "O(n)" with a short explanation)
- securityIssues: array of objects { severity: "Critical"|"Warning"|"Suggestion", description: string, fix: string }
- bugs: array of objects { severity: "Critical"|"Warning"|"Suggestion", line: number, description: string, fix: string }
- improvedCode: string (fully rewritten optimal code)`;

    const response: any = await callWithTimeout(
      ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              timeComplexity: { type: Type.STRING },
              spaceComplexity: { type: Type.STRING },
              securityIssues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: { type: Type.STRING },
                    description: { type: Type.STRING },
                    fix: { type: Type.STRING }
                  },
                  required: ["severity", "description", "fix"]
                }
              },
              bugs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: { type: Type.STRING },
                    line: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    fix: { type: Type.STRING }
                  },
                  required: ["severity", "line", "description", "fix"]
                }
              },
              improvedCode: { type: Type.STRING }
            },
            required: ["score", "timeComplexity", "spaceComplexity", "securityIssues", "bugs", "improvedCode"]
          }
        }
      })
    );

    let text = (response.text || "").trim();
    if (text.startsWith("```")) text = text.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    res.json(JSON.parse(text));

  } catch (error) {
    console.error("/api/autopsy error:", error);
    res.status(500).json({ error: (error as Error).message || "Autopsy failed." });
  }
});

// ── /api/explain ──────────────────────────────────────────────────────
app.post("/api/explain", async (req, res) => {
  try {
    const { code, language } = req.body;
    const ai = getAI();

    const lines = code.split("\n");
    const numberedCode = lines.map((l: string, i: number) => `${i + 1}: ${l}`).join("\n");

    const prompt = `You are an expert programming teacher. Explain the following ${language} code in detail.

Code (with line numbers):
${numberedCode}

Return a JSON object with:
- summary: string (one sentence — what this code does overall)
- breakdown: array of objects { lineRange: string (e.g. "1-3" or "5"), explanation: string (clear 1-2 sentence explanation of what those lines do) }
Group related lines together logically. Cover every line.
- suggestions: array of objects { type: "improvement"|"best-practice"|"performance", description: string }
Give 3-5 actionable suggestions to improve the code.`;

    const response: any = await callWithTimeout(
      ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              breakdown: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lineRange: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                  },
                  required: ["lineRange", "explanation"]
                }
              },
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    description: { type: Type.STRING }
                  },
                  required: ["type", "description"]
                }
              }
            },
            required: ["summary", "breakdown", "suggestions"]
          }
        }
      })
    );

    let text = (response.text || "").trim();
    if (text.startsWith("```")) text = text.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    res.json(JSON.parse(text));

  } catch (error) {
    console.error("/api/explain error:", error);
    res.status(500).json({ error: (error as Error).message || "Explanation failed." });
  }
});

// ── /api/smell ────────────────────────────────────────────────────────
app.post("/api/smell", async (req, res) => {
  try {
    const { code, language } = req.body;
    const ai = getAI();

    const prompt = `You are a strict software architect specializing in code quality and refactoring. Analyze the following ${language} code for code smells only — NOT bugs or security issues.

Code:
${code}

STRICT SCORING RULES (follow exactly, no exceptions):
- Start at 100 points
- Each High severity smell: subtract 12 points
- Each Medium severity smell: subtract 5 points  
- Each Low severity smell: subtract 1 point
- Low severity smells are style preferences, not real problems — be conservative, only flag genuine issues
- If code has only Low severity smells, minimum score is 85
- If code has zero smells, score is 100
- Minimum score is 0, maximum is 100
- healthScore MUST equal: 100 - (High count × 12) - (Medium count × 5) - (Low count × 1), clamped to 0-100
- overallHealth MUST be: "Healthy" if score >= 75, "Needs Work" if score 40-74, "Critical" if score < 40

REFACTORED CODE RULES (critical — follow strictly):
- The refactoredCode MUST fix EVERY smell you detected — no exceptions
- After writing the refactored code, mentally re-check it against each smell you found
- The refactored code must score 100% health if analyzed again
- Do NOT introduce new smells in the refactored code
- Use proper naming, extract methods, remove magic numbers, reduce nesting — address everything

SMELL CATEGORIES to check for:
Long Method, God Class, Magic Numbers, Dead Code, Duplicate Code, Deep Nesting, Poor Naming, Long Parameter List, Feature Envy, Data Clump, Primitive Obsession, Switch Statements, Lazy Class, Speculative Generality, Temporary Field, Message Chains, Middle Man, Inappropriate Intimacy

Return a JSON object with:
- overallHealth: string ("Healthy" | "Needs Work" | "Critical")
- healthScore: number 0-100 (calculated using the formula above)
- summary: string (one paragraph — what structural issues exist and overall assessment)
- smells: array of objects {
  category: string (from the list above),
  severity: "High" | "Medium" | "Low",
  line: number (exact line number where the smell occurs),
  description: string (specific description of what the smell is in THIS code),
  refactor: string (exact, specific steps to fix this smell — reference actual variable/function names from the code)
}
- refactoredCode: string (complete rewritten code that fixes ALL smells — must be fully functional and clean)
- metrics: object {
  linesOfCode: number (count actual lines),
  cyclomaticComplexity: string (calculate and explain e.g. "Low (3) — simple linear flow"),
  nestingDepth: string (measure actual max depth e.g. "Max 3 levels — acceptable"),
  duplicationRisk: string ("Low" | "Medium" | "High")
}`;

    const response: any = await callWithTimeout(
      ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallHealth: { type: Type.STRING },
              healthScore: { type: Type.NUMBER },
              summary: { type: Type.STRING },
              smells: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    severity: { type: Type.STRING },
                    line: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    refactor: { type: Type.STRING }
                  },
                  required: ["category", "severity", "line", "description", "refactor"]
                }
              },
              refactoredCode: { type: Type.STRING },
              metrics: {
                type: Type.OBJECT,
                properties: {
                  linesOfCode: { type: Type.NUMBER },
                  cyclomaticComplexity: { type: Type.STRING },
                  nestingDepth: { type: Type.STRING },
                  duplicationRisk: { type: Type.STRING }
                },
                required: ["linesOfCode", "cyclomaticComplexity", "nestingDepth", "duplicationRisk"]
              }
            },
            required: ["overallHealth", "healthScore", "summary", "smells", "refactoredCode", "metrics"]
          }
        }
      })
    );

    let text = (response.text || "").trim();
    if (text.startsWith("```")) text = text.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    res.json(JSON.parse(text));

  } catch (error) {
    console.error("/api/smell error:", error);
    res.status(500).json({ error: (error as Error).message || "Smell detection failed." });
  }
});

// ── /api/pr-review ────────────────────────────────────────────────────
app.post("/api/pr-review", async (req, res) => {
  try {
    const { prUrl } = req.body;
    const sessionId = req.headers["x-github-session"] as string | undefined;

    if (!prUrl) return res.status(400).json({ error: "Missing PR URL." });

    // Parse GitHub PR URL: https://github.com/owner/repo/pull/123
    const match = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return res.status(400).json({ error: "Invalid GitHub PR URL." });

    const [, owner, repo, pullNumber] = match;

    // Build auth headers — use session token if available, else unauthenticated (public PRs only)
    const ghHeaders: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "CodeAutopsy/1.0",
    };

    if (sessionId && githubTokenStore.has(sessionId)) {
      const tokenData = githubTokenStore.get(sessionId)!;
      if (tokenData.expiresAt > Date.now()) {
        ghHeaders["Authorization"] = `Bearer ${tokenData.token}`;
      }
    }

    // Fetch PR metadata
    const prMetaRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
      { headers: ghHeaders }
    );

    if (!prMetaRes.ok) {
      if (prMetaRes.status === 404) return res.status(404).json({ error: "PR not found. It may be private — connect your GitHub account to access it." });
      if (prMetaRes.status === 403) return res.status(403).json({ error: "Rate limit hit or access denied. Connect your GitHub account for higher limits." });
      return res.status(prMetaRes.status).json({ error: "Failed to fetch PR from GitHub." });
    }

    const prMeta = await prMetaRes.json() as any;

    // Fetch PR files (changed files with patches/diffs)
    const prFilesRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=30`,
      { headers: ghHeaders }
    );

    if (!prFilesRes.ok) return res.status(500).json({ error: "Failed to fetch PR files." });

    const prFiles = await prFilesRes.json() as any[];

    // Build diff summary for AI — only code files, max 8000 chars total to stay within limits
    const codeExts = new Set(['js','ts','jsx','tsx','py','java','go','rs','c','cpp','h','hpp','cs','rb','php','swift','kt','css','html','json','yaml','yml','sh','sql']);
    const relevantFiles = prFiles.filter(f => {
      const ext = f.filename.split('.').pop()?.toLowerCase() || '';
      return codeExts.has(ext) && f.patch;
    });

    let diffText = '';
    for (const file of relevantFiles) {
      const chunk = `\n\n--- FILE: ${file.filename} (+${file.additions}/-${file.deletions}) ---\n${file.patch || ''}`;
      if (diffText.length + chunk.length > 8000) break;
      diffText += chunk;
    }

    const ai = getAI();

    const prompt = `You are an expert code reviewer conducting a thorough pull request review. Analyze the following PR diff and provide a structured review.

PR: #${prMeta.number} — "${prMeta.title}"
Author: @${prMeta.user?.login || 'unknown'}
Changed files: ${prMeta.changed_files}, Additions: ${prMeta.additions}, Deletions: ${prMeta.deletions}
Description: ${prMeta.body ? prMeta.body.slice(0, 300) : 'No description'}

DIFF:
${diffText || 'No diff available'}

Analyze for: bugs, security issues, logic errors, performance problems, code style violations, missing error handling, and anti-patterns.

Return a JSON object with:
- score: number 0.0–10.0 (overall PR quality)
- verdict: string ("Approved" | "Needs Changes" | "Needs Minor Changes")
- summary: string (2-3 sentence overall assessment of the PR)
- files: array of objects {
  filename: string,
  additions: number,
  deletions: number,
  issues: array of {
    severity: "Critical" | "Warning" | "Suggestion",
    line: number or null,
    description: string,
    fix: string
  }
}
Only include files that have issues. Files with no issues should be omitted.`;

    const response: any = await callWithTimeout(
      ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              verdict: { type: Type.STRING },
              summary: { type: Type.STRING },
              files: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    filename: { type: Type.STRING },
                    additions: { type: Type.NUMBER },
                    deletions: { type: Type.NUMBER },
                    issues: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          severity: { type: Type.STRING },
                          line: { type: Type.NUMBER },
                          description: { type: Type.STRING },
                          fix: { type: Type.STRING }
                        },
                        required: ["severity", "description", "fix"]
                      }
                    }
                  },
                  required: ["filename", "additions", "deletions", "issues"]
                }
              }
            },
            required: ["score", "verdict", "summary", "files"]
          }
        }
      })
    );

    let text = (response.text || "").trim();
    if (text.startsWith("```")) text = text.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
    const aiResult = JSON.parse(text);

    // Merge AI file results with full file list (so all changed files show up in output)
    const allFiles = relevantFiles.map(f => {
      const aiFile = aiResult.files?.find((af: any) => af.filename === f.filename);
      return {
        filename: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        issues: aiFile?.issues || []
      };
    });

    res.json({
      score: aiResult.score,
      verdict: aiResult.verdict,
      summary: aiResult.summary,
      pr: {
        number: prMeta.number,
        title: prMeta.title,
        author: prMeta.user?.login,
        changedFiles: prMeta.changed_files,
        additions: prMeta.additions,
        deletions: prMeta.deletions,
      },
      files: allFiles
    });

  } catch (error) {
    console.error("/api/pr-review error:", error);
    res.status(500).json({ error: (error as Error).message || "PR review failed." });
  }
});

// ── GitHub OAuth ──────────────────────────────────────────────────────

// Get GitHub OAuth URL
app.get("/api/github/oauth-url", (req, res) => {
  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const redirectUri = process.env.GITHUB_REDIRECT_URI;
    const scope = "repo,user";
    
    if (!clientId || !redirectUri) {
      return res.status(500).json({ error: "GitHub OAuth not configured." });
    }
    
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&allow_signup=true`;
    res.json({ authUrl });
  } catch (error) {
    console.error("/api/github/oauth-url error:", error);
    res.status(500).json({ error: "Failed to generate OAuth URL." });
  }
});

// Handle GitHub OAuth callback
app.post("/api/github/callback", async (req, res) => {
  try {
    const { code } = req.body;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_REDIRECT_URI;

    if (!code || !clientId || !clientSecret || !redirectUri) {
      return res.status(400).json({ error: "Missing OAuth parameters." });
    }

    // Exchange code for token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error_description || "OAuth failed." });
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(400).json({ error: "No access token received." });
    }

    // Get user info to create a session
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    const user = await userResponse.json() as any;
    
    // Store token with session ID
    const sessionId = `gh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    githubTokenStore.set(sessionId, {
      token: accessToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      sessionId,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (error) {
    console.error("/api/github/callback error:", error);
    res.status(500).json({ error: "GitHub authentication failed." });
  }
});

// Get user's GitHub repositories
app.get("/api/github/repos", async (req, res) => {
  try {
    const sessionId = req.headers["x-github-session"] as string;
    
    if (!sessionId || !githubTokenStore.has(sessionId)) {
      return res.status(401).json({ error: "Not authenticated with GitHub." });
    }

    const tokenData = githubTokenStore.get(sessionId)!;
    
    // Check if token expired
    if (tokenData.expiresAt < Date.now()) {
      githubTokenStore.delete(sessionId);
      return res.status(401).json({ error: "GitHub session expired." });
    }

    const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&direction=desc", {
      headers: { "Authorization": `Bearer ${tokenData.token}` },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch repositories." });
    }

    const repos = await response.json();
    res.json(repos);
  } catch (error) {
    console.error("/api/github/repos error:", error);
    res.status(500).json({ error: "Failed to fetch repositories." });
  }
});

// Get file contents from GitHub repo
app.post("/api/github/file", async (req, res) => {
  try {
    const sessionId = req.headers["x-github-session"] as string;
    const { owner, repo, path: filePath } = req.body;

    if (!sessionId || !githubTokenStore.has(sessionId)) {
      return res.status(401).json({ error: "Not authenticated with GitHub." });
    }

    if (!owner || !repo || !filePath) {
      return res.status(400).json({ error: "Missing parameters." });
    }

    const tokenData = githubTokenStore.get(sessionId)!;

    // Check if token expired
    if (tokenData.expiresAt < Date.now()) {
      githubTokenStore.delete(sessionId);
      return res.status(401).json({ error: "GitHub session expired." });
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        headers: {
          "Authorization": `Bearer ${tokenData.token}`,
          "Accept": "application/vnd.github.v3.raw",
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch file." });
    }

    const content = await response.text();
    res.json({ content, path: filePath });
  } catch (error) {
    console.error("/api/github/file error:", error);
    res.status(500).json({ error: "Failed to fetch file contents." });
  }
});

// List files/directories in a GitHub repo path
app.post("/api/github/browse", async (req, res) => {
  try {
    const sessionId = req.headers["x-github-session"] as string;
    const { owner, repo, path: dirPath = "" } = req.body;

    if (!sessionId || !githubTokenStore.has(sessionId)) {
      return res.status(401).json({ error: "Not authenticated with GitHub." });
    }

    if (!owner || !repo) {
      return res.status(400).json({ error: "Missing parameters." });
    }

    const tokenData = githubTokenStore.get(sessionId)!;

    if (tokenData.expiresAt < Date.now()) {
      githubTokenStore.delete(sessionId);
      return res.status(401).json({ error: "GitHub session expired." });
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`;
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${tokenData.token}` },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to browse directory." });
    }

    const contents = await response.json() as any;
    
    // Filter and format response
    const items = Array.isArray(contents)
      ? contents.map((item: any) => ({
          name: item.name,
          type: item.type, // "file" or "dir"
          path: item.path,
          size: item.size,
          sha: item.sha,
          download_url: item.download_url,
        }))
      : [];

    res.json(items);
  } catch (error) {
    console.error("/api/github/browse error:", error);
    res.status(500).json({ error: "Failed to browse directory." });
  }
});

// Logout from GitHub
app.post("/api/github/logout", (req, res) => {
  try {
    const sessionId = req.headers["x-github-session"] as string;
    if (sessionId) {
      githubTokenStore.delete(sessionId);
    }
    res.json({ success: true });
  } catch (error) {
    console.error("/api/github/logout error:", error);
    res.status(500).json({ error: "Logout failed." });
  }
});


export default app;
