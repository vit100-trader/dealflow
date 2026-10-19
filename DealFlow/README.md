---
Status: current
Purpose: DealFlow setup, data contract, and verification
Scope: local standalone .NET 10 hackathon prototype using read-only QA Oracle history
Last validated: "2026-10-15"
Validation targets: [DealFlow.csproj, Program.cs, OracleHistory.cs, FlowAnalysis.cs, SelfTest.cs, tools/verify-ui.cjs]
---

# DealFlow

A local web app that places a deal on a map of observed status transitions. Its path is blue; the most common observed completed funding route has a green dashed overlay. Arrow labels show this deal's actual completed-transition durations, with minutes and seconds preserved. Routes this deal has not used say "Not taken". Historical dwell times use green, amber, and red bands. Click a state or route for details.

This is a standalone SDK project targeting .NET 10, with no references to the legacy solutions and no external NuGet or frontend packages. The map uses interactive SVG. It reads Oracle through the installed SQL*Plus client, so no Oracle driver package is needed. It follows the repository's C# 7.3 restriction.

## Run

Requirements: .NET 10 SDK, SQL*Plus, a working `DTCAN_QA` network alias, and network/VPN access to QA. Client path, alias, read-only username, and password are in `appsettings.json` for this POC. Open `DealFlow.csproj` in Visual Studio and start debugging directly; user secrets are not required.

From this folder:

```powershell
.\Start-DealFlow.ps1
```

The script uses the configured QA password, builds the app, opens the browser, and starts [http://localhost:5110](http://localhost:5110). It prompts only if neither configuration nor the environment supplies a password. Stop with Ctrl+C. Use `-NoBrowser` to skip opening a browser.

For this POC, the QA password is stored in plaintext in `appsettings.json` as requested. `DEALFLOW_ORACLE_PASSWORD`, when set, overrides the configured value. The password is not put in URLs, command-line arguments, or query logs. SQL*Plus receives it through redirected stdin and runs a read-only transaction followed by rollback. The adapter currently does not support passwords containing double quotes or newlines.

For an already-built copy:

```powershell
dotnet run --project .\DealFlow.csproj --no-build --no-launch-profile
```

That command also uses the password from `appsettings.json`. The app binds to localhost and rejects requests from non-loopback addresses. It has no dealer authentication or authorization and is intended for this local QA demonstration.

## Try it

1. Choose a recent QA application from the sidebar or enter a numeric deal/application ID.
2. Select the lender/product submission when the deal has more than one. Auto applications are supported in this prototype.
3. Change the comparison period from 7 to 365 days.
4. Click states to inspect individual visits and next-state shares. Click a route to see this deal's elapsed time and entry/exit timestamps, followed by historical average/median/p90 durations and transition counts. Percentages are explained as "X of Y recorded exits from the origin state went directly to this destination"; they are hidden on arrows by default. Enable the **Statistics** checkbox to overlay historical averages and shares, explicitly labeled History, alongside this deal's actual times. Nodes always show this deal's duration; repeated visits show their total duration and visit count. The current open state includes its ongoing wait. Statistics adds a separate historical summary line to nodes without hiding actual durations. Repeated uses of a route show separate passes and timestamps; up to two durations appear on the arrow, while longer histories show a pass count.
5. Use **All routes** to expand the focused map to every transition observed in the comparison sample. Use zoom and the map's scrollbars for dense maps or smaller screens.
6. Open **State catalog** for all definitions, including English/French names and active flags, from `DTCN.APPLICATIONSTATUS`.
7. States with dealer/lender messages have a message-count badge. Click a state to see its messages, sender, timestamp, subject when present, and full text. Deal activity also links to messages for each visit.

QA examples verified on October 15, 2026 (statuses can change):

| Deal ID | Observed path | Use |
|---|---|---|
| 12196870 | SU → AD → SU → CP → DE | Resubmission loop and declined outcome |
| 12192982 | SU → AD → AP | Approved milestone |
| Application ID 10658712 | Resolves to deal 12196870 | Lookup by historical application ID |
| 12196559 | QT → SU → AD → CA | BMW lender message: Invalid Published rate. Please select a Marketing Program. |

## Data and calculations

- `DTCN.APPLICATION_DTCAN` supplies `APPLICATIONID`, `APPLICATIONPROFILEID`, `LENDERID`, `PRODUCTID`, `LASTSTATUSID`, `CREATIONDATE`, `ORIGINATOR`, and `NEW`. `DTCN.APPLICATIONSTATUS` supplies the labels and catalog. `DTCN.APPLICATIONPROFILE` is used only to disambiguate a deal ID from an application ID. Journey queries omit applicant and financial fields. Message queries additionally load sender names and message text for the selected deal.
- A deal journey is one `(APPLICATIONPROFILEID, LENDERID, PRODUCTID)` stream. Different lender/product streams never become transitions in the same journey. Numeric profile IDs take precedence over application IDs if both exist.
- Version rows are ordered by `CREATIONDATE`, then `APPLICATIONID`. Consecutive identical statuses collapse into one visit, anchored at the first row. Repeated saves remain visible as a snapshot count. Revisiting a status after another status creates a separate visit.
- Map positions follow the supplied business buckets: Submission (`QT`, `AS`, `SU`, `AD`), Decision (good) (`AP`, `CA`, `CP`), Decision (decline) (`DE`, `EX`, `EA`), and Funding (`DI`, `DR`, `PP`, `BK`). Funding is to the right of decisions, with Document Received before Payment Pending and Booked. Request Funding (`RF`) and Finalized (`FN`), when observed, also sit in Funding. Decline outcomes sit below the good decisions; Withdrawn (`WD`) has its own lower lane because it can happen at any point. Unclassified codes retain an Other observed states label. These buckets affect positions only; arrows and the activity timeline still reflect actual recorded transitions.
- Current position is the latest observed status, cross-checked against the `NEW='Y'` row. A mismatch is shown as a warning. State entry times are inferred from version creation dates, rather than claimed as a separate event-audit timestamp. No synthetic Created or Waiting state is added.
- Messages come from `LENDCOM.NOTE` and `DTCN.APPLICATIONNOTE` for the selected deal/lender/product only, without marking them read. Both sender directions are included. Lendercom uses `ORIGINATOR`; legacy notes use `FORDEALER='Y'` for lender messages and `FORDEALER='N'` for dealer messages, matching the legacy application's save behavior. The stored sender is shown; a missing lender sender falls back to `LENDERLIST.LENDERNAME`.
- Message-to-state association is inferred from database timestamps in the half-open visit interval `[entry, next entry)`. Repeated visits to the same state retain separate visit timestamps; their messages are shown together with the visit indicated. Messages without timestamps or before the first recorded state appear in a separate panel. The BMW message for deal 12196559 was verified in `LENDCOM.NOTE` at `2026-10-15 06:11:37`, during the Conditional Approval visit that started at `06:11:27`.
- Message CLOBs are read as JSON and displayed as escaped plain text with line breaks preserved. Message HTML is not executed. Messages are fetched fresh and are not included in comparison-cohort data.
- Cohorts contain complete histories of the most recently active auto deals for the same lender and product whose current snapshot was created within the selected period. The default sample cap is 500 profiles (`Oracle:CohortLimit`); truncation is disclosed. The selected deal is excluded, so a 500-profile selection that contains it yields 499 comparison deals. This is a recency sample, not a random or complete population sample.
- Historical duration is the elapsed time from entering a status until the next different status. Mean, median, and interpolated p90 use observed exits only. Open final visits are counted separately and excluded from duration samples. This creates completion bias; the display is exploratory rather than a statistical waiting-time forecast.
- Edge shares divide the transition count by all observed exits from that origin state. Repeat visits contribute repeat transitions. These shares describe recorded behavior, not approval probabilities.
- The green completed funding route is the most frequent complete, actually observed compressed sequence among deals whose latest status is `BK` or `FN`. Ties prefer fewer states, then code order. Median funding time runs from the first recorded state to the latest Booked/Finalized state across that group; it is not a funding ETA. If no completed funding histories exist, no green route is drawn. Histories currently ending at `AP` are summarized separately under Approval milestone, with their own most common path, count, and median time to approval; they never substitute for a completed funding route.
- `BK`, `FN`, `DE`, `WD`, `EA`, and `EX` stop the current journey clock at the outcome entry. Later re-openings in the recorded history are retained. `AP` remains a milestone with a running dwell clock because further funding steps can follow.
- Traffic colors use fixed mean-dwell bands: under 1 hour, 1–24 hours, over 24 hours. These are display bands, not lender SLAs. Samples below 20 deals receive a warning; per-state/route sample sizes are always shown.
- Deal reads are fresh. Comparison histories are cached in memory for up to five minutes. Both observation times are displayed. Oracle `SYSDATE` is used for elapsed calculations; timestamps retain the database wall clock and are explicitly labeled without an assumed timezone.

## Verify

No legacy build is needed. From the repository root:

```powershell
dotnet build hackathon\DealFlow\DealFlow.csproj --configfile hackathon\DealFlow\NuGet.Config
dotnet hackathon\DealFlow\bin\Debug\net10.0\DealFlow.dll --self-test
node --check hackathon\DealFlow\wwwroot\app.js
```

The built-in check exercises 11 analysis invariants using synthetic events, including deduplication, loops, stable timestamp ties, repeated edge visits, terminal clocks, cohort exclusion, censoring, and successful-route selection. It performs no database queries.

Live smoke checks while the server is running:

```powershell
Invoke-RestMethod http://localhost:5110/api/health
Invoke-RestMethod http://localhost:5110/api/statuses
Invoke-RestMethod 'http://localhost:5110/api/deals/12196870?days=30'
```

`/api/health` reports configuration presence, not a live connectivity test. The other endpoints query QA. A missing auto application returns 404; invalid ID/period returns 400; missing credentials, Oracle failures, and query timeouts return 503 with a sanitized message.

Browser checks use `tools\verify-ui.cjs` with the already-running Edge/CDP profile on port 9223 described in the root `AGENTS.md`. Set `NODE_PATH` to the bundled Node dependencies directory returned by the workspace-dependencies tool; it includes `playwright-core`. Then run:

```powershell
node hackathon\DealFlow\tools\verify-ui.cjs
```

The script uses a separate browser context, checks lookup, state/route interaction, keyboard use, layers, zoom, catalog, period changes, missing-deal recovery, and mobile overflow. Screenshots go to the ignored `artifacts` folder unless an output directory is supplied.

## Limits and next work

The current implementation covers auto application version history and dealer/lender notes. Other asset tables, document-specific events, authentication/dealer scope, and deployment are outside this first version. The full state catalog does not imply every state appears in QA during a particular period. Some catalog translations contain the database placeholder `EN`; these values are shown as stored rather than invented.

The main data lesson from implementation is repeatable: saves are not transitions. `FlowAnalysis.Collapse` and its self-check preserve this rule; no standing repository guidance or learning-state entry was changed for this isolated prototype.
