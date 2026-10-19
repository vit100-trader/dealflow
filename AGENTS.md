---
Status: current
Purpose: agent instructions for the DealFlow hackathon POC
Scope: DealFlow POC repository
Last validated: "2026-10-19"
Validation targets: [DealFlow/DealFlow.csproj, DealFlow/Program.cs, DealFlow/OracleHistory.cs, DealFlow/FlowAnalysis.cs, DealFlow/wwwroot/app.js, DealFlow/README.md]
---

# DealFlow agent instructions

Read [DealFlow/README.md](DealFlow/README.md) for setup and calculation details. These instructions apply to this standalone hackathon repository.

## Scope and working style

- This is a working hackathon POC. Prioritize useful deal information and correct
  calculations. Do not expand a request into visual polish, architecture changes,
  new packages, or a unit-test project.
- Use English for new UI content. French localization is outside the requested
  POC scope.
- Keep this app separate from the legacy solutions. Do not modify legacy
  projects, package pins, or `GlobalAssemblyInfo.cs` for DealFlow work.
- Preserve existing edits and local configuration. Stage and commit only the
  files requested for the current change; do not stage the entire repository.
- Do not put passwords, connection credentials, or copied customer messages in
  agent instructions or commit messages. Local `*.local.*` files, `bin`, and
  `obj` are excluded by `DealFlow/.gitignore`.

## Build and run

This app is an SDK-style ASP.NET Core project targeting .NET 10. Its project file
sets C# 7.3. It uses plain HTML/CSS/JavaScript and SVG, with no external NuGet or
frontend packages. Open `DealFlow.csproj` directly in Visual Studio; this folder
currently has no solution file.

Run these commands from the `DealFlow` folder:

```powershell
dotnet build .\DealFlow.csproj --configfile .\NuGet.Config
dotnet run --project .\DealFlow.csproj --no-build --no-launch-profile
```

Use `dotnet build` for this standalone app. Legacy repository MSBuild
commands apply to the legacy .NET Framework solutions. Use `--no-restore` when
dependencies have already been restored and only compilation needs checking.

The configured local address is `http://localhost:5110`.
`Start-DealFlow.ps1` is an alternative launcher. Settings are in
`appsettings.json`; `DEALFLOW_ORACLE_PASSWORD` overrides the configured password.
Do not launch a second process on an occupied port. Stop or restart only the
app process owned by this chat, unless the user authorizes another process.

## Implementation owners

| File | Responsibility |
|---|---|
| `DealFlow/Program.cs` | HTTP endpoints and message-to-state association |
| `DealFlow/OracleHistory.cs` | SQL*Plus queries, parsing, comparison selection, and caching |
| `DealFlow/FlowAnalysis.cs` | State visits, durations, transition statistics, and historical routes |
| `DealFlow/DealNote.cs` | Message response fields |
| `DealFlow/wwwroot/app.js` | Map layout, labels, controls, and detail panels |
| `DealFlow/wwwroot/index.html`, `DealFlow/wwwroot/styles.css` | Page structure and styling |

## Data rules

- Oracle access is read-only. Use the configured `DTCAN_QA` connection and
  verify schema and representative records before changing SQL. Do not mark
  messages read, update application data, or change database objects.
- When Oracle MCP tools are unavailable, the installed SQL*Plus client is the
  existing read-only verification path. Keep credentials out of command-line
  arguments and output. Preserve `TAB OFF`, JSON/CLOB handling, and UTF-8 when
  reading messages; SQL*Plus tab substitution can corrupt JSON text.
- A journey is one deal/lender/product stream. Do not combine transitions from
  different lenders or products. Product and state names come from verified
  database lookups; IDs remain the internal keys.
- Collapse consecutive saves of the same status into one visit. A return to
  that status after another status is a new visit. Preserve the first entry
  timestamp and order equal timestamps by application ID.
- Exclude the selected deal from its historical comparison. Disclose the
  selected activity period, sample cap, and actual comparison count. Full
  histories can include events older than the activity period.
- Historical dwell averages use observed exits. Do not treat an open wait as
  a completed duration. Transition percentages count exits, including repeat
  visits; they are not approval probabilities.
- Messages come from both `LENDCOM.NOTE` and `DTCN.APPLICATIONNOTE`, scoped to
  the selected stream. Keep sender, timestamp, and full text. Display text
  safely without executing message HTML. State association is inferred from
  timestamps; do not present it as an explicit database status reference.

## Map and route rules

- Position states in the agreed Submission, Decision, and Funding buckets.
  `DI` and `DR` belong in Funding near `PP` and `BK`. Decline outcomes sit below
  good decisions. Withdrawn has a separate lane because it can happen anytime.
  Positioning must not invent or reorder the actual recorded transitions.
- Blue arrows show this deal's actual durations, preserving minutes and
  seconds. Unused routes say `Not taken`. Each visited node shows this deal's
  duration; repeated visits show total time and visit count.
- Statistics is off by default. Turning it on adds clearly labelled historical
  values without hiding this deal's actual times. Clicking a route shows exact
  timestamps and explains the historical numerator, denominator, and durations.
- The green funding route uses only histories currently ending in Booked (`BK`)
  or Finalized (`FN`). Approval (`AP`) is a separate milestone. Never fall back
  to an approval-only route when no completed funding history exists.
- Show route sample counts and ties honestly. One observed route among two
  tied histories is an example, not evidence of a broadly common path.

## Verification and handoff

- For code changes, build this app and check JavaScript syntax with
  `node --check .\wwwroot\app.js`. Do not add unit tests for routine POC changes
  unless requested.
- For UI changes, check the affected interaction in the browser. For calculation
  changes, compare the selected deal's timestamps and historical counts with a
  targeted read-only query or API response. Sample deal states can change;
  verify live data before describing them as current.
- Update the owning README when setup or calculation behavior changes. State
  what was verified and whether the server was left running. Do not claim
  checks passed unless they were actually run.
