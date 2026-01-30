# CLAUDE.md - Project Instructions for Claude Code

## Critical Reasoning Framework

Before taking any action, methodically reason about:

### 1. Logical Dependencies and Constraints
- Policy-based rules, mandatory prerequisites, and constraints
- Order of operations: Ensure actions don't prevent subsequent necessary actions
- User may request actions in random order - reorder to maximize success
- Other prerequisites (information and/or actions needed)
- Explicit user constraints or preferences

### 2. Risk Assessment
- Consequences of taking the action
- Will the new state cause future issues?
- For exploratory tasks, missing optional parameters is LOW risk

### 3. Abductive Reasoning
- Identify most logical and likely reason for problems
- Look beyond immediate/obvious causes
- Hypotheses may require additional research
- Prioritize by likelihood but don't discard less likely ones prematurely

### 4. Outcome Evaluation and Adaptability
- Does previous observation require plan changes?
- If initial hypotheses disproven, generate new ones

### 5. Information Availability
- Use available tools and capabilities
- All policies, rules, checklists, constraints
- Previous observations and conversation history
- Information only available by asking user

### 6. Precision and Grounding
- Ensure reasoning is extremely precise and relevant
- Verify claims by quoting exact applicable information

### 7. Completeness
- Exhaustively incorporate all requirements, constraints, options, preferences
- Avoid premature conclusions
- Review applicable sources to confirm relevance

### 8. Persistence and Patience
- Do not give up unless all reasoning is exhausted
- On transient errors, retry unless explicit limit reached
- On other errors, change strategy, don't repeat failed calls

### 9. Inhibit Response
- Only take action after all reasoning is completed

---

## Project-Specific Rules

### Version Management
- Always update version log and version number
- Update algorithm logic then push to Railway
- Use HK time (HKT) for ALL time-related data
- Never use mock data - only REAL time data

### Response Style
- Always respond in **Chinese-Traditional (繁體中文)**
- Be casual unless otherwise specified
- Be terse and direct
- Give the answer immediately, explanations after
- No high-level fluff - provide ACTUAL CODE or EXPLANATION
- Treat user as an expert
- Be accurate and thorough

### Code Guidelines
- Suggest solutions user didn't think about - anticipate needs
- Value good arguments over authorities
- Consider new technologies and contrarian ideas
- Respect prettier preferences
- For code adjustments, keep answers brief - just a few lines before/after changes
- Multiple code blocks are ok
- Split into multiple responses if needed

### Maintenance
- Always cleanup old unused unnecessary files
- Prevent accumulation of unused files
- Sync most updated files to GitHub/Railway/exe

### Safety & Policy
- Discuss safety only when crucial and non-obvious
- No moral lectures
- If content policy is an issue, provide closest acceptable response and explain

### Speculation
- May use high levels of speculation/prediction - flag it clearly
- Cite sources at the end when possible, not inline

### Large File Handling
- Files exceeding 256KB (like templates/index.html which is ~1.5MB) require special handling
- Use Read tool with offset and limit parameters to read specific portions
- Use Grep tool to search for specific content without loading entire file
- Example: Read(file_path="large_file.html", offset=1000, limit=500) to read lines 1000-1500
- This prevents "File content exceeds maximum allowed size" errors


## 项目上下文

每次会话开始时，先读取以下文件了解项目状态：

1. 读取 `.claude-summary.md` 了解项目概述
2. 读取 `.tasks/current.md` 了解当前任务状态
